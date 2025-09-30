#!/bin/bash

# Cleanup Script for Spooky Labs
# Safely destroys all infrastructure to save costs

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

# Confirmation prompt
confirm_cleanup() {
    echo ""
    print_warning "⚠️  DANGER: This will destroy ALL Spooky Labs infrastructure!"
    echo ""
    echo "This includes:"
    echo "  • GKE cluster and all workloads"
    echo "  • Cloud Functions"
    echo "  • BigQuery datasets and ALL DATA"
    echo "  • Container images"
    echo "  • Secrets"
    echo "  • Storage buckets and ALL DATA"
    echo "  • Pub/Sub topics"
    echo ""
    print_warning "💾 BigQuery and Storage data will be PERMANENTLY DELETED!"
    echo ""
    echo "Project: $PROJECT_ID"
    echo "Region: $REGION"
    echo ""
    read -p "Type 'DELETE EVERYTHING' to confirm: " confirmation

    if [ "$confirmation" != "DELETE EVERYTHING" ]; then
        print_status "Cleanup cancelled"
        exit 0
    fi

    echo ""
    print_status "Starting cleanup in 5 seconds... (Ctrl+C to cancel)"
    sleep 5
}

# Stop all paper trading agents
stop_paper_trading() {
    print_status "Stopping all paper trading agents..."

    if kubectl get namespace paper-trading &> /dev/null; then
        # Delete all StatefulSets in paper-trading namespace
        kubectl delete statefulsets --all -n paper-trading --timeout=60s || true

        # Delete all pods forcefully if needed
        kubectl delete pods --all -n paper-trading --force --grace-period=0 || true

        print_success "Paper trading agents stopped"
    else
        print_status "Paper trading namespace not found"
    fi
}

# Delete Cloud Functions
delete_cloud_functions() {
    print_status "Deleting Cloud Functions..."

    functions=("submit-agent" "run-backtest" "start-paper-trading" "stop-paper-trading" "update-leaderboard" "get-leaderboard")

    for func in "${functions[@]}"; do
        if gcloud functions describe "$func" --region="$REGION" &> /dev/null; then
            print_status "Deleting function: $func"
            gcloud functions delete "$func" --region="$REGION" --quiet
        fi
    done

    print_success "Cloud Functions deleted"
}

# Delete Cloud Scheduler jobs
delete_scheduler_jobs() {
    print_status "Deleting Cloud Scheduler jobs..."

    jobs=("update-leaderboard-schedule")

    for job in "${jobs[@]}"; do
        if gcloud scheduler jobs describe "$job" --location="$REGION" &> /dev/null; then
            print_status "Deleting scheduler job: $job"
            gcloud scheduler jobs delete "$job" --location="$REGION" --quiet
        fi
    done

    print_success "Scheduler jobs deleted"
}

# Delete container images
delete_container_images() {
    print_status "Deleting container images..."

    if gcloud artifacts repositories describe spooky-labs --location="$REGION" &> /dev/null; then
        print_status "Deleting Artifact Registry repository"
        gcloud artifacts repositories delete spooky-labs --location="$REGION" --quiet
        print_success "Container images deleted"
    else
        print_status "Artifact Registry repository not found"
    fi
}

# Delete BigQuery datasets (DESTRUCTIVE)
delete_bigquery_datasets() {
    print_warning "⚠️  DELETING BIGQUERY DATASETS - ALL DATA WILL BE LOST!"

    datasets=("fmel" "market_data" "news_data" "backtest_results")

    for dataset in "${datasets[@]}"; do
        if bq ls --project_id="$PROJECT_ID" | grep -q "$dataset"; then
            print_status "Deleting BigQuery dataset: $dataset"
            bq rm -r -f "$PROJECT_ID:$dataset"
        fi
    done

    print_success "BigQuery datasets deleted"
}

# Delete storage buckets (DESTRUCTIVE)
delete_storage_buckets() {
    print_warning "⚠️  DELETING STORAGE BUCKETS - ALL DATA WILL BE LOST!"

    buckets=(
        "${PROJECT_ID}-agent-code"
        "${PROJECT_ID}-backtest-results"
        "${PROJECT_ID}-terraform-state"
    )

    for bucket in "${buckets[@]}"; do
        if gsutil ls "gs://$bucket" &> /dev/null; then
            print_status "Deleting storage bucket: $bucket"
            gsutil -m rm -r "gs://$bucket"
        fi
    done

    print_success "Storage buckets deleted"
}

# Delete Pub/Sub topics
delete_pubsub_topics() {
    print_status "Deleting Pub/Sub topics..."

    topics=("market-data" "news-data" "fmel-decisions")

    for topic in "${topics[@]}"; do
        if gcloud pubsub topics describe "$topic" &> /dev/null; then
            # Delete subscriptions first
            subscriptions=$(gcloud pubsub subscriptions list --filter="topic:$topic" --format="value(name)")
            for sub in $subscriptions; do
                print_status "Deleting subscription: $sub"
                gcloud pubsub subscriptions delete "$sub" --quiet
            done

            print_status "Deleting topic: $topic"
            gcloud pubsub topics delete "$topic" --quiet
        fi
    done

    print_success "Pub/Sub topics deleted"
}

# Delete secrets
delete_secrets() {
    print_status "Deleting secrets..."

    secrets=("alpaca-api-key" "alpaca-secret-key" "news-api-key" "firebase-admin-key")

    for secret in "${secrets[@]}"; do
        if gcloud secrets describe "$secret" &> /dev/null; then
            print_status "Deleting secret: $secret"
            gcloud secrets delete "$secret" --quiet
        fi
    done

    print_success "Secrets deleted"
}

# Destroy Terraform infrastructure
destroy_terraform() {
    print_status "Destroying Terraform infrastructure..."

    cd terraform

    if [ -f "terraform.tfvars" ]; then
        # Initialize Terraform
        terraform init \
            -backend-config="bucket=${PROJECT_ID}-terraform-state" \
            -backend-config="prefix=terraform/state" || true

        # Destroy infrastructure
        print_status "Running terraform destroy..."
        terraform destroy -auto-approve

        print_success "Terraform infrastructure destroyed"
    else
        print_warning "No terraform.tfvars found, skipping Terraform destroy"
    fi

    cd ..
}

# Clean up local files
cleanup_local_files() {
    print_status "Cleaning up local files..."

    files_to_remove=(
        "terraform/terraform.tfvars"
        "terraform/.terraform"
        "terraform/terraform.tfstate*"
        "terraform/tfplan"
        "outputs.json"
        "test-report.md"
        ".terraform.lock.hcl"
    )

    for file in "${files_to_remove[@]}"; do
        if [ -e "$file" ]; then
            print_status "Removing: $file"
            rm -rf "$file"
        fi
    done

    print_success "Local files cleaned"
}

# Verify cleanup
verify_cleanup() {
    print_status "Verifying cleanup..."

    local remaining=0

    # Check Cloud Functions
    if [ $(gcloud functions list --region="$REGION" 2>/dev/null | wc -l) -gt 1 ]; then
        print_warning "Some Cloud Functions still exist"
        remaining=$((remaining + 1))
    fi

    # Check BigQuery datasets
    if [ $(bq ls --project_id="$PROJECT_ID" 2>/dev/null | grep -E "(fmel|market_data|news_data)" | wc -l) -gt 0 ]; then
        print_warning "Some BigQuery datasets still exist"
        remaining=$((remaining + 1))
    fi

    # Check GKE clusters
    if [ $(gcloud container clusters list --region="$REGION" 2>/dev/null | grep -c spooky-labs) -gt 0 ]; then
        print_warning "GKE cluster still exists"
        remaining=$((remaining + 1))
    fi

    # Check storage buckets
    for bucket in "${PROJECT_ID}-agent-code" "${PROJECT_ID}-backtest-results"; do
        if gsutil ls "gs://$bucket" &> /dev/null; then
            print_warning "Storage bucket $bucket still exists"
            remaining=$((remaining + 1))
        fi
    done

    if [ $remaining -eq 0 ]; then
        print_success "Cleanup verification passed"
    else
        print_warning "Found $remaining remaining resources"
        print_status "Some resources may take time to fully delete"
    fi
}

# Print cleanup summary
print_cleanup_summary() {
    echo ""
    echo "🧹 Cleanup Complete"
    echo "==================="
    echo ""
    echo "✅ Resources deleted:"
    echo "  • Cloud Functions"
    echo "  • GKE cluster and workloads"
    echo "  • BigQuery datasets (ALL DATA DELETED)"
    echo "  • Container images"
    echo "  • Storage buckets (ALL DATA DELETED)"
    echo "  • Pub/Sub topics"
    echo "  • Secrets"
    echo "  • Scheduler jobs"
    echo ""
    echo "🗂️  Local files cleaned:"
    echo "  • Terraform state files"
    echo "  • Configuration files"
    echo "  • Output files"
    echo ""
    echo "💰 Cost Impact:"
    echo "  • All billable resources have been deleted"
    echo "  • Monthly costs should return to $0"
    echo ""
    echo "🔄 To redeploy:"
    echo "  1. Run: bash scripts/setup-environment.sh"
    echo "  2. Run: bash deploy.sh"
    echo ""
}

# Main function
main() {
    echo "🧹 Spooky Labs Infrastructure Cleanup"
    echo "====================================="

    confirm_cleanup

    print_status "Starting cleanup process..."

    stop_paper_trading
    delete_cloud_functions
    delete_scheduler_jobs
    delete_container_images
    delete_pubsub_topics
    delete_secrets
    delete_bigquery_datasets
    delete_storage_buckets
    destroy_terraform
    cleanup_local_files
    verify_cleanup
    print_cleanup_summary
}

# Run main function
main "$@"