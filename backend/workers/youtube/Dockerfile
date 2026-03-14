FROM python:3.12-slim
WORKDIR /app
COPY shared/ shared/
RUN pip install --no-cache-dir -e shared/
COPY workers/youtube/ workers/youtube/
RUN pip install --no-cache-dir -r workers/youtube/requirements.txt
WORKDIR /app/workers/youtube
ENV PYTHONPATH=/app
ENTRYPOINT ["python", "entrypoint.py"]
