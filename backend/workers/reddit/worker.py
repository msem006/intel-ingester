"""Reddit ingestion worker using PRAW."""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import praw
import trafilatura

from intel_shared.clients.secrets import get_secret
from intel_shared.models.dynamo import SourceType
from workers.base.base_worker import BaseWorker, RawItem

logger = logging.getLogger(__name__)

ENV_VAR = 'prod'


class RedditWorker(BaseWorker):
    """
    Ingests posts from subreddits using PRAW.

    Source config:
      subreddits: list[str]       - subreddit names (without r/)
      post_limit: int             - max posts per subreddit (default 25)
      min_score: int              - minimum upvote score (default 10)
      lookback_days: int          - days back to look (default 7)

    Reddit credentials from Secrets Manager: /intel-ingester/prod/reddit
      → {client_id, client_secret, user_agent}
    """

    def fetch_items(self) -> list[RawItem]:
        subreddits = self.source_config.get('subreddits', [])
        post_limit = int(self.source_config.get('post_limit', self.source_config.get('postLimit', 25)))
        min_score = int(self.source_config.get('min_score', self.source_config.get('minScore', 10)))
        lookback_days = int(self.source_config.get('lookback_days', self.source_config.get('lookbackDays', 7)))

        if not subreddits:
            logger.error("No subreddits in source config")
            return []

        # Load Reddit credentials from Secrets Manager
        import os
        env = os.environ.get('ENV', 'prod')
        creds = get_secret(f'/intel-ingester/{env}/reddit')
        reddit = praw.Reddit(
            client_id=creds['client_id'],
            client_secret=creds['client_secret'],
            user_agent=creds.get('user_agent', 'intel-ingester/1.0 (personal tool)'),
            check_for_async=False,
        )

        cutoff = datetime.now(timezone.utc) - timedelta(days=lookback_days)
        items = []

        for subreddit_name in subreddits:
            try:
                subreddit = reddit.subreddit(subreddit_name)
                for post in subreddit.new(limit=post_limit * 2):
                    published_at = datetime.fromtimestamp(post.created_utc, tz=timezone.utc)
                    if published_at < cutoff:
                        break  # new() is reverse-chronological; stop when past window

                    if post.score < min_score:
                        continue
                    if post.is_self:
                        # Self (text) post — use selftext directly
                        content = post.selftext
                    else:
                        # Link post — try to fetch the linked page
                        content = _fetch_link_content(post.url)
                        if not content:
                            content = post.selftext or post.title

                    # Append top comments for context
                    top_comments = _get_top_comments(post, max_comments=3, min_score=5)
                    if top_comments:
                        content = content + "\n\n--- Top Comments ---\n" + "\n\n".join(top_comments)

                    items.append(RawItem(
                        title=f"r/{subreddit_name}: {post.title}",
                        url=f"https://www.reddit.com{post.permalink}",
                        content=content,
                        source_type=SourceType.REDDIT,
                        published_at=published_at,
                        metadata={
                            'subreddit': subreddit_name,
                            'post_id': post.id,
                            'post_score': post.score,
                            'num_comments': post.num_comments,
                        },
                    ))

                    if len(items) >= post_limit:
                        break

            except Exception as e:
                logger.error(f"Error fetching r/{subreddit_name}: {e}", exc_info=True)

        logger.info(f"Fetched {len(items)} Reddit items from {len(subreddits)} subreddits")
        return items


def _fetch_link_content(url: str) -> Optional[str]:
    """Fetch full text of a linked page via trafilatura."""
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(downloaded, include_comments=False)
            if text and len(text.strip()) > 100:
                return text
    except Exception as e:
        logger.debug(f"trafilatura failed for {url}: {e}")
    return None


def _get_top_comments(post, max_comments: int = 3, min_score: int = 5) -> list[str]:
    """Get top-level comments sorted by score."""
    try:
        post.comments.replace_more(limit=0)  # don't load MoreComments
        top = sorted(
            [c for c in post.comments if hasattr(c, 'score') and c.score >= min_score],
            key=lambda c: c.score,
            reverse=True,
        )[:max_comments]
        return [f"[Score: {c.score}] {c.body[:500]}" for c in top]
    except Exception:
        return []
