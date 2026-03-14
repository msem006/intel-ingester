FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared/ shared/
RUN pip install --no-cache-dir -e shared/
COPY workers/podcast/ workers/podcast/
RUN pip install --no-cache-dir -r workers/podcast/requirements.txt
WORKDIR /app/workers/podcast
ENV PYTHONPATH=/app
ENTRYPOINT ["python", "entrypoint.py"]
