import boto3, json, os, time, logging
from botocore.config import Config
from botocore.exceptions import ClientError
from typing import Optional
from functools import lru_cache

logger = logging.getLogger(__name__)
ENV = os.environ.get('ENV', 'prod')

# Bedrock model ID defaults — overridden by SSM at first call
_DEFAULTS = {
    'synthesis': 'anthropic.claude-sonnet-4-5',
    'scoring': 'anthropic.claude-haiku-4-5-20251001',
    'embed': 'amazon.titan-embed-text-v2:0',
}

@lru_cache(maxsize=1)
def _get_model_ids() -> dict[str, str]:
    """Load model IDs from SSM. Cached after first Lambda invocation."""
    try:
        from .secrets import get_ssm_parameters_by_path
        params = get_ssm_parameters_by_path(f'/intel-ingester/{ENV}/config/')
        return {
            'synthesis': params.get('bedrock-synthesis-model', _DEFAULTS['synthesis']),
            'scoring': params.get('bedrock-scoring-model', _DEFAULTS['scoring']),
            'embed': params.get('bedrock-embed-model', _DEFAULTS['embed']),
        }
    except Exception:
        logger.warning("Could not load model IDs from SSM, using defaults")
        return _DEFAULTS.copy()

@lru_cache(maxsize=1)
def get_bedrock_client():
    return boto3.client(
        'bedrock-runtime',
        config=Config(retries={'max_attempts': 3, 'mode': 'adaptive'}),
    )

def _invoke_with_retry(func, max_retries: int = 5, base_delay: float = 1.0):
    """Retry on ThrottlingException with exponential backoff + jitter."""
    import random
    for attempt in range(max_retries):
        try:
            return func()
        except ClientError as e:
            code = e.response['Error']['Code']
            if code in ('ThrottlingException', 'ServiceUnavailableException', 'ModelErrorException'):
                if attempt == max_retries - 1:
                    raise
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Bedrock throttled (attempt {attempt + 1}), retrying in {delay:.1f}s")
                time.sleep(delay)
            else:
                raise

def invoke_claude(
    prompt: str,
    model_id: Optional[str] = None,
    max_tokens: int = 4096,
    system_prompt: Optional[str] = None,
    temperature: float = 0.3,
) -> str:
    """Invoke a Claude model via Bedrock Messages API. Returns the response text."""
    if model_id is None:
        model_id = _get_model_ids()['synthesis']

    messages = [{'role': 'user', 'content': prompt}]
    body = {
        'anthropic_version': 'bedrock-2023-05-31',
        'max_tokens': max_tokens,
        'temperature': temperature,
        'messages': messages,
    }
    if system_prompt:
        body['system'] = system_prompt

    def _call():
        resp = get_bedrock_client().invoke_model(
            modelId=model_id,
            body=json.dumps(body),
            contentType='application/json',
            accept='application/json',
        )
        result = json.loads(resp['body'].read())
        return result['content'][0]['text']

    return _invoke_with_retry(_call)

def invoke_titan_embed(text: str) -> list[float]:
    """Embed text using Bedrock Titan Embed v2. Returns 1536-dim float vector."""
    model_id = _get_model_ids()['embed']
    body = {'inputText': text[:8000]}  # Titan v2 max input

    def _call():
        resp = get_bedrock_client().invoke_model(
            modelId=model_id,
            body=json.dumps(body),
            contentType='application/json',
            accept='application/json',
        )
        result = json.loads(resp['body'].read())
        return result['embedding']

    return _invoke_with_retry(_call)

def get_scoring_model_id() -> str:
    return _get_model_ids()['scoring']
