"""
Manual ingestion worker — processes content submitted via the API (paste or URL).

The API writes pending items to the SOURCE entity's config.pending_items list.
This worker reads that list, processes each item, then clears pending_items.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from intel_shared.clients.dynamo import update_item
from intel_shared.models.dynamo import SourceType, source_pk, source_sk
from workers.base.base_worker import BaseWorker, RawItem

logger = logging.getLogger(__name__)


class ManualWorker(BaseWorker):
    """
    Processes manually submitted content items.

    Source config (dynamic, written by API):
      pending_items: list[{title: str, url?: str, text?: str}]

    After processing, pending_items is cleared from the SOURCE entity.
    """

    def fetch_items(self) -> list[RawItem]:
        pending = self.source_config.get('pending_items', [])
        if not pending:
            logger.info("No pending items to process")
            return []

        items = []
        for pending_item in pending:
            title = pending_item.get('title', 'Manual submission')
            url = pending_item.get('url', '')
            text = pending_item.get('text', '')

            content = None

            # If URL provided, try to fetch full text
            if url:
                content = _fetch_url_content(url)
                if not content:
                    logger.warning(f"Could not fetch content from URL: {url}")

            # Use provided text as fallback or primary content
            if not content and text:
                content = text

            if not content:
                logger.warning(f"No content for manual item: {title}")
                continue

            items.append(RawItem(
                title=title,
                url=url or f"manual://{self.topic_id}/{len(items)}",
                content=content,
                source_type=SourceType.MANUAL,
                published_at=datetime.now(timezone.utc),
                metadata={'submission_type': 'url' if url else 'text'},
            ))

        # Clear pending_items from SOURCE entity after successful fetch
        # (run() will process and persist; if an error occurs before this,
        # items will be retried on next run — acceptable for manual submissions)
        if items:
            self._clear_pending_items()

        logger.info(f"Prepared {len(items)} manual items for ingestion")
        return items

    def _clear_pending_items(self) -> None:
        """Clear pending_items from the SOURCE config after processing."""
        try:
            # Read current source, update config with empty pending_items
            from intel_shared.clients.dynamo import get_item
            source = get_item(source_pk(self.topic_id), source_sk(self.source_id))
            if source:
                current_config = source.get('config', {})
                if isinstance(current_config, str):
                    current_config = json.loads(current_config)
                current_config['pending_items'] = []
                update_item(
                    source_pk(self.topic_id),
                    source_sk(self.source_id),
                    {'config': current_config},
                )
        except Exception as e:
            logger.warning(f"Could not clear pending_items: {e}")


def _fetch_url_content(url: str) -> Optional[str]:
    """Fetch full text from URL via trafilatura."""
    try:
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded, include_comments=False)
            if text and len(text.strip()) > 50:
                return text
    except Exception as e:
        logger.debug(f"trafilatura failed for {url}: {e}")
    return None
