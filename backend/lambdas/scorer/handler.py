import json
import logging
import re
from datetime import datetime, timezone

from intel_shared.clients.bedrock import invoke_claude, get_scoring_model_id
from intel_shared.clients.dynamo import get_item, update_item
from intel_shared.clients.s3 import get_raw_object
from intel_shared.models.dynamo import (
    ItemStatus,
    item_pk, item_sk, gsi1_pk, gsi1_sk, gsi2_pk, gsi2_sk,
    topic_pk, topic_sk,
)
from intel_shared.utils.text import truncate_to_tokens

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

USER_ID = 'main'  # single-user tool


def handler(event, context):
    for record in event['Records']:
        body = json.loads(record['body'])
        _score_item(body['item_id'], body['topic_id'])


def _score_item(item_id: str, topic_id: str) -> None:
    logger.info(f"Scoring item {item_id} for topic {topic_id}")

    # Get item
    dynamo_item = get_item(item_pk(topic_id), item_sk(item_id))
    if not dynamo_item:
        raise ValueError(f"Item not found: {item_id}")

    # Get topic — PK=USER#main, SK=TOPIC#{topic_id}
    dynamo_topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    topic_name = dynamo_topic.get('name', topic_id) if dynamo_topic else topic_id
    topic_description = dynamo_topic.get('description', '') if dynamo_topic else ''

    # Get text for scoring: prefer clean_text, fall back to raw S3 object
    text = dynamo_item.get('clean_text', '')
    if len(text) < 100 and dynamo_item.get('raw_s3_key'):
        try:
            raw_bytes = get_raw_object(dynamo_item['raw_s3_key'])
            raw_payload = json.loads(raw_bytes)
            text = raw_payload.get('content', text)
        except Exception:
            pass  # use clean_text fallback

    text_excerpt = truncate_to_tokens(text, max_tokens=500)  # ~2000 chars

    # Build scoring prompt
    prompt = f"""Topic: {topic_name}
Description: {topic_description}

Content title: {dynamo_item.get('title', '')}
Content (excerpt): {text_excerpt}

Score this content's relevance to the topic from 0 to 10, where:
- 10: Directly about the topic, high-quality, actionable insights
- 7-9: Closely related, useful context
- 4-6: Tangentially related, some useful information
- 1-3: Loosely related or low quality
- 0: Completely irrelevant or spam

Respond with JSON only:
{{"score": <integer 0-10>, "reason": "<max 100 chars explaining the score>"}}"""

    response = invoke_claude(
        prompt=prompt,
        model_id=get_scoring_model_id(),
        max_tokens=100,
        system_prompt="You are a relevance scorer. Respond with JSON only. No explanation outside the JSON.",
        temperature=0.1,
    )

    # Parse score — default to 5 / "parse error" if response is malformed
    score = 5
    reason = "parse error"
    try:
        # Strip markdown code fences if present
        clean_resp = re.sub(r'```(?:json)?\s*|\s*```', '', response).strip()
        result = json.loads(clean_resp)
        score = max(0, min(10, int(result.get('score', 5))))
        reason = str(result.get('reason', ''))[:100]
    except Exception as e:
        logger.warning(f"Score parse error for {item_id}: {e}. Response: {response[:200]}")

    logger.info(f"Item {item_id} scored: {score}/10 — {reason}")

    # Parse created_at from the DynamoDB item for GSI key construction
    created_at_str = dynamo_item.get('created_at', datetime.now(timezone.utc).isoformat())
    try:
        created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
    except Exception:
        created_at = datetime.now(timezone.utc)

    # Atomic UpdateItem: status + score fields + all GSI keys in one call
    update_item(item_pk(topic_id), item_sk(item_id), {
        'status': ItemStatus.SCORED.value,
        'score': float(score),
        'score_reason': reason,
        'GSI1PK': gsi1_pk(topic_id, ItemStatus.SCORED),
        'GSI1SK': gsi1_sk(created_at),
        'GSI2PK': gsi2_pk(topic_id),
        'GSI2SK': gsi2_sk(score, created_at),
    })
