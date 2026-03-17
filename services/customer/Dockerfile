FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY ftds /app/ftds
COPY services/__init__.py /app/services/__init__.py
COPY services/customer /app/services/customer

ENV PYTHONPATH=/app

CMD ["python", "-m", "uvicorn", "services.customer.app:app", "--host", "0.0.0.0", "--port", "8005"]
