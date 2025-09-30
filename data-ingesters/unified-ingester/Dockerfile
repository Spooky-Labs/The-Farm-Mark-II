# Following proven Alpaca Market Data Ingestion patterns
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files (following original pattern)
COPY unified_market_data_ingestor.py .
COPY symbols.txt .
COPY crypto_symbols.txt .

# Create non-root user for security
RUN adduser --disabled-password --gecos '' --uid 1000 ingestor
USER ingestor

# Run the unified market data ingester
CMD ["python", "unified_market_data_ingestor.py"]