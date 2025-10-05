# Agents Service - Cloud Run Container
FROM node:20-slim

# Install security updates
RUN apt-get update && apt-get upgrade -y && apt-get clean

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser
USER appuser

# Expose port (Cloud Run uses PORT env variable)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1);})"

# Start the service
CMD ["node", "index.js"]