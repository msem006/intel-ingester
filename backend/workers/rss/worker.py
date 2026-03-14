"""RSS/blog/news ingestion worker using feedparser + trafilatura."""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import feedparser
import trafilatura

from intel_shared.models.dynamo import SourceType
from workers.base.base_worker import BaseWorker, RawItem

logger = logging.getLogger(__name__)


class RssWorker(BaseWorker):
    """
    Ingests articles from RSS/Atom feeds (blogs, news sites).

    Source config (stored in DynamoDB SOURCE entity config field):
      feed_url: str          - RSS/Atom feed URL
      lookback_days: int     - how many days back to fetch (default 7)
      max_items: int         - max articles to ingest per run (default 50)
    """

    def fetch_items(self) -> list[RawItem]:
        feed_url = self.source_config.get('feed_url') or self.source_config.get('feedUrl')
        if not feed_url:
            logger.error("No feed_url in source config")
            return []

        lookback_days = int(self.source_config.get('lookback_days', self.source_config.get('lookbackDays', 7)))
        max_items = int(self.source_config.get('max_items', self.source_config.get('maxItems', 50)))
        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)

        logger.info(f"Parsing feed: {feed_url} (lookback={lookback_days}d max={max_items})")
        feed = feedparser.parse(feed_url)

        if feed.bozo and not feed.entries:
            logger.error(f"Feed parse error: {feed_url}: {feed.get('bozo_exception', 'unknown')}")
            return []

        items = []
        for entry in feed.entries[:max_items * 2]:  # fetch extra to account for filtered items
            published_at = _parse_entry_date(entry)
            if published_at and published_at < cutoff:
                continue  # skip items older than lookback window

            url = entry.get('link', '')
            if not url:
                continue

            title = entry.get('title', 'Untitled')

            # Fetch full article text via trafilatura; fall back to feed summary
            content = _fetch_full_text(url) or _get_feed_summary(entry)
            if not content:
                logger.debug(f"Skipping entry with no content: {url}")
                continue

            items.append(RawItem(
                title=title,
                url=url,
                content=content,
                source_type=SourceType.RSS,
                published_at=published_at,
                metadata={
                    'feed_url': feed_url,
                    'feed_title': feed.feed.get('title', ''),
                },
            ))

            if len(items) >= max_items:
                break

        logger.info(f"Fetched {len(items)} RSS items from {feed_url}")
        return items


def _parse_entry_date(entry) -> Optional[datetime]:
    """Parse publication date from feedparser entry. Returns UTC datetime or None."""
    for attr in ('published_parsed', 'updated_parsed', 'created_parsed'):
        parsed = getattr(entry, attr, None)
        if parsed:
            import time
            try:
                ts = time.mktime(parsed)
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            except Exception:
                continue
    return None


def _fetch_full_text(url: str) -> Optional[str]:
    """Fetch and extract full article text via trafilatura."""
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded, include_comments=False, include_tables=True)
            if text and len(text.strip()) > 100:
                return text
    except Exception as e:
        logger.debug(f"trafilatura failed for {url}: {e}")
    return None


def _get_feed_summary(entry) -> str:
    """Extract text from feed entry summary/content fields."""
    # Try content first (full article in some feeds), then summary
    if hasattr(entry, 'content') and entry.content:
        return entry.content[0].get('value', '')
    return entry.get('summary', '')
