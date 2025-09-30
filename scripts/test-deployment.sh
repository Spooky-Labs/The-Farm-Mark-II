#!/bin/bash

# Test Deployment Script for Spooky Labs
# Tests all components after deployment

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

# Load environment
if [ -f .env ]; then
    source .env
fi

PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}

if [ -z "$PROJECT_ID" ]; then
    print_error "PROJECT_ID not set"
    exit 1
fi

# Test Terraform outputs
test_terraform() {
    print_status "Testing Terraform deployment..."

    if [ ! -f "outputs.json" ]; then
        print_error "outputs.json not found. Run deployment first."
        return 1
    fi

    # Check key outputs
    gke_cluster=$(cat outputs.json | jq -r '.gke_cluster_name.value')
    if [ "$gke_cluster" != "null" ]; then
        print_success "GKE cluster: $gke_cluster"
    else
        print_error "GKE cluster not found in outputs"
    fi

    bigquery_dataset=$(cat outputs.json | jq -r '.bigquery_fmel_dataset.value')
    if [ "$bigquery_dataset" != "null" ]; then
        print_success "BigQuery FMEL dataset: $bigquery_dataset"
    else
        print_error "BigQuery dataset not found in outputs"
    fi
}

# Test BigQuery access
test_bigquery() {
    print_status "Testing BigQuery datasets..."

    # Test FMEL dataset
    if bq ls --project_id="$PROJECT_ID" | grep -q "fmel"; then
        print_success "FMEL dataset exists"
    else
        print_error "FMEL dataset not found"
    fi

    # Test market data dataset
    if bq ls --project_id="$PROJECT_ID" | grep -q "market_data"; then
        print_success "Market data dataset exists"
    else
        print_error "Market data dataset not found"
    fi

    # Test news data dataset
    if bq ls --project_id="$PROJECT_ID" | grep -q "news_data"; then
        print_success "News data dataset exists"
    else
        print_error "News data dataset not found"
    fi

    # Test FMEL trading decisions table
    if bq ls --project_id="$PROJECT_ID" fmel | grep -q "trading_decisions"; then
        print_success "FMEL trading_decisions table exists"
    else
        print_error "FMEL trading_decisions table not found"
    fi

    # Test market data bars table
    if bq ls --project_id="$PROJECT_ID" market_data | grep -q "bars"; then
        print_success "Market data bars table exists"
    else
        print_error "Market data bars table not found"
    fi

    # Test news articles table
    if bq ls --project_id="$PROJECT_ID" news_data | grep -q "articles"; then
        print_success "News articles table exists"
    else
        print_error "News articles table not found"
    fi
}

# Test GKE cluster
test_gke() {
    print_status "Testing GKE cluster..."

    # Get cluster credentials
    if gcloud container clusters get-credentials spooky-labs-paper-trading --region="$REGION" &> /dev/null; then
        print_success "GKE cluster accessible"
    else
        print_error "Cannot access GKE cluster"
        return 1
    fi

    # Test cluster nodes
    node_count=$(kubectl get nodes --no-headers | wc -l)
    if [ "$node_count" -gt 0 ]; then
        print_success "GKE cluster has $node_count nodes"
    else
        print_error "No nodes found in GKE cluster"
    fi

    # Test namespace
    if kubectl get namespace paper-trading &> /dev/null; then
        print_success "paper-trading namespace exists"
    else
        print_error "paper-trading namespace not found"
    fi

    # Test service account
    if kubectl get serviceaccount paper-trading-sa -n paper-trading &> /dev/null; then
        print_success "paper-trading service account exists"
    else
        print_error "paper-trading service account not found"
    fi
}

# Test Cloud Functions
test_cloud_functions() {
    print_status "Testing Cloud Functions..."

    functions=("submit-agent" "run-backtest" "paper-trading" "leaderboard" "fmel-analytics" "agent-management")

    for func in "${functions[@]}"; do
        if gcloud functions describe "$func" --region="$REGION" &> /dev/null; then
            print_success "Function $func exists"

            # Get function URL
            url=$(gcloud functions describe "$func" --region="$REGION" --format='value(serviceConfig.uri)')
            echo "  URL: $url"
        else
            print_error "Function $func not found"
        fi
    done
}

# Test Cloud Function endpoints
test_function_endpoints() {
    print_status "Testing Cloud Function endpoints..."

    # Test submit-agent endpoint (requires auth)
    submit_url=$(gcloud functions describe submit-agent --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null)
    if [ -n "$submit_url" ]; then
        response=$(curl -s -w "%{http_code}" -X POST "$submit_url" -o /dev/null)
        if [ "$response" = "401" ] || [ "$response" = "403" ]; then
            print_success "submit-agent endpoint responding with auth required (HTTP $response)"
        else
            print_warning "submit-agent endpoint returned HTTP $response"
        fi
    fi

    # Test leaderboard endpoint (public)
    leaderboard_url=$(gcloud functions describe leaderboard --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null)
    if [ -n "$leaderboard_url" ]; then
        response=$(curl -s -w "%{http_code}" "$leaderboard_url" -o /dev/null)
        if [ "$response" = "200" ]; then
            print_success "leaderboard endpoint responding (HTTP $response)"
        else
            print_warning "leaderboard endpoint returned HTTP $response"
        fi
    fi

    # Test FMEL analytics endpoint (requires auth)
    fmel_url=$(gcloud functions describe fmel-analytics --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null)
    if [ -n "$fmel_url" ]; then
        response=$(curl -s -w "%{http_code}" "$fmel_url" -o /dev/null)
        if [ "$response" = "401" ] || [ "$response" = "403" ]; then
            print_success "fmel-analytics endpoint responding with auth required (HTTP $response)"
        else
            print_warning "fmel-analytics endpoint returned HTTP $response"
        fi
    fi

    # Test agent management endpoint (requires auth)
    agent_mgmt_url=$(gcloud functions describe agent-management --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null)
    if [ -n "$agent_mgmt_url" ]; then
        response=$(curl -s -w "%{http_code}" "$agent_mgmt_url" -o /dev/null)
        if [ "$response" = "401" ] || [ "$response" = "403" ]; then
            print_success "agent-management endpoint responding with auth required (HTTP $response)"
        else
            print_warning "agent-management endpoint returned HTTP $response"
        fi
    fi
}

# Test data ingester Kubernetes deployments
test_data_ingesters() {
    print_status "Testing data ingester Kubernetes deployments..."

    # Check if data-ingestion namespace exists
    if kubectl get namespace data-ingestion &> /dev/null; then
        print_success "Data ingestion namespace exists"
    else
        print_error "Data ingestion namespace not found"
        return
    fi

    deployments=("alpaca-ingester" "news-ingester")

    for deployment in "${deployments[@]}"; do
        if kubectl get deployment "$deployment" -n data-ingestion &> /dev/null; then
            print_success "Kubernetes deployment $deployment exists"

            # Check if deployment is ready
            ready=$(kubectl get deployment "$deployment" -n data-ingestion -o jsonpath='{.status.readyReplicas}')
            replicas=$(kubectl get deployment "$deployment" -n data-ingestion -o jsonpath='{.spec.replicas}')

            if [ "$ready" = "$replicas" ] && [ "$ready" != "" ]; then
                print_success "$deployment deployment is ready ($ready/$replicas replicas)"
            else
                print_warning "$deployment deployment not fully ready ($ready/$replicas replicas)"
            fi

            # Check pod status
            pod_status=$(kubectl get pods -n data-ingestion -l app="$deployment" -o jsonpath='{.items[0].status.phase}' 2>/dev/null)
            if [ "$pod_status" = "Running" ]; then
                print_success "$deployment pod is running"
            else
                print_warning "$deployment pod status: $pod_status"
            fi
        else
            print_error "Kubernetes deployment $deployment not found"
        fi
    done
}

# Test Secret Manager
test_secrets() {
    print_status "Testing Secret Manager..."

    secrets=("alpaca-api-key" "alpaca-secret-key" "alpaca-base-url" "news-api-key")

    for secret in "${secrets[@]}"; do
        if gcloud secrets describe "$secret" &> /dev/null; then
            print_success "Secret $secret exists"
        else
            print_warning "Secret $secret not found"
        fi
    done
}

# Test Artifact Registry
test_artifact_registry() {
    print_status "Testing Artifact Registry..."

    # Check repository exists
    if gcloud artifacts repositories describe spooky-labs --location="$REGION" &> /dev/null; then
        print_success "Artifact Registry repository exists"
    else
        print_error "Artifact Registry repository not found"
        return 1
    fi

    # Check container images
    images=("backtest-runner" "paper-trader")

    for image in "${images[@]}"; do
        if gcloud artifacts docker images list "${REGION}-docker.pkg.dev/${PROJECT_ID}/spooky-labs" | grep -q "$image"; then
            print_success "Container image $image exists"
        else
            print_warning "Container image $image not found"
        fi
    done
}

# Test Pub/Sub
test_pubsub() {
    print_status "Testing Pub/Sub topics..."

    topics=("market-data" "news-data" "fmel-decisions")

    for topic in "${topics[@]}"; do
        if gcloud pubsub topics describe "$topic" &> /dev/null; then
            print_success "Pub/Sub topic $topic exists"
        else
            print_error "Pub/Sub topic $topic not found"
        fi
    done
}

# Create and test sample agent
test_sample_agent() {
    print_status "Testing with sample agent..."

    # Create simple test strategy
    cat > /tmp/test_strategy.py << 'EOF'
import backtrader as bt

class TestStrategy(bt.Strategy):
    def next(self):
        if not self.position:
            self.buy()
        elif len(self) > 10:
            self.sell()
EOF

    # Get submit-agent URL
    submit_url=$(gcloud functions describe submit-agent --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null)

    if [ -n "$submit_url" ]; then
        print_status "Submitting test agent..."

        response=$(curl -s -X POST "$submit_url" \
            -F "file=@/tmp/test_strategy.py" \
            -F "agent_name=test-agent" \
            -F "user_id=test-user")

        if echo "$response" | grep -q "agent_id"; then
            print_success "Test agent submitted successfully"
            agent_id=$(echo "$response" | grep -o '"agent_id":"[^"]*"' | cut -d'"' -f4)
            echo "  Agent ID: $agent_id"
        else
            print_warning "Test agent submission failed"
            echo "  Response: $response"
        fi
    fi

    rm -f /tmp/test_strategy.py
}

# Run comprehensive health check
run_health_check() {
    print_status "Running comprehensive health check..."

    # Check for common issues
    local issues=0

    # Check if APIs are enabled
    required_apis=("container.googleapis.com" "cloudfunctions.googleapis.com" "bigquery.googleapis.com")
    for api in "${required_apis[@]}"; do
        if ! gcloud services list --enabled --filter="name:$api" | grep -q "$api"; then
            print_error "API not enabled: $api"
            issues=$((issues + 1))
        fi
    done

    # Check IAM permissions
    if ! gcloud projects get-iam-policy "$PROJECT_ID" | grep -q "roles/owner\|roles/editor"; then
        print_warning "May have insufficient IAM permissions"
        issues=$((issues + 1))
    fi

    # Check billing
    if ! gcloud billing projects describe "$PROJECT_ID" | grep -q "billingEnabled: true"; then
        print_error "Billing not enabled for project"
        issues=$((issues + 1))
    fi

    if [ $issues -eq 0 ]; then
        print_success "Health check passed"
    else
        print_warning "Found $issues potential issues"
    fi
}

# Generate test report
generate_test_report() {
    print_status "Generating test report..."

    cat > test-report.md << EOF
# Spooky Labs Deployment Test Report

Generated: $(date)
Project: $PROJECT_ID
Region: $REGION

## Infrastructure Status

### Terraform
- Outputs file: $([ -f "outputs.json" ] && echo "✅ Present" || echo "❌ Missing")

### Google Cloud Services
- BigQuery datasets: $(bq ls --project_id="$PROJECT_ID" | wc -l) datasets found
- GKE cluster: $(gcloud container clusters list --region="$REGION" | grep -c spooky-labs) clusters found
- Cloud Functions: $(gcloud functions list --region="$REGION" | wc -l) functions deployed
- Secrets: $(gcloud secrets list | wc -l) secrets stored

### Container Images
- Artifact Registry: $(gcloud artifacts repositories list --location="$REGION" | grep -c spooky-labs) repositories found

### Kubernetes
- Nodes: $(kubectl get nodes --no-headers 2>/dev/null | wc -l || echo "0") nodes
- Namespaces: $(kubectl get namespaces 2>/dev/null | grep -c paper-trading || echo "0") paper-trading namespaces

## API Endpoints

$(for func in submit-agent run-backtest start-paper-trading get-leaderboard; do
    url=$(gcloud functions describe "$func" --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null || echo "Not found")
    echo "- $func: $url"
done)

## Recommendations

1. Test agent submission through the API
2. Monitor Cloud Functions logs for errors
3. Verify BigQuery data ingestion
4. Test paper trading deployment

---
Generated by test-deployment.sh
EOF

    print_success "Test report saved to test-report.md"
}

# Print test summary
print_test_summary() {
    echo ""
    echo "🧪 Deployment Test Complete"
    echo "==========================="
    echo ""
    echo "📊 Components tested:"
    echo "  • Terraform infrastructure"
    echo "  • BigQuery datasets and tables (fmel, market_data, news_data)"
    echo "  • GKE cluster and Kubernetes resources"
    echo "  • Cloud Functions (6 functions with Firebase Auth)"
    echo "  • Kubernetes data ingesters"
    echo "  • Secret Manager"
    echo "  • Artifact Registry"
    echo "  • Pub/Sub topics"
    echo ""
    echo "📋 Test report: test-report.md"
    echo ""
    echo "🔗 Quick test commands:"
    echo "  # Test agent submission"
    submit_url=$(gcloud functions describe submit-agent --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null || echo "")
    if [ -n "$submit_url" ]; then
        echo "  curl -X POST $submit_url"
    fi
    echo ""
    echo "  # View logs"
    echo "  gcloud functions logs read submit-agent --region=$REGION --limit=10"
    echo ""
}

# Main function
main() {
    echo "🧪 Spooky Labs Deployment Testing"
    echo "=================================="
    echo ""

    test_terraform
    test_bigquery
    test_gke
    test_cloud_functions
    test_function_endpoints
    test_data_ingesters
    test_secrets
    test_artifact_registry
    test_pubsub
    test_sample_agent
    run_health_check
    generate_test_report
    print_test_summary
}

# Run main function
main "$@"