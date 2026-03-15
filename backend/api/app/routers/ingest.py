import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import boto3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator

from intel_shared.clients.dynamo import put_item, get_item
from intel_shared.models.dynamo import (
    Item, ItemStatus, SourceType,
    topic_pk, topic_sk, item_pk, item_sk,
    gsi1_pk, gsi1_sk, gsi3_pk, gsi3_sk,
    to_dynamo_item, new_ulid,
)
from ..auth import api_key_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/topics', tags=['ingest'])
USER_ID = 'main'
ENV = os.environ.get('ENV', 'prod')

_sqs = boto3.client('sqs')
_QUEUE_URL_ENV = os.environ.get('TO_PROCESS_QUEUE_URL')


def _get_queue_url() -> str:
    if _QUEUE_URL_ENV:
        return _QUEUE_URL_ENV
    from intel_shared.clients.secrets import get_ssm_parameter
    return get_ssm_parameter(f'/intel-ingester/{ENV}/config/to-process-queue-url')


class ManualIngestRequest(BaseModel):
    title: str
    text: Optional[str] = None
    url: Optional[str] = None

    @model_validator(mode='after')
    def require_text_or_url(self):
        if not self.text and not self.url:
            raise ValueError('At least one of text or url must be provided')
        return self


@router.post('/{topic_id}/ingest', status_code=201)
def manual_ingest(
    topic_id: str,
    body: ManualIngestRequest,
    user_id: str = Depends(api_key_user),
):
    # Verify topic exists
    topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not topic:
        raise HTTPException(404, 'Topic not found')

    item_id = new_ulid()
    now = datetime.now(timezone.utc)
    url = body.url or f'manual://{topic_id}/{item_id}'

    # Compute content hash from url + text (normalised)
    hash_input = f"{url}:{body.text or ''}".lower().strip()
    content_hash = hashlib.sha256(hash_input.encode()).hexdigest()

    item = Item(
        topic_id=topic_id,
        item_id=item_id,
        source_id='manual',
        source_type=SourceType.MANUAL,
        title=body.title,
        url=url,
        content_hash=content_hash,
        created_at=now,
        status=ItemStatus.RAW,
        clean_text=body.text[:500] if body.text else None,
    )

    pk = item_pk(topic_id)
    sk = item_sk(item_id)
    extra_keys = {
        'GSI1PK': gsi1_pk(topic_id, ItemStatus.RAW),
        'GSI1SK': gsi1_sk(now),
        'GSI3PK': gsi3_pk(content_hash),
        'GSI3SK': gsi3_sk(topic_id),
    }
    put_item(to_dynamo_item(item, pk, sk, extra_keys=extra_keys))

    # Publish to to-process queue
    try:
        queue_url = _get_queue_url()
        _sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({
                'item_id': item_id,
                'topic_id': topic_id,
                'source_type': SourceType.MANUAL.value,
                'url': url,
                'text': body.text,
            }),
        )
    except Exception as e:
        logger.error(f"Failed to publish item {item_id} to queue: {e}")
        # Item is persisted; queue failure is non-fatal — worker can be retriggered

    return {'item_id': item_id}
