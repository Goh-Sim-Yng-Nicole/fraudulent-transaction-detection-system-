FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/* && \
    python -m venv /opt/venv && \
    groupadd --system --gid 1001 appuser && \
    useradd --system --uid 1001 --gid appuser --home-dir /app --shell /usr/sbin/nologin appuser

COPY requirements.txt /app/requirements.txt
RUN /opt/venv/bin/pip install --upgrade pip && \
    /opt/venv/bin/pip install -r /app/requirements.txt

COPY --chown=appuser:appuser ftds /app/ftds
COPY --chown=appuser:appuser services/__init__.py /app/services/__init__.py
COPY --chown=appuser:appuser services/detect_fraud/__init__.py /app/services/detect_fraud/__init__.py
COPY --chown=appuser:appuser services/detect_fraud/app.py /app/services/detect_fraud/app.py
COPY --chown=appuser:appuser services/detect_fraud/config.py /app/services/detect_fraud/config.py
COPY --chown=appuser:appuser services/detect_fraud/circuit_breaker.py /app/services/detect_fraud/circuit_breaker.py
COPY --chown=appuser:appuser services/detect_fraud/decision_publisher.py /app/services/detect_fraud/decision_publisher.py
COPY --chown=appuser:appuser services/detect_fraud/fraud_detection_service.py /app/services/detect_fraud/fraud_detection_service.py
COPY --chown=appuser:appuser services/detect_fraud/ml_scoring_client.py /app/services/detect_fraud/ml_scoring_client.py
COPY --chown=appuser:appuser services/detect_fraud/observability.py /app/services/detect_fraud/observability.py
COPY --chown=appuser:appuser services/detect_fraud/rules_engine.py /app/services/detect_fraud/rules_engine.py
COPY --chown=appuser:appuser services/detect_fraud/velocity_store.py /app/services/detect_fraud/velocity_store.py
COPY --chown=appuser:appuser services/detect_fraud/worker.py /app/services/detect_fraud/worker.py

USER appuser

EXPOSE 8008

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8008/health/ready').status == 200 else 1)"

ENTRYPOINT ["dumb-init", "--"]
CMD ["python", "-m", "uvicorn", "services.detect_fraud.app:app", "--host", "0.0.0.0", "--port", "8008"]
