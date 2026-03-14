import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from .middleware import ApiKeyMiddleware
from .routers import auth, topics, sources, items, digests, settings, ingest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title='Intel Ingester API', version='1.0.0', docs_url=None, redoc_url=None)

app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*', 'X-API-Key'])
app.add_middleware(ApiKeyMiddleware)

app.include_router(auth.router)
app.include_router(topics.router)
app.include_router(sources.router)
app.include_router(items.router)
app.include_router(digests.router)
app.include_router(settings.router)
app.include_router(ingest.router)


@app.get('/health')
def health():
    return {'status': 'ok', 'version': '1.0.0'}


handler = Mangum(app, lifespan='off')
