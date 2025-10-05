FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the runner script
COPY runner.py .

# Copy FMEL library (will be mounted from shared)
COPY --from=shared /shared/fmel-library /app/fmel-library
RUN pip install -e /app/fmel-library

# Create directories for agent code and data
RUN mkdir -p /app/strategies /app/data /app/output

# Copy historical data (if available)
COPY data/ /app/data/

# Copy symbols configuration
COPY symbols.txt .

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV MODE=BACKTEST

# Run the backtesting script
CMD ["python", "runner.py"]