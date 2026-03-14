import boto3, os
from boto3.dynamodb.conditions import Key, Attr
from typing import Optional, Any
from functools import lru_cache

ENV = os.environ.get('ENV', 'prod')
_TABLE_NAME_ENV = os.environ.get('DYNAMO_TABLE_NAME')

@lru_cache(maxsize=1)
def _get_table_name() -> str:
    if _TABLE_NAME_ENV:
        return _TABLE_NAME_ENV
    from .secrets import get_ssm_parameter
    return get_ssm_parameter(f'/intel-ingester/{ENV}/config/table-name')

@lru_cache(maxsize=1)
def get_table():
    """Get the DynamoDB Table resource (cached for Lambda warm reuse)."""
    dynamodb = boto3.resource('dynamodb')
    return dynamodb.Table(_get_table_name())

def put_item(item: dict) -> None:
    get_table().put_item(Item=item)

def get_item(pk: str, sk: str) -> Optional[dict]:
    resp = get_table().get_item(Key={'PK': pk, 'SK': sk})
    return resp.get('Item')

def delete_item(pk: str, sk: str) -> None:
    get_table().delete_item(Key={'PK': pk, 'SK': sk})

def update_item(pk: str, sk: str, updates: dict) -> dict:
    """Update item attributes. updates is a dict of {attribute_name: new_value}."""
    if not updates:
        return {}
    set_expr = ', '.join(f'#{k} = :{k}' for k in updates)
    expr_names = {f'#{k}': k for k in updates}
    expr_values = {f':{k}': v for k, v in updates.items()}
    resp = get_table().update_item(
        Key={'PK': pk, 'SK': sk},
        UpdateExpression=f'SET {set_expr}',
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues='ALL_NEW',
    )
    return resp.get('Attributes', {})

def query_pk(pk: str, sk_prefix: Optional[str] = None, limit: int = 100) -> list[dict]:
    """Query by PK, optionally with SK begins_with filter."""
    kwargs = dict(KeyConditionExpression=Key('PK').eq(pk), Limit=limit)
    if sk_prefix:
        kwargs['KeyConditionExpression'] &= Key('SK').begins_with(sk_prefix)
    resp = get_table().query(**kwargs)
    return resp.get('Items', [])

def query_gsi(
    index_name: str,
    pk_name: str,
    pk_value: str,
    sk_name: Optional[str] = None,
    sk_condition=None,  # boto3 Key condition
    filter_expression=None,
    limit: int = 100,
) -> list[dict]:
    """Query a GSI by its PK, with optional SK condition."""
    key_cond = Key(pk_name).eq(pk_value)
    if sk_name and sk_condition is not None:
        key_cond = key_cond & sk_condition
    kwargs = dict(IndexName=index_name, KeyConditionExpression=key_cond, Limit=limit)
    if filter_expression is not None:
        kwargs['FilterExpression'] = filter_expression
    resp = get_table().query(**kwargs)
    return resp.get('Items', [])
