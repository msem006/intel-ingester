import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import boto3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from intel_shared.clients.dynamo import put_item, get_item, delete_item, update_item, query_pk
from intel_shared.models.dynamo import (
    Topic, SourceType,
    topic_pk, topic_sk, source_pk, source_sk,
    to_dynamo_item, from_dynamo_item, new_ulid,
)
from ..auth import api_key_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/topics', tags=['topics'])
USER_ID = 'main'
ENV = os.environ.get('ENV', 'prod')

_ecs = boto3.client('ecs')
_sfn = boto3.client('stepfunctions')

ECS_CLUSTER = os.environ.get('ECS_CLUSTER', 'intel-ingester')
STATE_MACHINE_ARN = os.environ.get('STATE_MACHINE_ARN', '')


class TopicCreate(BaseModel):
    name: str
    description: str
    window_days: int = 7


class TopicUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    window_days: Optional[int] = None
    enabled: Optional[bool] = None


class SynthesiseRequest(BaseModel):
    window_days: Optional[int] = None
    min_score: int = 6


@router.get('')
def list_topics(user_id: str = Depends(api_key_user)):
    items = query_pk('USER#main', sk_prefix='TOPIC#')
    return [_dynamo_to_topic(i) for i in items]


@router.post('', status_code=201)
def create_topic(body: TopicCreate, user_id: str = Depends(api_key_user)):
    topic_id = new_ulid()
    now = datetime.now(timezone.utc)
    topic = Topic(
        user_id=USER_ID, topic_id=topic_id,
        name=body.name, description=body.description,
        window_days=body.window_days, enabled=True,
        created_at=now, updated_at=now,
    )
    pk, sk = topic_pk(USER_ID), topic_sk(topic_id)
    put_item(to_dynamo_item(topic, pk, sk))
    return _dynamo_to_topic(to_dynamo_item(topic, pk, sk))


@router.get('/{topic_id}')
def get_topic(topic_id: str, user_id: str = Depends(api_key_user)):
    item = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not item:
        raise HTTPException(404, 'Topic not found')
    return _dynamo_to_topic(item)


@router.put('/{topic_id}')
def update_topic(topic_id: str, body: TopicUpdate, user_id: str = Depends(api_key_user)):
    existing = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not existing:
        raise HTTPException(404, 'Topic not found')
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    updates['updated_at'] = datetime.now(timezone.utc).isoformat()
    updated = update_item(topic_pk(USER_ID), topic_sk(topic_id), updates)
    return _dynamo_to_topic({**existing, **updated})


@router.delete('/{topic_id}', status_code=204)
def delete_topic(topic_id: str, user_id: str = Depends(api_key_user)):
    existing = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not existing:
        raise HTTPException(404, 'Topic not found')
    delete_item(topic_pk(USER_ID), topic_sk(topic_id))


@router.post('/{topic_id}/scan', status_code=202)
def trigger_scan(topic_id: str, user_id: str = Depends(api_key_user)):
    # Get all enabled sources for this topic
    sources = query_pk(source_pk(topic_id), sk_prefix='SOURCE#')
    enabled = [s for s in sources if s.get('enabled', True)]
    if not enabled:
        return {
            'scan_id': new_ulid(),
            'topic_id': topic_id,
            'status': 'no_sources',
            'sources_triggered': 0,
            'task_arns': [],
        }

    # Map source_type to ECS task definition family name
    task_def_map = {
        'rss': 'intel-ingester-rss-worker',
        'reddit': 'intel-ingester-reddit-worker',
        'youtube': 'intel-ingester-youtube-worker',
        'podcast': 'intel-ingester-podcast-worker',
        'pdf': 'intel-ingester-pdf-worker',
        'manual': 'intel-ingester-manual-worker',
    }

    task_arns = []
    for source in enabled:
        source_id = source.get('SK', '').replace('SOURCE#', '')
        source_type = source.get('source_type', '')
        task_def = task_def_map.get(source_type)
        if not task_def:
            continue
        try:
            resp = _ecs.run_task(
                cluster=ECS_CLUSTER,
                taskDefinition=task_def,
                launchType='FARGATE',
                networkConfiguration={
                    'awsvpcConfiguration': {
                        'subnets': _get_default_subnets(),
                        'assignPublicIp': 'ENABLED',
                    }
                },
                overrides={
                    'containerOverrides': [{
                        'name': f'{source_type}Container',
                        'environment': [
                            {'name': 'TOPIC_ID', 'value': topic_id},
                            {'name': 'SOURCE_ID', 'value': source_id},
                            {'name': 'ENV', 'value': ENV},
                        ],
                    }]
                },
            )
            if resp['tasks']:
                task_arns.append(resp['tasks'][0]['taskArn'])
        except Exception as e:
            logger.error(f"Failed to launch task for source {source_id}: {e}")

    return {
        'scan_id': new_ulid(),
        'topic_id': topic_id,
        'status': 'started',
        'sources_triggered': len(task_arns),
        'task_arns': task_arns,
    }


@router.post('/{topic_id}/synthesise', status_code=202)
def trigger_synthesis(topic_id: str, body: SynthesiseRequest, user_id: str = Depends(api_key_user)):
    topic = get_item(topic_pk(USER_ID), topic_sk(topic_id))
    if not topic:
        raise HTTPException(404, 'Topic not found')
    window_days = body.window_days or int(topic.get('window_days', 7))
    resp = _sfn.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        input=json.dumps({'topic_id': topic_id, 'window_days': window_days, 'min_score': body.min_score}),
    )
    return {'execution_arn': resp['executionArn'], 'topic_id': topic_id, 'status': 'started'}


def _dynamo_to_topic(item: dict) -> dict:
    return {
        'topic_id': item.get('topic_id', item.get('SK', '').replace('TOPIC#', '')),
        'name': item.get('name', ''),
        'description': item.get('description', ''),
        'window_days': int(item.get('window_days', 7)),
        'enabled': item.get('enabled', True),
        'created_at': item.get('created_at', ''),
        'updated_at': item.get('updated_at', ''),
    }


def _get_default_subnets() -> list[str]:
    """Get default VPC public subnet IDs for RunTask."""
    try:
        ec2 = boto3.client('ec2')
        vpcs = ec2.describe_vpcs(Filters=[{'Name': 'isDefault', 'Values': ['true']}])
        if not vpcs['Vpcs']:
            return []
        vpc_id = vpcs['Vpcs'][0]['VpcId']
        subnets = ec2.describe_subnets(Filters=[
            {'Name': 'vpc-id', 'Values': [vpc_id]},
            {'Name': 'mapPublicIpOnLaunch', 'Values': ['true']},
        ])
        return [s['SubnetId'] for s in subnets['Subnets'][:2]]
    except Exception as e:
        logger.error(f"Could not get default subnets: {e}")
        return []
