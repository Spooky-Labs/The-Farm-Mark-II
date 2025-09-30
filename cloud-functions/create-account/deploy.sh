#!/bin/bash

# Deploy create-account Python Cloud Function
# Uses Alpaca Broker API Python SDK

set -e

echo "Deploying create-account Cloud Function..."

# Get project and region from environment or use defaults
PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}

if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID not set and no default project configured"
    exit 1
fi

echo "Project: $PROJECT_ID"
echo "Region: $REGION"

# Deploy the function
gcloud functions deploy create-account \
    --gen2 \
    --runtime=python311 \
    --region=$REGION \
    --source=. \
    --entry-point=create_account \
    --trigger-http \
    --allow-unauthenticated \
    --set-env-vars="ALPACA_SANDBOX=true" \
    --set-secrets="ALPACA_API_KEY=ALPACA_API_KEY:latest,ALPACA_SECRET_KEY=ALPACA_SECRET_KEY:latest" \
    --max-instances=10 \
    --memory=256MB \
    --timeout=60s \
    --project=$PROJECT_ID

echo "✅ create-account deployed successfully!"
echo "URL: https://$REGION-$PROJECT_ID.cloudfunctions.net/create-account"