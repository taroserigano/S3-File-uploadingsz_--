# ── Backend (FastAPI / Python) ───────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# System deps for psycopg2, faiss, etc.
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create non-root user and data directory
RUN addgroup --system app && adduser --system --ingroup app app && \
    mkdir -p /app/data /home/app/.cache && \
    chown -R app:app /app/data /home/app

ENV HOME=/home/app
ENV HF_HOME=/home/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/home/app/.cache/huggingface

USER app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
