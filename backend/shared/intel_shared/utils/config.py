import os
import logging
from functools import lru_cache

logger = logging.getLogger(__name__)
ENV = os.environ.get('ENV', 'prod')

@lru_cache(maxsize=1)
def get_config() -> dict:
    """
    Load all runtime config from SSM Parameter Store.
    Cached after first call (Lambda warm reuse).

    Returns a flat dict with these keys:
      table_name, raw_bucket, embeddings_bucket,
      bedrock_synthesis_model, bedrock_scoring_model, bedrock_embed_model,
      to_process_queue_url, to_score_queue_url,
      ses_from_email, ses_to_email, default_window_days

    SSM path: /intel-ingester/{ENV}/config/
    Short key names are derived by stripping the path prefix.
    Converts hyphens to underscores in key names.
    """
    try:
        from ..clients.secrets import get_ssm_parameters_by_path
        params = get_ssm_parameters_by_path(f'/intel-ingester/{ENV}/config/')
        # Normalise keys: hyphen → underscore
        return {k.replace('-', '_'): v for k, v in params.items()}
    except Exception as e:
        logger.error(f"Failed to load config from SSM: {e}")
        # Return env-var fallbacks for local development
        return {
            'table_name': os.environ.get('DYNAMO_TABLE_NAME', 'IntelIngester'),
            'raw_bucket': os.environ.get('RAW_BUCKET_NAME', ''),
            'embeddings_bucket': os.environ.get('EMBEDDINGS_BUCKET_NAME', ''),
            'to_process_queue_url': os.environ.get('TO_PROCESS_QUEUE_URL', ''),
            'to_score_queue_url': os.environ.get('TO_SCORE_QUEUE_URL', ''),
        }
