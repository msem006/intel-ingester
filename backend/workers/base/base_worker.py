"""
Abstract base class for all Intel Ingester Fargate ingestion workers.

Every worker (RSS, Reddit, YouTube, Podcast, PDF, Manual) inherits from BaseWorker
and implements fetch_items(). The run() template method handles the full pipeline:
dedup → S3 write → DynamoDB write → SQS publish.

Workers are ECS Fargate tasks triggered on-demand via RunTask API.
They exit when done — billing stops immediately.
"""

import json
import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import boto3

from intel_shared.clients.dynamo import put_item, get_item, query_gsi
from intel_shared.clients.s3 import put_raw_object
from intel_shared.clients.secrets import get_ssm_parameter
from intel_shared.models.dynamo import (
    Item, ItemStatus, SourceType,
    item_pk, item_sk, gsi1_pk, gsi1_sk, gsi2_pk, gsi3_pk, gsi3_sk,
    to_dynamo_item, new_ulid,
)
from intel_shared.utils.config import get_config
from intel_shared.utils.text import compute_content_hash

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')


@dataclass
class RawItem:
    """A raw content item fetched by a worker, before DynamoDB/S3 writes."""
    title: str
    url: str
    content: str                          # raw text or HTML
    source_type: SourceType
    published_at: Optional[datetime] = None
    metadata: dict = field(default_factory=dict)
    # Set by base class after content_hash computed:
    id: str = field(default_factory=new_ulid)
    content_hash: str = ''


class BaseWorker(ABC):
    """
    Abstract base for all ingestion workers.

    Subclasses must implement fetch_items() and set self.source_type.
    The run() method orchestrates the full pipeline for each item.

    Environment variables expected (set by ECS task definition / RunTask):
      TOPIC_ID   - the topic this worker is scanning for
      SOURCE_ID  - the source configuration entity ID
      ENV        - 'prod' (default)
    """

    def __init__(self):
        self.topic_id: str = os.environ['TOPIC_ID']
        self.source_id: str = os.environ['SOURCE_ID']
        self.env: str = os.environ.get('ENV', 'prod')
        self.config = get_config()

        self._sqs = boto3.client('sqs')
        self._transcribe = boto3.client('transcribe')
        self._to_process_queue_url: str = self.config.get('to_process_queue_url', '')

        # Load source config from DynamoDB
        from intel_shared.clients.dynamo import get_item as dynamo_get
        from intel_shared.models.dynamo import source_pk, source_sk
        source_item = dynamo_get(source_pk(self.topic_id), source_sk(self.source_id))
        self.source_config: dict = source_item.get('config', {}) if source_item else {}

        logger.info(f"Worker initialised: topic={self.topic_id} source={self.source_id}")

    @abstractmethod
    def fetch_items(self) -> list[RawItem]:
        """
        Fetch raw content items from the source.
        Returns a list of RawItem instances ready for pipeline processing.
        """
        ...

    def run(self) -> None:
        """
        Template method: fetch → dedup → S3 write → DynamoDB write → SQS publish.
        """
        logger.info(f"Starting ingestion run: topic={self.topic_id} source={self.source_id}")
        items = self.fetch_items()
        logger.info(f"Fetched {len(items)} raw items")

        processed = skipped = errors = 0
        for raw_item in items:
            try:
                # Compute content hash for dedup
                raw_item.content_hash = compute_content_hash(raw_item.url, raw_item.content)

                # Dedup check — skip if already ingested for this topic
                if self._dedup_check(raw_item.content_hash):
                    logger.debug(f"Duplicate skipped: {raw_item.url}")
                    skipped += 1
                    continue

                # Write raw content to S3
                s3_key = self._write_raw_s3(raw_item)

                # Write metadata to DynamoDB
                self._write_dynamo_metadata(raw_item, s3_key)

                # Publish to SQS to-process queue
                self._publish_to_queue(raw_item.id)

                processed += 1
                logger.info(f"Ingested item {raw_item.id}: {raw_item.title[:60]}")

            except Exception as e:
                logger.error(f"Error processing item {raw_item.url}: {e}", exc_info=True)
                errors += 1

        logger.info(
            f"Run complete: processed={processed} skipped={skipped} errors={errors}"
        )

    def _dedup_check(self, content_hash: str) -> bool:
        """
        Return True if this content already exists for this topic.
        Queries GSI3 (HASH#{hash} → TOPIC#{topic_id}).
        """
        results = query_gsi(
            index_name='GSI3',
            pk_name='GSI3PK',
            pk_value=gsi3_pk(content_hash),
            sk_name='GSI3SK',
            sk_condition=None,
            limit=1,
        )
        # Check if any result matches this topic
        target_sk = gsi3_sk(self.topic_id)  # "TOPIC#{topic_id}"
        return any(item.get('GSI3SK') == target_sk for item in results)

    def _write_raw_s3(self, raw_item: RawItem) -> str:
        """
        Write raw content to S3. Returns the S3 key.
        Path: raw/{source_type}/{topic_id}/{date}/{item_id}.json
        """
        date_str = (raw_item.published_at or datetime.now(timezone.utc)).strftime('%Y-%m-%d')
        key = f"raw/{raw_item.source_type.value}/{self.topic_id}/{date_str}/{raw_item.id}.json"
        payload = {
            'item_id': raw_item.id,
            'topic_id': self.topic_id,
            'source_id': self.source_id,
            'title': raw_item.title,
            'url': raw_item.url,
            'content': raw_item.content,
            'content_hash': raw_item.content_hash,
            'published_at': raw_item.published_at.isoformat() if raw_item.published_at else None,
            'metadata': raw_item.metadata,
        }
        put_raw_object(key, json.dumps(payload, ensure_ascii=False))
        return key

    def _write_dynamo_metadata(self, raw_item: RawItem, s3_key: str) -> None:
        """
        Write Item entity to DynamoDB with status=RAW.
        Sets all GSI keys required for downstream queries.
        """
        now = datetime.now(timezone.utc)
        item = Item(
            topic_id=self.topic_id,
            item_id=raw_item.id,
            source_id=self.source_id,
            source_type=raw_item.source_type,
            title=raw_item.title,
            url=raw_item.url,
            content_hash=raw_item.content_hash,
            published_at=raw_item.published_at,
            created_at=now,
            status=ItemStatus.RAW,
            raw_s3_key=s3_key,
            clean_text=raw_item.content[:500] if raw_item.content else None,
        )

        pk = item_pk(self.topic_id)
        sk = item_sk(raw_item.id)

        dynamo_item = to_dynamo_item(item, pk, sk, extra_keys={
            'GSI1PK': gsi1_pk(self.topic_id, ItemStatus.RAW),
            'GSI1SK': gsi1_sk(now),
            'GSI3PK': gsi3_pk(raw_item.content_hash),
            'GSI3SK': gsi3_sk(self.topic_id),
        })
        put_item(dynamo_item)

    def _publish_to_queue(self, item_id: str) -> None:
        """Publish item_id to the to-process SQS queue."""
        self._sqs.send_message(
            QueueUrl=self._to_process_queue_url,
            MessageBody=json.dumps({
                'item_id': item_id,
                'topic_id': self.topic_id,
                'source_id': self.source_id,
            }),
        )

    def _wait_for_transcript(self, job_name: str, max_wait_seconds: int = 1800) -> str:
        """
        Poll Amazon Transcribe until job COMPLETED. Returns transcript text.
        Used by PodcastWorker. Raises RuntimeError on failure or timeout.
        """
        logger.info(f"Waiting for Transcribe job: {job_name}")
        start = time.time()
        while time.time() - start < max_wait_seconds:
            resp = self._transcribe.get_transcription_job(TranscriptionJobName=job_name)
            job = resp['TranscriptionJob']
            status = job['TranscriptionJobStatus']

            if status == 'COMPLETED':
                # Read transcript from S3 URI
                transcript_uri = job['Transcript']['TranscriptFileUri']
                # transcript_uri is an HTTPS S3 URL — fetch via requests
                import urllib.request
                with urllib.request.urlopen(transcript_uri) as f:
                    transcript_json = json.loads(f.read())
                # Concatenate all transcript segments
                items = transcript_json.get('results', {}).get('transcripts', [{}])
                text = ' '.join(t.get('transcript', '') for t in items)
                logger.info(f"Transcript ready: {job_name} ({len(text)} chars)")
                return text

            elif status == 'FAILED':
                reason = job.get('FailureReason', 'unknown')
                raise RuntimeError(f"Transcribe job {job_name} failed: {reason}")

            logger.info(f"Transcribe job {job_name} status: {status}, waiting 30s...")
            time.sleep(30)

        raise RuntimeError(f"Transcribe job {job_name} timed out after {max_wait_seconds}s")
