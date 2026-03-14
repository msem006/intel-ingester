FROM python:3.12-slim
WORKDIR /app
COPY shared/ shared/
RUN pip install --no-cache-dir -e shared/
COPY workers/pdf/ workers/pdf/
RUN pip install --no-cache-dir -r workers/pdf/requirements.txt
WORKDIR /app/workers/pdf
ENV PYTHONPATH=/app
ENTRYPOINT ["python", "entrypoint.py"]
