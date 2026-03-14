import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from intel_shared.clients.dynamo import get_item, query_pk
from intel_shared.models.dynamo import (
    topic_pk, topic_sk, digest_pk, digest_sk,
)
from ..auth import verify_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/topics', tags=['digests'])
USER_ID = 'main'


@router.get('/{topic_id}/digests')
def list_digests(
    topic_id: str,
    limit: int = Query(default=10, ge=1, le=100),
    user_id: str = Depends(verify_session),
):
    topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not topic:
        raise HTTPException(404, 'Topic not found')
    items = query_pk(digest_pk(topic_id), sk_prefix='DIGEST#', limit=limit)
    # Return newest first (ULIDs are lexicographically ordered, reverse for newest-first)
    items = list(reversed(items))
    return [_dynamo_to_digest_summary(i) for i in items]


@router.get('/{topic_id}/digests/{digest_id}')
def get_digest(
    topic_id: str,
    digest_id: str,
    user_id: str = Depends(verify_session),
):
    item = get_item(digest_pk(topic_id), digest_sk(digest_id))
    if not item:
        raise HTTPException(404, 'Digest not found')
    return _dynamo_to_digest_full(item)


def _parse_synthesis(raw_synthesis: str) -> dict:
    """Parse synthesis JSON string, returning empty structure on failure."""
    try:
        return json.loads(raw_synthesis)
    except (json.JSONDecodeError, TypeError):
        return {
            'summary': raw_synthesis or '',
            'top_trends': [],
            'key_insights': [],
            'emerging_signals': [],
            'notable_quotes': [],
            'sources': [],
        }


def _dynamo_to_digest_summary(item: dict) -> dict:
    synthesis_raw = item.get('synthesis', '{}')
    synthesis = _parse_synthesis(synthesis_raw)
    summary_text = synthesis.get('summary', '')
    # First line of summary
    first_line = summary_text.split('\n')[0] if summary_text else ''
    return {
        'digest_id': item.get('digest_id', item.get('SK', '').replace('DIGEST#', '')),
        'topic_id': item.get('topic_id', item.get('PK', '').replace('TOPIC#', '')),
        'created_at': item.get('created_at', ''),
        'window_days': int(item.get('window_days', 7)),
        'item_count': int(item.get('item_count', 0)),
        'email_sent_at': item.get('email_sent_at'),
        'summary': first_line,
    }


def _dynamo_to_digest_full(item: dict) -> dict:
    summary = _dynamo_to_digest_summary(item)
    synthesis_raw = item.get('synthesis', '{}')
    synthesis = _parse_synthesis(synthesis_raw)
    return {**summary, 'synthesis': synthesis}
