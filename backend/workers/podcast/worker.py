"""Podcast ingestion worker using RSS feed discovery + Amazon Transcribe."""

import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import feedparser
import requests

from intel_shared.models.dynamo import SourceType
from intel_shared.utils.config import get_config
from workers.base.base_worker import BaseWorker, RawItem

logger = logging.getLogger(__name__)


class PodcastWorker(BaseWorker):
    """
    Ingests podcast episodes from RSS feeds, transcribes audio via Amazon Transcribe.

    Source config:
      feed_url: str          - Podcast RSS feed URL
      lookback_days: int     - Days back (default 30)
      max_episodes: int      - Max episodes per run (default 5)

    Uses IAM role for Transcribe — no API key required.
    Audio files downloaded temporarily then passed to Transcribe via S3.
    """

    def fetch_items(self) -> list[RawItem]:
        feed_url = self.source_config.get('feed_url', self.source_config.get('feedUrl'))
        if not feed_url:
            logger.error("No feed_url in podcast source config")
            return []

        lookback_days = int(self.source_config.get('lookback_days', self.source_config.get('lookbackDays', 30)))
        max_episodes = int(self.source_config.get('max_episodes', self.source_config.get('maxEpisodes', 5)))
        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

        logger.info(f"Parsing podcast feed: {feed_url}")
        feed = feedparser.parse(feed_url)

        if not feed.entries:
            logger.warning(f"No entries in podcast feed: {feed_url}")
            return []

        items = []
        for entry in feed.entries[:max_episodes * 2]:
            # Parse date
            published_at = _parse_entry_date(entry)
            if published_at and published_at < cutoff:
                continue

            # Get audio URL from enclosure
            audio_url = _get_audio_url(entry)
            if not audio_url:
                logger.debug(f"No audio enclosure for: {entry.get('title', 'unknown')}")
                continue

            title = entry.get('title', 'Untitled Episode')
            episode_id = str(uuid.uuid4()).replace('-', '')[:16]

            try:
                transcript = self._transcribe_episode(audio_url, episode_id, title)
            except Exception as e:
                logger.error(f"Transcription failed for {title}: {e}", exc_info=True)
                # Fall back to episode description
                transcript = _get_description(entry)
                if not transcript:
                    continue

            items.append(RawItem(
                title=title,
                url=entry.get('link', audio_url),
                content=transcript,
                source_type=SourceType.PODCAST,
                published_at=published_at,
                metadata={
                    'feed_url': feed_url,
                    'podcast_title': feed.feed.get('title', ''),
                    'audio_url': audio_url,
                    'transcribed': True,
                },
            ))

            if len(items) >= max_episodes:
                break

        logger.info(f"Fetched {len(items)} podcast episodes")
        return items

    def _transcribe_episode(self, audio_url: str, episode_id: str, title: str) -> str:
        """
        Upload audio to S3 then start Transcribe job. Returns transcript text.

        Transcribe requires audio to be in S3 — it cannot access arbitrary URLs.
        We download the audio file and upload it to our raw bucket first.
        """
        import boto3
        from intel_shared.clients.s3 import get_raw_bucket_name, get_s3_client

        # Determine audio format from URL
        audio_format = _detect_audio_format(audio_url)
        s3_key = f"audio/{self.topic_id}/{episode_id}.{audio_format}"

        logger.info(f"Downloading audio: {audio_url[:80]}...")
        response = requests.get(audio_url, timeout=300, stream=True)
        response.raise_for_status()

        # Upload to S3
        s3_client = get_s3_client()
        s3_client.upload_fileobj(response.raw, get_raw_bucket_name(), s3_key)
        media_uri = f"s3://{get_raw_bucket_name()}/{s3_key}"
        logger.info(f"Audio uploaded to {media_uri}")

        # Start Transcribe job
        job_name = f"intel-{self.topic_id[:8]}-{episode_id}"
        self._transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={'MediaFileUri': media_uri},
            MediaFormat=audio_format,
            LanguageCode='en-US',
            OutputBucketName=get_raw_bucket_name(),
            OutputKey=f"transcripts/{self.topic_id}/{episode_id}.json",
        )

        # Wait for completion (uses BaseWorker._wait_for_transcript)
        transcript_text = self._wait_for_transcript(job_name)

        # Clean up audio file from S3 (save storage cost)
        try:
            get_s3_client().delete_object(Bucket=get_raw_bucket_name(), Key=s3_key)
        except Exception:
            pass

        return transcript_text


def _parse_entry_date(entry) -> Optional[datetime]:
    import time
    for attr in ('published_parsed', 'updated_parsed'):
        parsed = getattr(entry, attr, None)
        if parsed:
            try:
                return datetime.fromtimestamp(time.mktime(parsed), tz=timezone.utc)
            except Exception:
                continue
    return None


def _get_audio_url(entry) -> Optional[str]:
    """Extract audio enclosure URL from podcast RSS entry."""
    enclosures = getattr(entry, 'enclosures', [])
    for enc in enclosures:
        enc_type = enc.get('type', '')
        if 'audio' in enc_type or enc.get('href', '').endswith(('.mp3', '.mp4', '.m4a', '.ogg', '.wav')):
            return enc.get('href')
    return None


def _get_description(entry) -> str:
    """Get episode description as fallback content."""
    return entry.get('summary', '') or entry.get('description', '')


def _detect_audio_format(url: str) -> str:
    url_lower = url.lower().split('?')[0]
    for fmt in ['mp3', 'mp4', 'm4a', 'wav', 'ogg', 'flac']:
        if url_lower.endswith(f'.{fmt}'):
            return fmt
    return 'mp3'  # default assumption
