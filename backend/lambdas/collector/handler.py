"""Collector Lambda — Step Functions states 1+2: Collect + Assemble.

Input event (from Step Functions start):
    {
        "topic_id": "01ABC...",
        "window_days": 7,
        "min_score": 6,
        "max_tokens": 50000
    }

Steps:
  1. Query GSI2 for SCORED items per score level (parallel, 5 workers).
  2. Deduplicate by item_id.
  3. Sort by GSI2SK descending (score DESC, then created_at DESC).
  4. Fetch raw S3 content for each item, accumulating tokens until budget exhausted.
  5. Return assembled payload for the synthesis state.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from boto3.dynamodb.conditions import Key

from intel_shared.clients.dynamo import get_table, get_item
from intel_shared.clients.s3 import get_raw_object
from intel_shared.models.dynamo import item_pk, item_sk
from intel_shared.utils.text import count_tokens, clean_html

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event, context) -> dict:
    topic_id = event['topic_id']
    window_days = event.get('window_days', 7)
    min_score = event.get('min_score', 6)
    max_tokens = event.get('max_tokens', 50000)

    logger.info(f"Collecting items: topic={topic_id} window={window_days}d min_score={min_score}")

    # 1. Parallel queries — one per score level to avoid FilterExpression waste
    scores = list(range(min_score, 11))  # e.g. [6, 7, 8, 9, 10]
    all_items: list[dict] = []

    def fetch_score(score: int) -> list[dict]:
        return _query_by_score(topic_id, score, window_days)

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fetch_score, s): s for s in scores}
        for future in as_completed(futures):
            all_items.extend(future.result())

    # 2. Deduplicate by item_id (derived from SK = "ITEM#{item_id}")
    seen: dict[str, dict] = {}
    for item in all_items:
        iid = item.get('SK', '').replace('ITEM#', '')
        if iid and iid not in seen:
            seen[iid] = item

    # 3. Sort by GSI2SK descending — encodes score + datetime so string sort
    #    yields score DESC, then created_at DESC within each score bucket.
    sorted_items = sorted(seen.values(), key=lambda x: x.get('GSI2SK', ''), reverse=True)
    logger.info(f"Found {len(sorted_items)} unique scored items")

    # 4. Assemble items up to max_tokens budget
    assembled: list[dict] = []
    total_tokens = 0

    for dynamo_item in sorted_items:
        item_id = dynamo_item.get('SK', '').replace('ITEM#', '')
        if not item_id:
            continue

        # Fetch full item record to get raw_s3_key, title, url, score
        full_item = get_item(item_pk(topic_id), item_sk(item_id))
        if not full_item:
            continue

        raw_s3_key = full_item.get('raw_s3_key')
        if not raw_s3_key:
            continue

        try:
            raw_bytes = get_raw_object(raw_s3_key)
            raw_payload = json.loads(raw_bytes)
            text = raw_payload.get('content', '')
        except Exception as e:
            logger.warning(f"Could not read S3 content for {item_id}: {e}")
            continue

        # Clean HTML if the content looks like markup
        if text.strip().startswith('<'):
            text = clean_html(text)

        item_tokens = count_tokens(text)
        if total_tokens + item_tokens > max_tokens:
            logger.info(f"Token budget reached at {total_tokens}/{max_tokens}, stopping")
            break

        assembled.append({
            'item_id': item_id,
            'title': full_item.get('title', ''),
            'url': full_item.get('url', ''),
            'score': float(full_item.get('score', 0)),
            'published_at': full_item.get('published_at', full_item.get('created_at', '')),
            'text': text,
        })
        total_tokens += item_tokens

    logger.info(f"Assembled {len(assembled)} items, {total_tokens} total tokens")

    return {
        'topic_id': topic_id,
        'window_days': window_days,
        'item_count': len(assembled),
        'total_tokens': total_tokens,
        'items': assembled,
    }


def _query_by_score(topic_id: str, score: int, window_days: int) -> list[dict]:
    """Query GSI2 for all items matching a specific score within the topic.

    Uses begins_with on GSI2SK (format: "{score:02d}#{iso_datetime}") to restrict
    the query to a single score bucket without a FilterExpression scan.
    """
    score_prefix = f"{score:02d}#"
    try:
        resp = get_table().query(
            IndexName='GSI2',
            KeyConditionExpression=(
                Key('GSI2PK').eq(f"TOPIC#{topic_id}") &
                Key('GSI2SK').begins_with(score_prefix)
            ),
        )
        return resp.get('Items', [])
    except Exception as e:
        logger.error(f"GSI2 query failed for score={score}: {e}")
        return []
