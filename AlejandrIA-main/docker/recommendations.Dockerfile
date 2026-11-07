FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY docker/requirements-recommendations.txt /app/requirements.txt
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r /app/requirements.txt
RUN useradd --uid 10001 --no-create-home app
COPY src/api/ /app/api/
COPY src/ml/__init__.py src/ml/inference.py src/ml/collaborative.py src/ml/recommendation.py /app/ml/
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 RECOMMENDER_PROJECT_ROOT=/srv/models RECOMMENDER_DEVICE=cpu RECOMMENDER_MODEL_VERSION=v2
USER 10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--limit-concurrency", "4", "--no-access-log"]
