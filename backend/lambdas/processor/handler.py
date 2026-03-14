import json
import logging
import os
import boto3

from intel_shared.clients.bedrock import invoke_titan_embed
from intel_shared.clients.dynamo import get_item, put_item, update_item
from intel_shared.clients.s3 import get_raw_object, put_embedding_object
from intel_shared.models.dynamo import (
    Chunk, ItemStatus,
    chunk_pk, chunk_sk, item_pk, item_sk,
    gsi1_pk, gsi1_sk,
    to_dynamo_item, new_ulid,
)
from intel_shared.utils.text import clean_html, chunk_text, count_tokens
from intel_shared.utils.config import get_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_sqs = boto3.client('sqs')


def handler(event, context):
    config = get_config()
    to_score_url = config['to_score_queue_url']

    for record in event['Records']:
        body = json.loads(record['body'])
        item_id = body['item_id']
        topic_id = body['topic_id']
        source_id = body.get('source_id', '')

        _process_item(item_id, topic_id, source_id, to_score_url)


def _process_item(item_id: str, topic_id: str, source_id: str, to_score_url: str) -> None:
    logger.info(f"Processing item {item_id} for topic {topic_id}")

    # Get Item metadata from DynamoDB
    dynamo_item = get_item(item_pk(topic_id), item_sk(item_id))
    if not dynamo_item:
        raise ValueError(f"Item not found: {item_id}")

    raw_s3_key = dynamo_item.get('raw_s3_key')
    if not raw_s3_key:
        raise ValueError(f"No raw_s3_key for item {item_id}")

    # Read raw content from S3
    raw_bytes = get_raw_object(raw_s3_key)
    raw_payload = json.loads(raw_bytes)
    content = raw_payload.get('content', '')

    # Clean HTML → plain text
    clean_text = clean_html(content) if content.strip().startswith('<') else content
    if not clean_text:
        clean_text = content  # fallback if cleaning removes everything

    # Chunk the text
    chunks = chunk_text(clean_text, max_tokens=512, overlap_tokens=50)
    logger.info(f"Split into {len(chunks)} chunks")

    embedding_prefix = f"embeddings/{topic_id}/{item_id}"

    for i, chunk_text_str in enumerate(chunks):
        # Embed via Bedrock Titan Embed v2
        embedding = invoke_titan_embed(chunk_text_str)

        # Store embedding + chunk text to S3
        embedding_key = f"{embedding_prefix}/{i:04d}.json"
        embedding_payload = {
            'item_id': item_id,
            'chunk_index': i,
            'text': chunk_text_str,
            'embedding': embedding,
            'token_count': count_tokens(chunk_text_str),
        }
        put_embedding_object(embedding_key, json.dumps(embedding_payload))

        # Write Chunk entity to DynamoDB
        chunk = Chunk(
            item_id=item_id,
            chunk_index=i,
            text=chunk_text_str[:500],  # store first 500 chars only; full text in S3
            token_count=count_tokens(chunk_text_str),
            embedding_s3_key=embedding_key,
        )
        chunk_dynamo = to_dynamo_item(chunk, chunk_pk(item_id), chunk_sk(i))
        put_item(chunk_dynamo)

    # Update Item: RAW → EMBEDDED (atomic update of status + GSI1PK)
    update_item(item_pk(topic_id), item_sk(item_id), {
        'status': ItemStatus.EMBEDDED.value,
        'GSI1PK': gsi1_pk(topic_id, ItemStatus.EMBEDDED),
        'embedding_s3_key': embedding_prefix + '/',
    })

    # Publish to to-score queue
    _sqs.send_message(
        QueueUrl=to_score_url,
        MessageBody=json.dumps({'item_id': item_id, 'topic_id': topic_id, 'source_id': source_id}),
    )
    logger.info(f"Item {item_id} processed: {len(chunks)} chunks embedded, published to scorer")
