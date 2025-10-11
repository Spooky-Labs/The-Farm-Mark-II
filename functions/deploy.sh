#!/bin/bash

# Deploy the storage-triggered Cloud Function for automatic backtesting

PROJECT_ID=${1:-$PROJECT_ID}
REGION=${2:-"us-central1"}

if [ -z "$PROJECT_ID" ]; then
    echo "Usage: ./deploy.sh PROJECT_ID [REGION]"
    exit 1
fi

echo "Deploying updateAgentMetadata Cloud Function..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"

cd updateAgentMetadata

# Deploy the function with storage trigger
gcloud functions deploy updateAgentMetadata \
    --gen2 \
    --runtime=nodejs18 \
    --region=$REGION \
    --source=. \
    --entry-point=updateAgentMetadata \
    --trigger-event-type=google.storage.object.finalize \
    --trigger-resource=${PROJECT_ID}-agent-code \
    --memory=512MB \
    --timeout=540s \
    --max-instances=10 \
    --set-env-vars="PROJECT_ID=${PROJECT_ID}" \
    --service-account=cloud-function-sa@${PROJECT_ID}.iam.gserviceaccount.com

echo "Cloud Function deployed successfully!"
echo ""
echo "The function will automatically trigger when files are uploaded to:"
echo "  gs://${PROJECT_ID}-agent-code/agents/{userId}/{agentId}/strategy.py"
echo ""
echo "Backtest results will be stored in:"
echo "  gs://${PROJECT_ID}-backtest-results/{userId}/{agentId}/results.json"