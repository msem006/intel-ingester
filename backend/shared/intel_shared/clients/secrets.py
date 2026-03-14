# SSM and Secrets Manager access
import boto3, json, os
from functools import lru_cache

_ssm = boto3.client('ssm')
_sm = boto3.client('secretsmanager')
_param_cache: dict[str, str] = {}  # module-level cache for Lambda warm reuse

def get_ssm_parameter(name: str, use_cache: bool = True) -> str:
    """Get a single SSM parameter value. Cached by default for Lambda warm reuse."""
    if use_cache and name in _param_cache:
        return _param_cache[name]
    resp = _ssm.get_parameter(Name=name, WithDecryption=True)
    value = resp['Parameter']['Value']
    if use_cache:
        _param_cache[name] = value
    return value

def get_ssm_parameters_by_path(path: str) -> dict[str, str]:
    """Get all SSM parameters under a path prefix. Returns {name: value} dict with short names."""
    params = {}
    paginator = _ssm.get_paginator('get_parameters_by_path')
    for page in paginator.paginate(Path=path, WithDecryption=True, Recursive=True):
        for p in page['Parameters']:
            short_name = p['Name'].replace(path.rstrip('/') + '/', '')
            params[short_name] = p['Value']
            _param_cache[p['Name']] = p['Value']
    return params

def get_secret(secret_name: str) -> dict:
    """Get a Secrets Manager secret and JSON-parse it."""
    resp = _sm.get_secret_value(SecretId=secret_name)
    return json.loads(resp['SecretString'])
