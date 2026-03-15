import logging
from typing import Optional

from boto3.dynamodb.conditions import Key
from fastapi import APIRouter, Depends, HTTPException, Query

from intel_shared.clients.dynamo import query_pk, query_gsi
from intel_shared.models.dynamo import (
    ItemStatus,
    topic_pk, topic_sk,
    gsi1_pk, gsi2_pk,
)
from ..auth import api_key_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/topics', tags=['items'])
USER_ID = 'main'


@router.get('/{topic_id}/items')
def list_items(
    topic_id: str,
    status: Optional[ItemStatus] = Query(default=None),
    min_score: Optional[float] = Query(default=None, ge=0, le=10),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(default=None),
    user_id: str = Depends(api_key_user),
):
    from intel_shared.clients.dynamo import get_item
    topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not topic:
        raise HTTPException(404, 'Topic not found')

    if min_score is not None:
        # GSI2: items by score for a topic; filter score >= min_score
        # GSI2SK format: "{score:02d}#{created_at}" — use begins_with on min_score prefix
        min_score_int = int(min_score)
        sk_condition = Key('GSI2SK').gte(f'{min_score_int:02d}#')
        raw_items = query_gsi(
            index_name='GSI2',
            pk_name='GSI2PK',
            pk_value=gsi2_pk(topic_id),
            sk_name='GSI2SK',
            sk_condition=sk_condition,
            limit=limit,
        )
    elif status is not None:
        # GSI1: items by status within a topic
        raw_items = query_gsi(
            index_name='GSI1',
            pk_name='GSI1PK',
            pk_value=gsi1_pk(topic_id, status),
            limit=limit,
        )
    else:
        # Main table: all items for the topic
        raw_items = query_pk(topic_pk(topic_id), sk_prefix='ITEM#', limit=limit)

    items = [_dynamo_to_item(i) for i in raw_items]

    # Simple cursor: last item_id from the result set
    next_cursor = items[-1]['item_id'] if len(items) == limit else None

    return {
        'items': items,
        'total': len(items),
        'cursor': next_cursor,
    }


def _dynamo_to_item(item: dict) -> dict:
    return {
        'item_id': item.get('item_id', item.get('SK', '').replace('ITEM#', '')),
        'topic_id': item.get('topic_id', item.get('PK', '').replace('TOPIC#', '')),
        'source_id': item.get('source_id', ''),
        'source_type': item.get('source_type', ''),
        'title': item.get('title', ''),
        'url': item.get('url', ''),
        'status': item.get('status', ItemStatus.RAW.value),
        'score': item.get('score'),
        'score_reason': item.get('score_reason'),
        'published_at': item.get('published_at'),
        'created_at': item.get('created_at', ''),
    }
