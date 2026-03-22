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
COPY --chown=appuser:appuser services/transaction/__init__.py /app/services/transaction/__init__.py
COPY --chown=appuser:appuser services/transaction/app.py /app/services/transaction/app.py
COPY --chown=appuser:appuser services/transaction/db.py /app/services/transaction/db.py
COPY --chown=appuser:appuser services/transaction/migrate.py /app/services/transaction/migrate.py
COPY --chown=appuser:appuser services/transaction/models.py /app/services/transaction/models.py
COPY --chown=appuser:appuser services/transaction/observability.py /app/services/transaction/observability.py
COPY --chown=appuser:appuser services/transaction/store.py /app/services/transaction/store.py

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/ready').status == 200 else 1)"

ENTRYPOINT ["dumb-init", "--"]
CMD ["python", "-m", "uvicorn", "services.transaction.app:app", "--host", "0.0.0.0", "--port", "8000"]
