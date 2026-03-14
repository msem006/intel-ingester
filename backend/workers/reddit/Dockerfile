FROM python:3.12-slim

WORKDIR /app

COPY shared/ shared/
RUN pip install --no-cache-dir -e shared/

COPY workers/reddit/ workers/reddit/
RUN pip install --no-cache-dir -r workers/reddit/requirements.txt

WORKDIR /app/workers/reddit
ENV PYTHONPATH=/app

ENTRYPOINT ["python", "entrypoint.py"]
