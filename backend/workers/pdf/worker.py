"""PDF ingestion worker using pdfplumber."""

import io
import logging
from datetime import datetime, timezone
from typing import Optional

import pdfplumber
import requests

from intel_shared.models.dynamo import SourceType
from workers.base.base_worker import BaseWorker, RawItem

logger = logging.getLogger(__name__)


class PdfWorker(BaseWorker):
    """
    Ingests PDF documents from URLs.

    Source config:
      urls: list[str]   - List of PDF URLs to fetch and process
    """

    def fetch_items(self) -> list[RawItem]:
        urls = self.source_config.get('urls', [])
        if not urls:
            logger.warning("No PDF URLs in source config")
            return []

        items = []
        for url in urls:
            try:
                item = self._process_pdf_url(url)
                if item:
                    items.append(item)
            except Exception as e:
                logger.error(f"Error processing PDF {url}: {e}", exc_info=True)

        logger.info(f"Fetched {len(items)} PDF documents")
        return items

    def _process_pdf_url(self, url: str) -> Optional[RawItem]:
        logger.info(f"Downloading PDF: {url[:80]}")
        resp = requests.get(url, timeout=120, headers={'User-Agent': 'intel-ingester/1.0'})
        resp.raise_for_status()

        if 'pdf' not in resp.headers.get('content-type', '').lower() and not url.lower().endswith('.pdf'):
            logger.warning(f"URL may not be a PDF: {url}")

        text = _extract_pdf_text(resp.content)
        if not text or len(text.strip()) < 50:
            logger.warning(f"Could not extract text from PDF: {url}")
            return None

        # Use URL as title (last path segment)
        title = url.rstrip('/').split('/')[-1].replace('.pdf', '').replace('-', ' ').replace('_', ' ')
        if not title:
            title = url

        return RawItem(
            title=title,
            url=url,
            content=text,
            source_type=SourceType.PDF,
            published_at=datetime.now(timezone.utc),
            metadata={'url': url, 'content_length': len(resp.content)},
        )


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes using pdfplumber."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages.append(text.strip())
            return '\n\n'.join(pages)
    except Exception as e:
        logger.error(f"pdfplumber extraction failed: {e}")
        return ''
