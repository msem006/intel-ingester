import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import boto3
from jinja2 import Environment, FileSystemLoader

from intel_shared.clients.dynamo import update_item
from intel_shared.clients.secrets import get_ssm_parameter
from intel_shared.models.dynamo import digest_pk, digest_sk

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

ENV = os.environ.get('ENV', 'prod')
_ses = boto3.client('ses')

# Jinja2 environment — templates dir relative to handler.py
_TEMPLATES_DIR = Path(__file__).parent / 'templates'
_jinja_env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=True)


def handler(event, context):
    for record in event['Records']:
        # SNS record wraps the actual message
        sns_message = json.loads(record['Sns']['Message'])
        _send_digest_email(sns_message)


def _send_digest_email(message: dict) -> None:
    topic_id = message['topic_id']
    digest_id = message['digest_id']
    topic_name = message.get('topic_name', topic_id)
    synthesis_raw = message.get('synthesis', {})
    item_count = message.get('item_count', 0)
    created_at_str = message.get('created_at', datetime.now(timezone.utc).isoformat())

    # Parse synthesis (may be JSON string or dict)
    if isinstance(synthesis_raw, str):
        try:
            synthesis = json.loads(synthesis_raw)
        except Exception:
            synthesis = {
                'summary': synthesis_raw,
                'top_trends': [],
                'key_insights': [],
                'emerging_signals': [],
                'notable_quotes': [],
                'sources': [],
            }
    else:
        synthesis = synthesis_raw

    # Parse created_at
    try:
        created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
    except Exception:
        created_at = datetime.now(timezone.utc)

    # Get email addresses from SSM
    from_email = get_ssm_parameter(f'/intel-ingester/{ENV}/config/ses-from-email')
    to_email = get_ssm_parameter(f'/intel-ingester/{ENV}/config/ses-to-email')
    ses_config_set = os.environ.get('SES_CONFIG_SET', 'intel-ingester')

    # Render HTML template
    template = _jinja_env.get_template('digest.html')
    html_body = template.render(
        topic_name=topic_name,
        created_at=created_at,
        synthesis=synthesis,
        item_count=item_count,
    )

    # Send via SES
    subject = f"Intel Briefing: {topic_name} \u2014 {created_at.strftime('%d %B %Y')}"
    _ses.send_email(
        Source=from_email,
        Destination={'ToAddresses': [to_email]},
        Message={
            'Subject': {'Data': subject, 'Charset': 'UTF-8'},
            'Body': {'Html': {'Data': html_body, 'Charset': 'UTF-8'}},
        },
        ConfigurationSetName=ses_config_set,
    )
    logger.info(f"Digest email sent: {subject} \u2192 {to_email}")

    # Update Digest entity: set email_sent_at
    update_item(
        digest_pk(topic_id),
        digest_sk(digest_id),
        {'email_sent_at': datetime.now(timezone.utc).isoformat()},
    )
