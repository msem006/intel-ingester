import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from intel_shared.clients.dynamo import put_item, get_item, delete_item, update_item, query_pk
from intel_shared.models.dynamo import (
    Source, SourceType,
    source_pk, source_sk, topic_pk, topic_sk,
    to_dynamo_item, new_ulid,
)
from ..auth import verify_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/topics', tags=['sources'])
USER_ID = 'main'


class SourceCreate(BaseModel):
    name: str
    source_type: SourceType
    config: dict


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None
    enabled: Optional[bool] = None


@router.get('/{topic_id}/sources')
def list_sources(topic_id: str, user_id: str = Depends(verify_session)):
    # Verify topic exists
    topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not topic:
        raise HTTPException(404, 'Topic not found')
    items = query_pk(source_pk(topic_id), sk_prefix='SOURCE#')
    return [_dynamo_to_source(i) for i in items]


@router.post('/{topic_id}/sources', status_code=201)
def create_source(topic_id: str, body: SourceCreate, user_id: str = Depends(verify_session)):
    # Verify topic exists
    topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not topic:
        raise HTTPException(404, 'Topic not found')
    source_id = new_ulid()
    now = datetime.now(timezone.utc)
    source = Source(
        topic_id=topic_id,
        source_id=source_id,
        name=body.name,
        source_type=body.source_type,
        config=body.config,
        enabled=True,
        created_at=now,
        updated_at=now,
    )
    pk, sk = source_pk(topic_id), source_sk(source_id)
    put_item(to_dynamo_item(source, pk, sk))
    return _dynamo_to_source(to_dynamo_item(source, pk, sk))


@router.get('/{topic_id}/sources/{source_id}')
def get_source(topic_id: str, source_id: str, user_id: str = Depends(verify_session)):
    item = get_item(source_pk(topic_id), source_sk(source_id))
    if not item:
        raise HTTPException(404, 'Source not found')
    return _dynamo_to_source(item)


@router.put('/{topic_id}/sources/{source_id}')
def update_source(topic_id: str, source_id: str, body: SourceUpdate, user_id: str = Depends(verify_session)):
    existing = get_item(source_pk(topic_id), source_sk(source_id))
    if not existing:
        raise HTTPException(404, 'Source not found')
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    updates['updated_at'] = datetime.now(timezone.utc).isoformat()
    updated = update_item(source_pk(topic_id), source_sk(source_id), updates)
    return _dynamo_to_source({**existing, **updated})


@router.delete('/{topic_id}/sources/{source_id}', status_code=204)
def delete_source(topic_id: str, source_id: str, user_id: str = Depends(verify_session)):
    existing = get_item(source_pk(topic_id), source_sk(source_id))
    if not existing:
        raise HTTPException(404, 'Source not found')
    delete_item(source_pk(topic_id), source_sk(source_id))


def _dynamo_to_source(item: dict) -> dict:
    return {
        'source_id': item.get('source_id', item.get('SK', '').replace('SOURCE#', '')),
        'topic_id': item.get('topic_id', item.get('PK', '').replace('TOPIC#', '')),
        'name': item.get('name', ''),
        'source_type': item.get('source_type', ''),
        'config': item.get('config', {}),
        'enabled': item.get('enabled', True),
        'created_at': item.get('created_at', ''),
        'updated_at': item.get('updated_at', ''),
        'last_run_at': item.get('last_run_at'),
    }
