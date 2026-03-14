"""YouTube ingestion worker using Data API v3 + youtube-transcript-api."""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from googleapiclient.discovery import build
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

from intel_shared.clients.secrets import get_secret
from intel_shared.models.dynamo import SourceType
from workers.base.base_worker import BaseWorker, RawItem

logger = logging.getLogger(__name__)


class YouTubeWorker(BaseWorker):
    """
    Ingests YouTube videos via Data API v3, gets transcripts via youtube-transcript-api.

    Source config:
      channel_ids: list[str]     - YouTube channel IDs (UCxxxxxxxx)
      playlist_ids: list[str]    - Playlist IDs
      search_query: str          - Search query (optional)
      max_results: int           - Max videos per channel/playlist (default 10)
      lookback_days: int         - Days back (default 14)

    YouTube API key from Secrets Manager: /intel-ingester/prod/youtube → {api_key}
    """

    def fetch_items(self) -> list[RawItem]:
        import os
        env = os.environ.get('ENV', 'prod')
        creds = get_secret(f'/intel-ingester/{env}/youtube')
        api_key = creds['api_key']

        channel_ids = self.source_config.get('channel_ids', self.source_config.get('channelIds', []))
        playlist_ids = self.source_config.get('playlist_ids', self.source_config.get('playlistIds', []))
        search_query = self.source_config.get('search_query', self.source_config.get('searchQuery'))
        max_results = int(self.source_config.get('max_results', self.source_config.get('maxResults', 10)))
        lookback_days = int(self.source_config.get('lookback_days', self.source_config.get('lookbackDays', 14)))
        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

        youtube = build('youtube', 'v3', developerKey=api_key)
        video_ids = []

        # Collect video IDs from channels
        for channel_id in channel_ids:
            try:
                video_ids.extend(_get_channel_videos(youtube, channel_id, max_results, cutoff))
            except Exception as e:
                logger.error(f"Error fetching channel {channel_id}: {e}")

        # Collect video IDs from playlists
        for playlist_id in playlist_ids:
            try:
                video_ids.extend(_get_playlist_videos(youtube, playlist_id, max_results, cutoff))
            except Exception as e:
                logger.error(f"Error fetching playlist {playlist_id}: {e}")

        # Search query
        if search_query and not (channel_ids or playlist_ids):
            try:
                video_ids.extend(_search_videos(youtube, search_query, max_results, cutoff))
            except Exception as e:
                logger.error(f"Error searching YouTube: {e}")

        # Deduplicate video IDs
        video_ids = list(dict.fromkeys(video_ids))

        # Build RawItems
        items = []
        for video_id, published_at, title, description in video_ids:
            content = _get_transcript(video_id)
            if content:
                source = 'transcript'
            else:
                content = description or title
                source = 'description'

            items.append(RawItem(
                title=title,
                url=f"https://www.youtube.com/watch?v={video_id}",
                content=content,
                source_type=SourceType.YOUTUBE,
                published_at=published_at,
                metadata={'video_id': video_id, 'content_source': source},
            ))

        logger.info(f"Fetched {len(items)} YouTube videos")
        return items


def _get_channel_videos(youtube, channel_id: str, max_results: int, cutoff: datetime) -> list:
    """Get recent video IDs, titles, descriptions from a channel."""
    resp = youtube.search().list(
        part='snippet',
        channelId=channel_id,
        order='date',
        type='video',
        maxResults=max_results,
        publishedAfter=cutoff.strftime('%Y-%m-%dT%H:%M:%SZ'),
    ).execute()
    return _parse_search_results(resp)


def _get_playlist_videos(youtube, playlist_id: str, max_results: int, cutoff: datetime) -> list:
    """Get video IDs from a playlist."""
    resp = youtube.playlistItems().list(
        part='snippet,contentDetails',
        playlistId=playlist_id,
        maxResults=max_results,
    ).execute()
    results = []
    for item in resp.get('items', []):
        snippet = item.get('snippet', {})
        video_id = item.get('contentDetails', {}).get('videoId') or snippet.get('resourceId', {}).get('videoId')
        if not video_id:
            continue
        published_str = snippet.get('publishedAt', '')
        try:
            published_at = datetime.fromisoformat(published_str.replace('Z', '+00:00'))
        except Exception:
            published_at = None
        if published_at and published_at < cutoff:
            continue
        results.append((video_id, published_at, snippet.get('title', ''), snippet.get('description', '')))
    return results


def _search_videos(youtube, query: str, max_results: int, cutoff: datetime) -> list:
    resp = youtube.search().list(
        part='snippet', q=query, order='date', type='video', maxResults=max_results,
        publishedAfter=cutoff.strftime('%Y-%m-%dT%H:%M:%SZ'),
    ).execute()
    return _parse_search_results(resp)


def _parse_search_results(resp: dict) -> list:
    results = []
    for item in resp.get('items', []):
        video_id = item.get('id', {}).get('videoId')
        if not video_id:
            continue
        snippet = item.get('snippet', {})
        published_str = snippet.get('publishedAt', '')
        try:
            published_at = datetime.fromisoformat(published_str.replace('Z', '+00:00'))
        except Exception:
            published_at = None
        results.append((video_id, published_at, snippet.get('title', ''), snippet.get('description', '')))
    return results


def _get_transcript(video_id: str) -> Optional[str]:
    """Get video transcript. Returns concatenated text or None."""
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US', 'en-GB'])
        text = ' '.join(seg['text'] for seg in transcript_list)
        return text if len(text.strip()) > 50 else None
    except (NoTranscriptFound, TranscriptsDisabled):
        return None
    except Exception as e:
        logger.debug(f"Transcript unavailable for {video_id}: {e}")
        return None
