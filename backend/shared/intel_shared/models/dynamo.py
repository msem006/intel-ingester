"""
DynamoDB single-table schema models for IntelIngester.

Table: IntelIngester
Keys:  PK (String) | SK (String)
TTL:   ttl (Unix timestamp)

GSIs:
  GSI1  GSI1PK / GSI1SK  — Items by status within a topic
  GSI2  GSI2PK / GSI2SK  — Items by relevance score + date within a topic
  GSI3  GSI3PK / GSI3SK  — Content deduplication via sha256 hash

All entity IDs are ULIDs (lexicographic order = chronological order).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional, TypeVar

from pydantic import BaseModel, ConfigDict
from ulid import ULID


T = TypeVar("T", bound=BaseModel)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def new_ulid() -> str:
    """Generate a new ULID string. Lexicographic order = chronological order."""
    return str(ULID())


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ItemStatus(str, Enum):
    RAW = "RAW"
    EMBEDDED = "EMBEDDED"
    SCORED = "SCORED"


class SourceType(str, Enum):
    RSS = "rss"
    REDDIT = "reddit"
    YOUTUBE = "youtube"
    PODCAST = "podcast"
    PDF = "pdf"
    MANUAL = "manual"


# ---------------------------------------------------------------------------
# PK / SK key builders (pure functions — no AWS calls)
# ---------------------------------------------------------------------------

def user_pk(user_id: str) -> str:
    return f"USER#{user_id}"


def topic_pk(user_id: str) -> str:
    """Topic lives under the user partition."""
    return f"USER#{user_id}"


def topic_sk(topic_id: str) -> str:
    return f"TOPIC#{topic_id}"


def source_pk(topic_id: str) -> str:
    return f"TOPIC#{topic_id}"


def source_sk(source_id: str) -> str:
    return f"SOURCE#{source_id}"


def item_pk(topic_id: str) -> str:
    return f"TOPIC#{topic_id}"


def item_sk(item_id: str) -> str:
    return f"ITEM#{item_id}"


def chunk_pk(item_id: str) -> str:
    return f"ITEM#{item_id}"


def chunk_sk(chunk_index: int) -> str:
    return f"CHUNK#{chunk_index:04d}"


def digest_pk(topic_id: str) -> str:
    return f"TOPIC#{topic_id}"


def digest_sk(digest_id: str) -> str:
    return f"DIGEST#{digest_id}"


# ---------------------------------------------------------------------------
# GSI key builders
# ---------------------------------------------------------------------------

def gsi1_pk(topic_id: str, status: ItemStatus) -> str:
    """GSI1 partitions items by topic + status for efficient status queries."""
    return f"TOPIC#{topic_id}#STATUS#{status.value}"


def gsi1_sk(created_at: datetime) -> str:
    """GSI1 sort key — ISO-8601 timestamp for chronological ordering."""
    return created_at.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def gsi2_pk(topic_id: str) -> str:
    """GSI2 partitions items by topic for score-ranked queries."""
    return f"TOPIC#{topic_id}"


def gsi2_sk(score: int, created_at: datetime) -> str:
    """GSI2 sort key — zero-padded score prefix ensures string sort = numeric sort.

    Example: "06#2025-03-14T10:00:00.000000Z"
    """
    return f"{score:02d}#{gsi1_sk(created_at)}"


def gsi3_pk(content_hash: str) -> str:
    """GSI3 partition key — content deduplication via sha256 hash."""
    return f"HASH#{content_hash}"


def gsi3_sk(topic_id: str) -> str:
    """GSI3 sort key — allows checking if duplicate exists within a topic."""
    return f"TOPIC#{topic_id}"


# ---------------------------------------------------------------------------
# Pydantic v2 entity models
# ---------------------------------------------------------------------------

class UserProfile(BaseModel):
    """PK = USER#{user_id}, SK = PROFILE"""

    model_config = ConfigDict(populate_by_name=True)

    user_id: str
    email: Optional[str] = None
    created_at: datetime


class Topic(BaseModel):
    """PK = USER#{user_id}, SK = TOPIC#{topic_id}"""

    model_config = ConfigDict(populate_by_name=True)

    user_id: str
    topic_id: str  # ULID
    name: str
    description: str
    window_days: int = 7
    enabled: bool = True
    created_at: datetime
    updated_at: datetime


class Source(BaseModel):
    """PK = TOPIC#{topic_id}, SK = SOURCE#{source_id}"""

    model_config = ConfigDict(populate_by_name=True)

    topic_id: str
    source_id: str  # ULID
    name: str
    source_type: SourceType
    config: dict  # source-type-specific config (feedUrl, subreddits, channelIds, etc.)
    enabled: bool = True
    created_at: datetime
    updated_at: datetime
    last_run_at: Optional[datetime] = None


class Item(BaseModel):
    """PK = TOPIC#{topic_id}, SK = ITEM#{item_id}

    GSI1PK = TOPIC#{topic_id}#STATUS#{status}
    GSI1SK = {created_at ISO string}
    GSI2PK = TOPIC#{topic_id}
    GSI2SK = {score:02d}#{created_at}  (only populated when status == SCORED)
    GSI3PK = HASH#{content_hash}
    GSI3SK = TOPIC#{topic_id}

    WARNING: Status transitions (e.g. RAW -> EMBEDDED -> SCORED) MUST update
    both `status` AND `GSI1PK` in a SINGLE UpdateItem call. If these are
    updated separately, queries against GSI1 will return stale results —
    items will appear under the old status partition until the second write
    lands. Always use a single UpdateExpression that sets both attributes
    atomically.
    """

    model_config = ConfigDict(populate_by_name=True)

    topic_id: str
    item_id: str  # ULID
    source_id: str
    source_type: SourceType
    title: str
    url: str
    content_hash: str  # sha256 hex of url + normalised content
    published_at: Optional[datetime] = None
    created_at: datetime
    status: ItemStatus = ItemStatus.RAW
    raw_s3_key: Optional[str] = None
    clean_text: Optional[str] = None  # first 500 chars cached; full text in S3
    embedding_s3_key: Optional[str] = None
    score: Optional[float] = None
    score_reason: Optional[str] = None
    ttl: Optional[int] = None  # Unix timestamp; set to 90 days after creation


class Chunk(BaseModel):
    """PK = ITEM#{item_id}, SK = CHUNK#{chunk_index:04d}"""

    model_config = ConfigDict(populate_by_name=True)

    item_id: str
    chunk_index: int
    text: str
    token_count: int
    embedding_s3_key: Optional[str] = None


class Digest(BaseModel):
    """PK = TOPIC#{topic_id}, SK = DIGEST#{digest_id}"""

    model_config = ConfigDict(populate_by_name=True)

    topic_id: str
    digest_id: str  # ULID
    created_at: datetime
    window_days: int
    item_count: int
    synthesis: str  # JSON string of the full synthesis output
    email_sent_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# DynamoDB serialisation helpers
# ---------------------------------------------------------------------------

# Keys injected by to_dynamo_item that should be stripped before deserialising
_DYNAMO_KEY_FIELDS = {"PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "GSI3PK", "GSI3SK"}


def to_dynamo_item(
    entity: BaseModel,
    pk: str,
    sk: str,
    extra_keys: dict[str, str] | None = None,
) -> dict:
    """Convert a Pydantic model to a flat dict ready for DynamoDB put_item.

    - Serialises via model_dump(mode='json') so datetimes become ISO strings.
    - Omits keys whose value is None (DynamoDB best practice: don't store nulls).
    - Injects PK, SK, and any additional GSI key attributes from *extra_keys*.
    """
    data = entity.model_dump(mode="json")

    # Strip None values — no point storing empty attributes in DynamoDB
    item = {k: v for k, v in data.items() if v is not None}

    # Inject table keys
    item["PK"] = pk
    item["SK"] = sk

    # Inject GSI keys (e.g. GSI1PK, GSI1SK, GSI2PK, ...)
    if extra_keys:
        item.update(extra_keys)

    return item


def from_dynamo_item(item: dict, model_class: type[T]) -> T:
    """Convert a DynamoDB item dict back into a Pydantic model.

    - Strips PK, SK, and GSI key attributes before parsing.
    - Pydantic v2 handles ISO datetime strings -> datetime automatically.
    """
    cleaned = {k: v for k, v in item.items() if k not in _DYNAMO_KEY_FIELDS}
    return model_class.model_validate(cleaned)
