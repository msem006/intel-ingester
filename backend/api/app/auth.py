import os
import logging
from typing import Optional

import bcrypt
from fastapi import Cookie, HTTPException, Response
from itsdangerous import TimestampSigner, SignatureExpired, BadSignature

from intel_shared.clients.secrets import get_ssm_parameter

logger = logging.getLogger(__name__)
ENV = os.environ.get('ENV', 'prod')

SESSION_COOKIE = 'intel_session'
SESSION_MAX_AGE = 86400  # 24 hours


def _get_signer() -> TimestampSigner:
    secret = get_ssm_parameter(f'/intel-ingester/{ENV}/auth/session-secret')
    return TimestampSigner(secret)


def create_session_cookie(response: Response) -> None:
    token = _get_signer().sign('authenticated').decode()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=True,
        samesite='strict',
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE)


def verify_session(intel_session: Optional[str] = Cookie(default=None)) -> str:
    """FastAPI dependency — verifies session cookie. Raises 401 if invalid."""
    if not intel_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        _get_signer().unsign(intel_session, max_age=SESSION_MAX_AGE)
        return 'main'  # user_id always 'main' for single-user tool
    except (SignatureExpired, BadSignature):
        raise HTTPException(status_code=401, detail="Session expired or invalid")


def check_password(plain: str) -> bool:
    stored_hash = get_ssm_parameter(f'/intel-ingester/{ENV}/auth/password')
    try:
        return bcrypt.checkpw(plain.encode(), stored_hash.encode())
    except Exception:
        return False
