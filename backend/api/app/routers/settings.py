import logging
import os
from typing import Optional

import boto3
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from intel_shared.clients.secrets import get_ssm_parameter
from ..auth import verify_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/settings', tags=['settings'])
ENV = os.environ.get('ENV', 'prod')

_ssm = boto3.client('ssm')

_SSM_KEYS = {
    'ses_from_email': f'/intel-ingester/{ENV}/config/ses-from-email',
    'ses_to_email': f'/intel-ingester/{ENV}/config/ses-to-email',
    'default_window_days': f'/intel-ingester/{ENV}/config/default-window-days',
}


class SettingsUpdate(BaseModel):
    ses_from_email: Optional[str] = None
    ses_to_email: Optional[str] = None
    default_window_days: Optional[int] = None


@router.get('')
def get_settings(user_id: str = Depends(verify_session)):
    settings = {}
    for field, param_name in _SSM_KEYS.items():
        try:
            value = get_ssm_parameter(param_name)
            if field == 'default_window_days':
                settings[field] = int(value)
            else:
                settings[field] = value
        except Exception as e:
            logger.warning(f"Could not retrieve SSM param {param_name}: {e}")
            settings[field] = None
    return settings


@router.put('')
def update_settings(body: SettingsUpdate, user_id: str = Depends(verify_session)):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(422, 'No settings provided to update')

    for field, value in updates.items():
        param_name = _SSM_KEYS.get(field)
        if not param_name:
            continue
        try:
            _ssm.put_parameter(
                Name=param_name,
                Value=str(value),
                Type='String',
                Overwrite=True,
            )
        except Exception as e:
            logger.error(f"Failed to update SSM param {param_name}: {e}")
            raise HTTPException(500, f"Failed to update setting '{field}'")

    # Return updated settings
    return get_settings(user_id)
