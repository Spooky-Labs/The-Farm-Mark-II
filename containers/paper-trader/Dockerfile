FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 trader && \
    mkdir -p /app /data && \
    chown trader:trader /app /data

# Set working directory
WORKDIR /app

# Copy shared FMEL library
COPY shared/fmel-library /app/fmel-library

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies and FMEL library
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install -e /app/fmel-library

# Copy application code
COPY paper_trader.py .
COPY pubsub_data_feed.py .
COPY alpaca_broker.py .

# Set permissions
RUN chown -R trader:trader /app

# Switch to non-root user
USER trader

# Set environment variables
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8080/health')" || exit 1

# Run paper trader
CMD ["python", "paper_trader.py"]