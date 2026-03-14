"""
Synthesiser Lambda — Step Functions state 3+4: Synthesise + Store.

Receives collector output (topic_id, items, item_count, total_tokens, window_days),
calls Bedrock Claude Sonnet with a synthesis prompt, stores the resulting digest to
DynamoDB, and returns the digest payload for the Notify state (SNS publish).
"""

import json
import logging
import os
import re
from datetime import datetime, timezone

from intel_shared.clients.bedrock import invoke_claude
from intel_shared.clients.dynamo import get_item, put_item
from intel_shared.models.dynamo import (
    Digest,
    digest_pk,
    digest_sk,
    new_ulid,
    to_dynamo_item,
    topic_pk,
    topic_sk,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

USER_ID = "main"
ENV = os.environ.get("ENV", "prod")

# ---------------------------------------------------------------------------
# Prompt components
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are an expert intelligence analyst producing a concise, actionable briefing \
for a knowledge worker tracking a specific topic. Your role is to synthesise \
signal from noise — identify what actually matters, surface non-obvious patterns, \
and connect dots across sources that a busy reader would miss.

Ground rules:
- Be specific and evidence-based. Every claim must trace back to a source.
- Cite sources by URL. Do not fabricate URLs or attribute quotes to the wrong source.
- Avoid vague generalities ("the landscape is evolving", "stakeholders are concerned"). \
  Replace them with concrete observations.
- If sources contradict each other, call out the tension explicitly — do not paper over it.
- Distinguish between established facts, emerging signals, and speculation.
- Write for a reader who is already knowledgeable about the topic — skip 101-level context.
- Respond with valid JSON only, matching the exact schema provided. No markdown wrapping, \
  no commentary outside the JSON object.\
"""

_USER_PROMPT_TEMPLATE = """\
TOPIC: {topic_name}
{topic_description_line}
TIME WINDOW: Last {window_days} days
SOURCE COUNT: {item_count} articles/documents

Below are the source materials, ordered by relevance score (highest first). \
Analyse them and produce a structured intelligence briefing.

{assembled_content}

---

Produce your briefing as a single JSON object with this exact schema:

{{
  "summary": "<2-3 sentence executive summary of the most important developments. \
Lead with the single most consequential finding.>",
  "top_trends": [
    {{
      "trend": "<specific, descriptive trend title — not a generic category>",
      "evidence": "<concrete evidence drawn from the sources, with specifics \
(numbers, dates, names)>",
      "source_urls": ["<url1>", "<url2>"]
    }}
  ],
  "key_insights": [
    {{
      "insight": "<specific, non-obvious insight that connects dots across sources>",
      "implication": "<what this concretely means for someone following this topic — \
an actionable takeaway, not a platitude>"
    }}
  ],
  "emerging_signals": [
    {{
      "signal": "<weak signal or early indicator worth watching>",
      "confidence": "high|medium|low"
    }}
  ],
  "notable_quotes": [
    {{
      "quote": "<verbatim quote copied exactly from the source text>",
      "source_url": "<url of the source containing the quote>",
      "attribution": "<author or publication name>"
    }}
  ],
  "sources": [
    {{
      "title": "<source title>",
      "url": "<source url>",
      "score": <relevance score as integer>
    }}
  ]
}}

Requirements:
- top_trends: 3-5 items. Each trend must cite at least one source URL.
- key_insights: 3-5 items. Focus on cross-source connections and second-order effects.
- emerging_signals: 2-4 items. These are weak signals — things that might become \
important but are not yet confirmed. Assign confidence honestly.
- notable_quotes: 2-4 items. ONLY include if verbatim quotes exist in the source \
text. Do not fabricate or paraphrase. If no verbatim quotes exist, return an empty list.
- sources: list every source you referenced, with its relevance score.
- The summary should be self-contained — someone reading only the summary should \
grasp the key developments.

Respond with the JSON object only. No preamble, no markdown fences, no trailing text.\
"""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _assemble_content(items: list[dict]) -> str:
    """Format source items into a structured block for the synthesis prompt."""
    # Sort by score descending so the model sees the most relevant material first
    sorted_items = sorted(items, key=lambda x: float(x.get("score", 0)), reverse=True)

    parts = []
    for i, item in enumerate(sorted_items, 1):
        part = (
            f"--- SOURCE {i} ---\n"
            f"Title: {item.get('title', 'Untitled')}\n"
            f"URL: {item.get('url', 'N/A')}\n"
            f"Published: {item.get('published_at', 'Unknown')}\n"
            f"Relevance Score: {item.get('score', 'N/A')}/10\n"
            f"\n"
            f"{item.get('text', '(no content)')}"
        )
        parts.append(part)

    return "\n\n".join(parts)


def _synthesise(
    topic_name: str,
    topic_description: str,
    window_days: int,
    items: list[dict],
) -> str:
    """Build the synthesis prompt, call Bedrock Claude, return raw response text."""
    assembled_content = _assemble_content(items)

    topic_description_line = (
        f"DESCRIPTION: {topic_description}" if topic_description else ""
    )

    user_prompt = _USER_PROMPT_TEMPLATE.format(
        topic_name=topic_name,
        topic_description_line=topic_description_line,
        window_days=window_days,
        item_count=len(items),
        assembled_content=assembled_content,
    )

    return invoke_claude(
        prompt=user_prompt,
        system_prompt=_SYSTEM_PROMPT,
        max_tokens=4096,
        temperature=0.4,
    )


def _parse_synthesis(raw: str) -> dict:
    """Parse the Claude synthesis response into a validated dict.

    Handles markdown code fences, validates required keys, and returns a
    minimal fallback dict on any failure so downstream consumers always
    get a consistent structure.
    """
    required_keys = {
        "summary",
        "top_trends",
        "key_insights",
        "emerging_signals",
        "notable_quotes",
        "sources",
    }

    try:
        # Strip markdown code fences if present (```json ... ``` or ``` ... ```)
        cleaned = raw.strip()
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned)
        cleaned = cleaned.strip()

        synthesis = json.loads(cleaned)

        if not isinstance(synthesis, dict):
            raise ValueError("Synthesis response is not a JSON object")

        missing = required_keys - set(synthesis.keys())
        if missing:
            logger.warning(f"Synthesis missing keys: {missing}")
            # Fill in missing keys with sensible defaults rather than failing
            for key in missing:
                if key == "summary":
                    synthesis[key] = "Synthesis completed but some fields were missing."
                else:
                    synthesis[key] = []

        return synthesis

    except (json.JSONDecodeError, ValueError) as exc:
        logger.error(f"Failed to parse synthesis output: {exc}")
        logger.debug(f"Raw synthesis response: {raw[:500]}")
        return {
            "summary": (
                "Synthesis output could not be parsed. "
                "The raw model response did not conform to the expected JSON schema."
            ),
            "top_trends": [],
            "key_insights": [],
            "emerging_signals": [],
            "notable_quotes": [],
            "sources": [],
            "_parse_error": str(exc),
        }


# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------


def handler(event, context) -> dict:
    """
    Step Functions state 3+4: Synthesise + Store.

    Input:  collector output dict (topic_id, items, item_count, total_tokens, window_days).
    Output: digest payload for the Notify state (SNS publish).
    """
    topic_id = event["topic_id"]
    items = event["items"]
    item_count = event["item_count"]
    window_days = event.get("window_days", 7)

    logger.info(
        "Synthesising: topic=%s items=%d tokens=%d",
        topic_id,
        item_count,
        event.get("total_tokens", 0),
    )

    # Get topic name + description for prompt context
    dynamo_topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    topic_name = dynamo_topic.get("name", topic_id) if dynamo_topic else topic_id
    topic_description = dynamo_topic.get("description", "") if dynamo_topic else ""

    # Build and call the synthesis prompt
    synthesis_json_str = _synthesise(topic_name, topic_description, window_days, items)

    # Parse the synthesis output
    synthesis = _parse_synthesis(synthesis_json_str)

    # Store digest to DynamoDB
    digest_id = new_ulid()
    now = datetime.now(timezone.utc)
    digest = Digest(
        topic_id=topic_id,
        digest_id=digest_id,
        created_at=now,
        window_days=window_days,
        item_count=item_count,
        synthesis=json.dumps(synthesis, ensure_ascii=False),
    )
    put_item(to_dynamo_item(digest, digest_pk(topic_id), digest_sk(digest_id)))
    logger.info("Digest stored: %s", digest_id)

    # Return payload for the Notify state (SNS publish)
    return {
        "topic_id": topic_id,
        "digest_id": digest_id,
        "topic_name": topic_name,
        "synthesis": synthesis,
        "item_count": item_count,
        "created_at": now.isoformat(),
    }
