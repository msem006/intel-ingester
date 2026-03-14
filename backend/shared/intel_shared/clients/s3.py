import boto3, os
from functools import lru_cache

ENV = os.environ.get('ENV', 'prod')
_RAW_BUCKET_ENV = os.environ.get('RAW_BUCKET_NAME')
_EMBEDDINGS_BUCKET_ENV = os.environ.get('EMBEDDINGS_BUCKET_NAME')

@lru_cache(maxsize=1)
def get_s3_client():
    return boto3.client('s3')

@lru_cache(maxsize=1)
def get_raw_bucket_name() -> str:
    if _RAW_BUCKET_ENV:
        return _RAW_BUCKET_ENV
    from .secrets import get_ssm_parameter
    return get_ssm_parameter(f'/intel-ingester/{ENV}/config/raw-bucket')

@lru_cache(maxsize=1)
def get_embeddings_bucket_name() -> str:
    if _EMBEDDINGS_BUCKET_ENV:
        return _EMBEDDINGS_BUCKET_ENV
    from .secrets import get_ssm_parameter
    return get_ssm_parameter(f'/intel-ingester/{ENV}/config/embeddings-bucket')

def put_raw_object(key: str, body: bytes | str, content_type: str = 'application/json') -> None:
    if isinstance(body, str):
        body = body.encode('utf-8')
    get_s3_client().put_object(Bucket=get_raw_bucket_name(), Key=key, Body=body, ContentType=content_type)

def get_raw_object(key: str) -> bytes:
    resp = get_s3_client().get_object(Bucket=get_raw_bucket_name(), Key=key)
    return resp['Body'].read()

def put_embedding_object(key: str, body: bytes | str) -> None:
    if isinstance(body, str):
        body = body.encode('utf-8')
    get_s3_client().put_object(Bucket=get_embeddings_bucket_name(), Key=key, Body=body, ContentType='application/json')

def get_embedding_object(key: str) -> bytes:
    resp = get_s3_client().get_object(Bucket=get_embeddings_bucket_name(), Key=key)
    return resp['Body'].read()
