FROM python:3.12-slim

WORKDIR /app

# Copy shared package and install it first (layer caching)
COPY shared/ shared/
RUN pip install --no-cache-dir -e shared/

# Copy worker code and install its dependencies
COPY workers/rss/ workers/rss/
RUN pip install --no-cache-dir -r workers/rss/requirements.txt

WORKDIR /app/workers/rss
ENV PYTHONPATH=/app

ENTRYPOINT ["python", "entrypoint.py"]
