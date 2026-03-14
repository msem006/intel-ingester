import hashlib
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

def chunk_text(text: str, max_tokens: int = 512, overlap_tokens: int = 50) -> list[str]:
    """
    Split text into chunks of max_tokens with overlap_tokens of overlap.
    Uses tiktoken cl100k_base encoding for accurate token counting.
    Returns list of text chunks.
    """
    try:
        import tiktoken
        enc = tiktoken.get_encoding('cl100k_base')
    except ImportError:
        # Fallback: approximate 1 token ≈ 4 chars
        return _chunk_text_approx(text, max_tokens, overlap_tokens)

    tokens = enc.encode(text)
    if len(tokens) <= max_tokens:
        return [text]

    chunks = []
    start = 0
    while start < len(tokens):
        end = min(start + max_tokens, len(tokens))
        chunk_tokens = tokens[start:end]
        chunk_text = enc.decode(chunk_tokens)
        chunks.append(chunk_text)
        if end >= len(tokens):
            break
        start = end - overlap_tokens  # overlap for context continuity
    return chunks

def _chunk_text_approx(text: str, max_tokens: int, overlap_tokens: int) -> list[str]:
    """Approximate chunking without tiktoken (4 chars ≈ 1 token)."""
    max_chars = max_tokens * 4
    overlap_chars = overlap_tokens * 4
    if len(text) <= max_chars:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        chunks.append(text[start:end])
        if end >= len(text):
            break
        start = end - overlap_chars
    return chunks

def count_tokens(text: str) -> int:
    """Count tokens in text using tiktoken cl100k_base."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding('cl100k_base')
        return len(enc.encode(text))
    except ImportError:
        return len(text) // 4  # fallback approximation

def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """Truncate text to at most max_tokens tokens."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding('cl100k_base')
        tokens = enc.encode(text)
        if len(tokens) <= max_tokens:
            return text
        return enc.decode(tokens[:max_tokens])
    except ImportError:
        max_chars = max_tokens * 4
        return text[:max_chars]

def clean_html(html: str) -> str:
    """
    Extract clean text from HTML.
    Tries trafilatura first (best quality), falls back to BeautifulSoup.
    Returns plain text with whitespace normalised.
    """
    if not html or not html.strip():
        return ''

    # Try trafilatura first
    try:
        import trafilatura
        result = trafilatura.extract(html, include_comments=False, include_tables=True)
        if result and len(result.strip()) > 50:
            return _normalise_whitespace(result)
    except Exception:
        pass

    # Fallback: BeautifulSoup
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        # Remove script and style elements
        for element in soup(['script', 'style', 'nav', 'footer', 'header']):
            element.decompose()
        text = soup.get_text(separator=' ')
        return _normalise_whitespace(text)
    except Exception:
        pass

    # Last resort: strip HTML tags with regex
    text = re.sub(r'<[^>]+>', ' ', html)
    return _normalise_whitespace(text)

def _normalise_whitespace(text: str) -> str:
    """Collapse multiple whitespace chars into single space, strip leading/trailing."""
    return re.sub(r'\s+', ' ', text).strip()

def compute_content_hash(url: str, content: str) -> str:
    """
    Compute SHA-256 hash of normalised url + content.
    Used for deduplication across sources (same article = same hash).
    Normalisation: lowercase URL, collapse whitespace in content.
    """
    normalised_url = url.lower().strip()
    normalised_content = _normalise_whitespace(content)[:2000]  # first 2000 chars sufficient for dedup
    combined = f"{normalised_url}::{normalised_content}"
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()
