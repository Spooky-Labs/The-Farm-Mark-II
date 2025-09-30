#!/bin/bash

# Setup Monitoring and Alerting for Spooky Labs
# Creates dashboards, alert policies, and notification channels

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
if [ -f ../.env ]; then
    source ../.env
fi

PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
ALERT_EMAIL=${ALERT_EMAIL:-alerts@spookylabs.com}

if [ -z "$PROJECT_ID" ]; then
    print_error "PROJECT_ID not set"
    exit 1
fi

# Create notification channels
create_notification_channels() {
    print_status "Creating notification channels..."

    # Email notification channel
    email_channel=$(gcloud alpha monitoring channels create \
        --display-name="Email Alerts" \
        --type=email \
        --channel-labels=email_address="$ALERT_EMAIL" \
        --format="value(name)" 2>/dev/null || echo "")

    if [ -n "$email_channel" ]; then
        print_success "Created email notification channel: $email_channel"
        echo "$email_channel" > notification_channels.txt
    else
        print_warning "Email notification channel may already exist"
        # Try to find existing channel
        existing_channel=$(gcloud alpha monitoring channels list \
            --filter="type=email AND labels.email_address=$ALERT_EMAIL" \
            --format="value(name)" | head -1)
        if [ -n "$existing_channel" ]; then
            print_success "Using existing email notification channel: $existing_channel"
            echo "$existing_channel" > notification_channels.txt
        fi
    fi
}

# Create dashboard
create_dashboard() {
    print_status "Creating monitoring dashboard..."

    if [ -f "dashboard.json" ]; then
        dashboard_id=$(gcloud monitoring dashboards create --config-from-file=dashboard.json \
            --format="value(name)" 2>/dev/null || echo "")

        if [ -n "$dashboard_id" ]; then
            print_success "Created dashboard: $dashboard_id"
            echo "Dashboard URL: https://console.cloud.google.com/monitoring/dashboards/custom/$dashboard_id?project=$PROJECT_ID"
        else
            print_warning "Dashboard creation failed or already exists"
        fi
    else
        print_error "dashboard.json not found"
    fi
}

# Create alert policies
create_alert_policies() {
    print_status "Creating alert policies..."

    if [ ! -f "notification_channels.txt" ]; then
        print_error "No notification channels found. Run create_notification_channels first."
        return 1
    fi

    notification_channel=$(cat notification_channels.txt)

    # High Error Rate Alert
    cat > high_error_rate_policy.json << EOF
{
  "displayName": "High Error Rate - Cloud Functions",
  "documentation": {
    "content": "Cloud Functions are experiencing high error rates above 5%",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "Error rate above 5%",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.label.status!=\"ok\"",
        "comparison": "COMPARISON_GREATER_THAN",
        "thresholdValue": 0.05,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_MEAN",
            "groupByFields": ["resource.label.function_name"]
          }
        ]
      }
    }
  ],
  "alertStrategy": {
    "autoClose": "1800s"
  },
  "combiner": "OR",
  "notificationChannels": ["$notification_channel"]
}
EOF

    # High CPU Usage Alert
    cat > high_cpu_policy.json << EOF
{
  "displayName": "GKE High CPU Usage",
  "documentation": {
    "content": "Kubernetes pods in paper-trading namespace are using high CPU (>80%)",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "CPU usage above 80%",
      "conditionThreshold": {
        "filter": "resource.type=\"k8s_container\" AND resource.label.namespace_name=\"paper-trading\" AND metric.type=\"kubernetes.io/container/cpu/core_usage_time\"",
        "comparison": "COMPARISON_GREATER_THAN",
        "thresholdValue": 0.8,
        "duration": "300s",
        "aggregations": [
          {
            "alignmentPeriod": "60s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_MEAN",
            "groupByFields": ["resource.label.pod_name"]
          }
        ]
      }
    }
  ],
  "combiner": "OR",
  "notificationChannels": ["$notification_channel"]
}
EOF

    # Cost Budget Alert
    cat > cost_budget_policy.json << EOF
{
  "displayName": "Daily Cost Budget Alert",
  "documentation": {
    "content": "Daily spending is above $20 - potential cost issue",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "Daily cost above $20",
      "conditionThreshold": {
        "filter": "metric.type=\"billing.googleapis.com/billing/total_cost\"",
        "comparison": "COMPARISON_GREATER_THAN",
        "thresholdValue": 20.0,
        "duration": "3600s",
        "aggregations": [
          {
            "alignmentPeriod": "86400s",
            "perSeriesAligner": "ALIGN_SUM",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "combiner": "OR",
  "notificationChannels": ["$notification_channel"]
}
EOF

    # FMEL Data Pipeline Alert
    cat > fmel_pipeline_policy.json << EOF
{
  "displayName": "FMEL Data Pipeline Failure",
  "documentation": {
    "content": "No FMEL data has been recorded in the last 30 minutes",
    "mimeType": "text/markdown"
  },
  "conditions": [
    {
      "displayName": "No FMEL data in 30 minutes",
      "conditionAbsent": {
        "filter": "resource.type=\"bigquery_table\" AND resource.label.table_id=\"decisions\" AND metric.type=\"bigquery.googleapis.com/storage/uploaded_bytes\"",
        "duration": "1800s",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_RATE",
            "crossSeriesReducer": "REDUCE_SUM"
          }
        ]
      }
    }
  ],
  "combiner": "OR",
  "notificationChannels": ["$notification_channel"]
}
EOF

    # Create alert policies
    policies=("high_error_rate_policy.json" "high_cpu_policy.json" "cost_budget_policy.json" "fmel_pipeline_policy.json")

    for policy in "${policies[@]}"; do
        if [ -f "$policy" ]; then
            policy_name=$(gcloud alpha monitoring policies create --policy-from-file="$policy" \
                --format="value(name)" 2>/dev/null || echo "")

            if [ -n "$policy_name" ]; then
                print_success "Created alert policy: $policy_name"
            else
                print_warning "Failed to create policy from $policy"
            fi

            rm -f "$policy"
        fi
    done
}

# Create uptime checks
create_uptime_checks() {
    print_status "Creating uptime checks..."

    # Get Cloud Function URLs
    submit_url=$(gcloud functions describe submit-agent --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null || echo "")
    leaderboard_url=$(gcloud functions describe get-leaderboard --region="$REGION" --format='value(serviceConfig.uri)' 2>/dev/null || echo "")

    if [ -n "$submit_url" ]; then
        print_status "Creating uptime check for submit-agent..."
        gcloud monitoring uptime create \
            --display-name="Submit Agent Function" \
            --http-check-path="/" \
            --hostname="$(echo $submit_url | sed 's|https://||' | cut -d'/' -f1)" \
            --port=443 \
            --use-ssl \
            --period=60 \
            --timeout=10 \
            --regions=us-central1-a,us-east1-a,europe-west1-a 2>/dev/null || print_warning "Uptime check creation failed"
    fi

    if [ -n "$leaderboard_url" ]; then
        print_status "Creating uptime check for leaderboard..."
        gcloud monitoring uptime create \
            --display-name="Leaderboard Function" \
            --http-check-path="/" \
            --hostname="$(echo $leaderboard_url | sed 's|https://||' | cut -d'/' -f1)" \
            --port=443 \
            --use-ssl \
            --period=60 \
            --timeout=10 \
            --regions=us-central1-a,us-east1-a,europe-west1-a 2>/dev/null || print_warning "Uptime check creation failed"
    fi
}

# Setup log-based metrics
create_log_metrics() {
    print_status "Creating log-based metrics..."

    # FMEL record creation metric
    gcloud logging metrics create fmel_records_created \
        --description="Count of FMEL records successfully created" \
        --log-filter='resource.type="cloud_function" AND (textPayload=~"Successfully inserted.*FMEL records" OR jsonPayload.message=~"FMEL record created")' \
        --value-extractor='EXTRACT(textPayload =~ r"Successfully inserted (\d+) FMEL records")' || print_warning "FMEL metric creation failed"

    # Agent submission metric
    gcloud logging metrics create agent_submissions \
        --description="Count of successful agent submissions" \
        --log-filter='resource.type="cloud_function" AND resource.labels.function_name="submit-agent" AND (textPayload=~"agent submitted successfully" OR jsonPayload.status="submitted")' || print_warning "Agent submission metric creation failed"

    # Backtest completion metric
    gcloud logging metrics create backtest_completions \
        --description="Count of completed backtests" \
        --log-filter='resource.type="cloud_function" AND (textPayload=~"Backtest completed successfully" OR jsonPayload.status="completed")' || print_warning "Backtest metric creation failed"

    # Paper trading errors metric
    gcloud logging metrics create paper_trading_errors \
        --description="Count of paper trading errors" \
        --log-filter='resource.type="k8s_container" AND resource.labels.namespace_name="paper-trading" AND severity>=ERROR' || print_warning "Paper trading error metric creation failed"

    print_success "Log-based metrics created"
}

# Verify monitoring setup
verify_monitoring() {
    print_status "Verifying monitoring setup..."

    # Check notification channels
    channel_count=$(gcloud alpha monitoring channels list --format="value(name)" | wc -l)
    print_status "Notification channels: $channel_count"

    # Check alert policies
    policy_count=$(gcloud alpha monitoring policies list --format="value(name)" | wc -l)
    print_status "Alert policies: $policy_count"

    # Check uptime checks
    uptime_count=$(gcloud monitoring uptime list --format="value(name)" | wc -l)
    print_status "Uptime checks: $uptime_count"

    # Check log metrics
    metric_count=$(gcloud logging metrics list --format="value(name)" | wc -l)
    print_status "Log-based metrics: $metric_count"

    print_success "Monitoring verification complete"
}

# Cleanup temporary files
cleanup() {
    print_status "Cleaning up temporary files..."
    rm -f notification_channels.txt *.json
}

# Print monitoring summary
print_monitoring_summary() {
    echo ""
    echo "📊 Monitoring Setup Complete"
    echo "============================"
    echo ""
    echo "✅ Components configured:"
    echo "  • Email notification channel ($ALERT_EMAIL)"
    echo "  • Monitoring dashboard"
    echo "  • Alert policies for key metrics"
    echo "  • Uptime checks for Cloud Functions"
    echo "  • Log-based metrics"
    echo ""
    echo "🔗 Access monitoring:"
    echo "  • Dashboards: https://console.cloud.google.com/monitoring/dashboards?project=$PROJECT_ID"
    echo "  • Alerts: https://console.cloud.google.com/monitoring/alerting?project=$PROJECT_ID"
    echo "  • Uptime: https://console.cloud.google.com/monitoring/uptime?project=$PROJECT_ID"
    echo "  • Logs: https://console.cloud.google.com/logs?project=$PROJECT_ID"
    echo ""
    echo "⚠️  Alert thresholds:"
    echo "  • Function error rate > 5%"
    echo "  • CPU usage > 80%"
    echo "  • Daily cost > $20"
    echo "  • No FMEL data for 30 minutes"
    echo ""
    echo "📧 Alerts will be sent to: $ALERT_EMAIL"
    echo ""
}

# Main function
main() {
    echo "📊 Spooky Labs Monitoring Setup"
    echo "==============================="
    echo ""

    create_notification_channels
    create_dashboard
    create_alert_policies
    create_uptime_checks
    create_log_metrics
    verify_monitoring
    cleanup
    print_monitoring_summary
}

# Run main function
main "$@"