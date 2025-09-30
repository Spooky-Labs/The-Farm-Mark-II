#!/bin/bash

# Post-Deployment Kubernetes Configuration
# Handles tasks that can't be done with Terraform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Load environment variables
if [ -f .env ]; then
    source .env
fi

PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
CLUSTER_NAME=${GKE_CLUSTER:-spooky-labs-paper-trading}

# Required environment variables
required_vars=(
    "PROJECT_ID"
    "ALPACA_API_KEY"
    "ALPACA_SECRET_KEY"
)

print_status "Validating environment variables..."
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        print_error "Missing required variable: $var"
        exit 1
    fi
done

print_status "Connecting to GKE cluster..."
gcloud container clusters get-credentials "$CLUSTER_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID"

# Create trading-agents namespace
print_status "Creating trading-agents namespace..."
kubectl create namespace trading-agents --dry-run=client -o yaml | kubectl apply -f -

# Create paper-trading namespace (for our current implementation)
print_status "Creating paper-trading namespace..."
kubectl create namespace paper-trading --dry-run=client -o yaml | kubectl apply -f -

# Create data-ingestion namespace
print_status "Creating data-ingestion namespace..."
kubectl create namespace data-ingestion --dry-run=client -o yaml | kubectl apply -f -

# Create Alpaca credentials secret in trading-agents namespace
print_status "Creating Alpaca credentials secret in trading-agents namespace..."
kubectl create secret generic alpaca-credentials \
    --from-literal=ALPACA_API_KEY="$ALPACA_API_KEY" \
    --from-literal=ALPACA_SECRET_KEY="$ALPACA_SECRET_KEY" \
    --from-literal=ALPACA_BASE_URL="${ALPACA_BASE_URL:-https://paper-api.alpaca.markets}" \
    --namespace=trading-agents \
    --dry-run=client -o yaml | kubectl apply -f -

# Create Alpaca credentials secret in paper-trading namespace
print_status "Creating Alpaca credentials secret in paper-trading namespace..."
kubectl create secret generic alpaca-credentials \
    --from-literal=api-key="$ALPACA_API_KEY" \
    --from-literal=secret-key="$ALPACA_SECRET_KEY" \
    --from-literal=base-url="${ALPACA_BASE_URL:-https://paper-api.alpaca.markets}" \
    --namespace=paper-trading \
    --dry-run=client -o yaml | kubectl apply -f -

# Create Alpaca credentials secret in data-ingestion namespace
print_status "Creating Alpaca credentials secret in data-ingestion namespace..."
kubectl create secret generic alpaca-credentials \
    --from-literal=ALPACA_API_KEY="$ALPACA_API_KEY" \
    --from-literal=ALPACA_SECRET_KEY="$ALPACA_SECRET_KEY" \
    --from-literal=ALPACA_BASE_URL="${ALPACA_BASE_URL:-https://paper-api.alpaca.markets}" \
    --namespace=data-ingestion \
    --dry-run=client -o yaml | kubectl apply -f -

# Create Kubernetes service account for pub/sub publishing
print_status "Creating pubsub-publisher service account..."
kubectl create serviceaccount pubsub-publisher \
    --namespace=trading-agents \
    --dry-run=client -o yaml | kubectl apply -f -

kubectl create serviceaccount pubsub-publisher \
    --namespace=data-ingestion \
    --dry-run=client -o yaml | kubectl apply -f -

# Create service account for paper trading
print_status "Creating paper-trading-sa service account..."
kubectl create serviceaccount paper-trading-sa \
    --namespace=paper-trading \
    --dry-run=client -o yaml | kubectl apply -f -

# Configure Workload Identity for pub/sub publisher (trading-agents)
print_status "Configuring Workload Identity for pubsub-publisher (trading-agents)..."
SERVICE_ACCOUNT_EMAIL="data-ingestion@${PROJECT_ID}.iam.gserviceaccount.com"

kubectl annotate serviceaccount pubsub-publisher \
    --namespace=trading-agents \
    iam.gke.io/gcp-service-account="$SERVICE_ACCOUNT_EMAIL" \
    --overwrite

gcloud iam service-accounts add-iam-policy-binding \
    --role roles/iam.workloadIdentityUser \
    --member "serviceAccount:${PROJECT_ID}.svc.id.goog[trading-agents/pubsub-publisher]" \
    "$SERVICE_ACCOUNT_EMAIL" || print_warning "Failed to bind Workload Identity for trading-agents"

# Configure Workload Identity for pub/sub publisher (data-ingestion)
print_status "Configuring Workload Identity for pubsub-publisher (data-ingestion)..."
kubectl annotate serviceaccount pubsub-publisher \
    --namespace=data-ingestion \
    iam.gke.io/gcp-service-account="$SERVICE_ACCOUNT_EMAIL" \
    --overwrite

gcloud iam service-accounts add-iam-policy-binding \
    --role roles/iam.workloadIdentityUser \
    --member "serviceAccount:${PROJECT_ID}.svc.id.goog[data-ingestion/pubsub-publisher]" \
    "$SERVICE_ACCOUNT_EMAIL" || print_warning "Failed to bind Workload Identity for data-ingestion"

# Configure Workload Identity for paper trading
print_status "Configuring Workload Identity for paper-trading-sa..."
PAPER_TRADING_SA_EMAIL="paper-trading@${PROJECT_ID}.iam.gserviceaccount.com"

kubectl annotate serviceaccount paper-trading-sa \
    --namespace=paper-trading \
    iam.gke.io/gcp-service-account="$PAPER_TRADING_SA_EMAIL" \
    --overwrite

gcloud iam service-accounts add-iam-policy-binding \
    --role roles/iam.workloadIdentityUser \
    --member "serviceAccount:${PROJECT_ID}.svc.id.goog[paper-trading/paper-trading-sa]" \
    "$PAPER_TRADING_SA_EMAIL" || print_warning "Failed to bind Workload Identity for paper-trading"

# Create network policies for security (optional)
if [ "${ENABLE_NETWORK_POLICY:-false}" = "true" ]; then
    print_status "Creating network policies..."

    cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: trading-agents-netpol
  namespace: trading-agents
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
  egress:
  - to: []
    ports:
    - protocol: TCP
      port: 443
    - protocol: TCP
      port: 53
    - protocol: UDP
      port: 53
EOF
fi

# Verify setup
print_status "Verifying setup..."
kubectl get namespaces | grep -E "(trading-agents|paper-trading|data-ingestion)" || print_error "Namespaces not created"
kubectl get secrets -n trading-agents | grep alpaca-credentials || print_error "Alpaca secrets not created in trading-agents"
kubectl get secrets -n paper-trading | grep alpaca-credentials || print_error "Alpaca secrets not created in paper-trading"
kubectl get serviceaccounts -n trading-agents | grep pubsub-publisher || print_error "Service account not created in trading-agents"
kubectl get serviceaccounts -n paper-trading | grep paper-trading-sa || print_error "Service account not created in paper-trading"

print_success "Post-deployment Kubernetes configuration completed!"

echo ""
echo "📋 Configuration Summary:"
echo "  • Namespaces: trading-agents, paper-trading, data-ingestion"
echo "  • Secrets: alpaca-credentials in all namespaces"
echo "  • Service Accounts: pubsub-publisher, paper-trading-sa"
echo "  • Workload Identity: Configured for all service accounts"
echo ""
echo "🚀 Your cluster is ready for paper trading workloads!"