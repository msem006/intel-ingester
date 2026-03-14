FROM python:3.12-slim
WORKDIR /app
COPY shared/ shared/
RUN pip install --no-cache-dir -e shared/
COPY workers/manual/ workers/manual/
RUN pip install --no-cache-dir -r workers/manual/requirements.txt
WORKDIR /app/workers/manual
ENV PYTHONPATH=/app
ENTRYPOINT ["python", "entrypoint.py"]
