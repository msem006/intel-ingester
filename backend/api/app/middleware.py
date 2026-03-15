import os
import logging
from functools import lru_cache
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from intel_shared.clients.secrets import get_ssm_parameter

logger = logging.getLogger(__name__)
ENV = os.environ.get('ENV', 'prod')

# Paths that don't require X-API-Key
_PUBLIC_PATHS = {'/auth/login', '/auth/logout', '/health', '/'}


@lru_cache(maxsize=1)
def _get_api_key() -> str:
    return get_ssm_parameter(f'/intel-ingester/{ENV}/auth/api-key')


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in _PUBLIC_PATHS or request.method == 'OPTIONS':
            return await call_next(request)
        api_key = request.headers.get('X-API-Key')
        if not api_key or api_key != _get_api_key():
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing X-API-Key"})
        return await call_next(request)
