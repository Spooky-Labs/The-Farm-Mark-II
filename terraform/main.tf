# The Farm Mark II - Terraform Configuration
# Single-file infrastructure for clarity and maintainability

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Backend configuration for state storage
  backend "gcs" {
    # Set via: terraform init -backend-config="bucket=PROJECT_ID-terraform-state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ============================================================================
# APIS - Enable all required Google Cloud APIs
# ============================================================================

resource "google_project_service" "apis" {
  for_each = toset([
    "container.googleapis.com",      # GKE
    "cloudfunctions.googleapis.com", # Cloud Functions
    "bigquery.googleapis.com",       # BigQuery
    "pubsub.googleapis.com",         # Pub/Sub
    "redis.googleapis.com",          # Memorystore Redis
    "compute.googleapis.com",        # Compute Engine
    "storage.googleapis.com",        # Cloud Storage
    "iam.googleapis.com",            # IAM
    "monitoring.googleapis.com"      # Cloud Monitoring
  ])

  service            = each.value
  disable_on_destroy = false
}

# ============================================================================
# NETWORKING - Simple VPC and subnet
# ============================================================================

resource "google_compute_network" "main" {
  name                    = "farm-network"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  name          = "farm-subnet"
  network       = google_compute_network.main.id
  region        = var.region
  ip_cidr_range = "10.0.0.0/20"

  # Secondary ranges for GKE
  secondary_ip_range {
    range_name    = "gke-pods"
    ip_cidr_range = "10.4.0.0/14"
  }

  secondary_ip_range {
    range_name    = "gke-services"
    ip_cidr_range = "10.0.16.0/20"
  }

  private_ip_google_access = true
}

# ============================================================================
# SERVICE ACCOUNTS - Just 2 instead of 6+
# ============================================================================

resource "google_service_account" "gke_workload" {
  account_id   = "gke-workload-sa"
  display_name = "GKE Workload Identity Service Account"
}

resource "google_service_account" "cloud_function" {
  account_id   = "api-gateway-sa"
  display_name = "API Gateway Cloud Function Service Account"
}

# GKE workload permissions
resource "google_project_iam_member" "gke_roles" {
  for_each = toset([
    "roles/bigquery.dataEditor",  # Read/write BigQuery
    "roles/pubsub.editor",        # Pub/Sub publish/subscribe
    "roles/storage.objectViewer", # Read from GCS
    "roles/logging.logWriter"     # Write logs
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.gke_workload.email}"
}

# Cloud Function permissions
resource "google_project_iam_member" "function_roles" {
  for_each = toset([
    "roles/bigquery.dataViewer", # Read BigQuery
    "roles/redis.editor",        # Redis access
    "roles/firebaseauth.viewer"  # Verify Firebase tokens
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.cloud_function.email}"
}

# ============================================================================
# GKE CLUSTER - Production-ready configuration
# ============================================================================

resource "google_container_cluster" "main" {
  name     = "farm-cluster"
  location = var.region

  # Use release channel for automatic upgrades
  release_channel {
    channel = "REGULAR"
  }

  # Network configuration
  network    = google_compute_network.main.name
  subnetwork = google_compute_subnetwork.main.name

  # IP allocation for pods and services
  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-pods"
    services_secondary_range_name = "gke-services"
  }

  # Start with minimal node pool (will create separate pool)
  initial_node_count       = 1
  remove_default_node_pool = true

  # Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Basic security
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false # Allow public endpoint for simplicity
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Required for private cluster
  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "0.0.0.0/0"
      display_name = "All networks" # Restrict this in production
    }
  }

  depends_on = [google_compute_subnetwork.main]
}

# Node pool with auto-scaling
resource "google_container_node_pool" "main" {
  name     = "main-pool"
  location = var.region
  cluster  = google_container_cluster.main.name

  # Auto-scaling between 1-3 nodes
  autoscaling {
    min_node_count = 1
    max_node_count = 3
  }

  node_config {
    machine_type = "e2-standard-2" # 2 vCPU, 8GB RAM
    disk_size_gb = 50
    disk_type    = "pd-standard"

    # Use GKE workload identity
    service_account = google_service_account.gke_workload.email
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]

    # Security
    shielded_instance_config {
      enable_secure_boot = true
    }

    # Workload Identity
    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    metadata = {
      disable-legacy-endpoints = "true"
    }
  }
}

# ============================================================================
# BIGQUERY - Simple datasets, no pre-defined schemas
# ============================================================================

resource "google_bigquery_dataset" "main" {
  for_each = {
    fmel        = "FMEL decision recording and analytics"
    market_data = "Market data from Alpaca"
    news_data   = "Financial news data with sentiment analysis"
  }

  dataset_id  = each.key
  location    = "US" # Multi-region for better performance
  description = each.value

  # 1 year default retention (can be overridden per table)
  default_table_expiration_ms = 31536000000

  # Grant access to GKE service account
  access {
    role          = "WRITER"
    user_by_email = google_service_account.gke_workload.email
  }

  access {
    role          = "READER"
    user_by_email = google_service_account.cloud_function.email
  }

  depends_on = [google_project_service.apis]
}

# BigQuery Tables
resource "google_bigquery_table" "trading_decisions" {
  dataset_id = google_bigquery_dataset.main["fmel"].dataset_id
  table_id   = "trading_decisions"

  description = "Trading decisions made by agents with FMEL data"

  time_partitioning {
    type  = "DAY"
    field = "timestamp"
  }

  clustering = ["agent_id", "user_id"]

  schema = jsonencode([
    {
      name        = "decision_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Unique identifier for the trading decision"
    },
    {
      name        = "timestamp"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "When the decision was made"
    },
    {
      name        = "agent_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Unique identifier for the trading agent"
    },
    {
      name        = "user_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "User who owns the agent"
    },
    {
      name        = "session_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Backtest or paper trading session ID"
    },
    {
      name        = "symbol"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Stock symbol (e.g., AAPL, SPY)"
    },
    {
      name        = "action_type"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "BUY, SELL, or HOLD"
    },
    {
      name        = "quantity"
      type        = "INTEGER"
      mode        = "NULLABLE"
      description = "Number of shares to trade"
    },
    {
      name        = "price"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Price at which trade was executed"
    },
    {
      name        = "confidence"
      type        = "FLOAT"
      mode        = "REQUIRED"
      description = "Agent's confidence in the decision (0.0 to 1.0)"
    },
    {
      name        = "reasoning"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Agent's explanation for the decision"
    },
    {
      name        = "market_context"
      type        = "RECORD"
      mode        = "NULLABLE"
      description = "Market context at time of decision"
      fields = [
        {
          name = "current_price"
          type = "FLOAT"
          mode = "NULLABLE"
        },
        {
          name = "volume"
          type = "INTEGER"
          mode = "NULLABLE"
        },
        {
          name = "daily_change"
          type = "FLOAT"
          mode = "NULLABLE"
        },
        {
          name = "daily_change_percent"
          type = "FLOAT"
          mode = "NULLABLE"
        },
        {
          name = "market_sentiment"
          type = "STRING"
          mode = "NULLABLE"
        },
        {
          name = "news_sentiment"
          type = "STRING"
          mode = "NULLABLE"
        }
      ]
    },
    {
      name        = "portfolio_value"
      type        = "FLOAT"
      mode        = "REQUIRED"
      description = "Total portfolio value at time of decision"
    },
    {
      name        = "position_value"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Value of the position being traded"
    },
    {
      name        = "indicators"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "JSON string of technical indicators used"
    },
    {
      name        = "trade_pnl"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Profit/Loss for this trade (filled after close)"
    },
    {
      name        = "daily_return"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Daily portfolio return"
    }
  ])

  depends_on = [google_bigquery_dataset.main]
}

resource "google_bigquery_table" "market_bars" {
  dataset_id = google_bigquery_dataset.main["market_data"].dataset_id
  table_id   = "bars"

  description = "Historical and real-time market data"

  time_partitioning {
    type  = "DAY"
    field = "timestamp"
  }

  clustering = ["symbol", "timeframe"]

  schema = jsonencode([
    {
      name        = "symbol"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Stock symbol (e.g., AAPL, SPY)"
    },
    {
      name        = "timestamp"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Bar timestamp"
    },
    {
      name        = "timeframe"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Bar timeframe (1Min, 5Min, 15Min, 1Hour, 1Day)"
    },
    {
      name        = "open"
      type        = "FLOAT"
      mode        = "REQUIRED"
      description = "Opening price"
    },
    {
      name        = "high"
      type        = "FLOAT"
      mode        = "REQUIRED"
      description = "Highest price"
    },
    {
      name        = "low"
      type        = "FLOAT"
      mode        = "REQUIRED"
      description = "Lowest price"
    },
    {
      name        = "close"
      type        = "FLOAT"
      mode        = "REQUIRED"
      description = "Closing price"
    },
    {
      name        = "volume"
      type        = "INTEGER"
      mode        = "REQUIRED"
      description = "Trading volume"
    },
    {
      name        = "trade_count"
      type        = "INTEGER"
      mode        = "NULLABLE"
      description = "Number of trades"
    },
    {
      name        = "vwap"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Volume Weighted Average Price"
    },
    {
      name        = "ingested_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "When the data was ingested"
    },
    {
      name        = "source"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Data source (alpaca)"
    }
  ])

  depends_on = [google_bigquery_dataset.main]
}

resource "google_bigquery_table" "news_articles" {
  dataset_id = google_bigquery_dataset.main["news_data"].dataset_id
  table_id   = "articles"

  description = "Financial news articles with sentiment analysis"

  time_partitioning {
    type  = "DAY"
    field = "published_at"
  }

  clustering = ["source"]

  schema = jsonencode([
    {
      name        = "article_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Unique identifier for the article"
    },
    {
      name        = "published_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "When the article was published"
    },
    {
      name        = "title"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Article title"
    },
    {
      name        = "summary"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Article summary"
    },
    {
      name        = "content"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Full article content"
    },
    {
      name        = "url"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Article URL"
    },
    {
      name        = "source"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "News source"
    },
    {
      name        = "author"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Article author"
    },
    {
      name        = "symbols"
      type        = "STRING"
      mode        = "REPEATED"
      description = "Stock symbols mentioned in the article"
    },
    {
      name        = "category"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Article category (earnings, merger, market, etc.)"
    },
    {
      name        = "sentiment"
      type        = "RECORD"
      mode        = "NULLABLE"
      description = "Sentiment analysis results"
      fields = [
        {
          name        = "polarity"
          type        = "FLOAT"
          mode        = "NULLABLE"
          description = "Sentiment polarity (-1.0 to 1.0)"
        },
        {
          name        = "subjectivity"
          type        = "FLOAT"
          mode        = "NULLABLE"
          description = "Sentiment subjectivity (0.0 to 1.0)"
        },
        {
          name        = "label"
          type        = "STRING"
          mode        = "NULLABLE"
          description = "Sentiment label (positive, negative, neutral)"
        }
      ]
    },
    {
      name        = "importance_score"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Calculated importance score (0.0 to 1.0)"
    },
    {
      name        = "ingested_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "When the article was ingested"
    },
    {
      name        = "processed_at"
      type        = "TIMESTAMP"
      mode        = "NULLABLE"
      description = "When sentiment analysis was completed"
    }
  ])

  depends_on = [google_bigquery_dataset.main]
}

# ============================================================================
# PUB/SUB - Simple topics and subscriptions
# ============================================================================

resource "google_pubsub_topic" "main" {
  for_each = {
    market_data    = "Real-time market data"
    trading_events = "Trading events and signals"
  }

  name = each.key

  message_retention_duration = "86400s" # 1 day

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_subscription" "main" {
  for_each = {
    market_data_paper   = "market_data"
    trading_events_fmel = "trading_events"
  }

  name  = each.key
  topic = google_pubsub_topic.main[each.value].name

  message_retention_duration = "604800s" # 7 days
  ack_deadline_seconds       = 60

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  depends_on = [google_pubsub_topic.main]
}

# ============================================================================
# CLOUD STORAGE - Simple buckets for artifacts
# ============================================================================

resource "google_storage_bucket" "main" {
  for_each = {
    agent_code      = "Trading agent code files"
    terraform_state = "Terraform state backend"
  }

  name     = "${var.project_id}-${each.key}"
  location = var.region

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 90 # Delete old versions after 90 days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# ============================================================================
# MEMORYSTORE REDIS - For leaderboard caching
# ============================================================================

resource "google_redis_instance" "main" {
  name           = "farm-redis"
  memory_size_gb = 1 # Minimum size
  region         = var.region

  # Basic tier is sufficient for caching
  tier = "BASIC"

  redis_version = "REDIS_6_X"

  authorized_network = google_compute_network.main.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  depends_on = [google_compute_network.main]
}

# VPC connector for Cloud Functions to access Redis
resource "google_vpc_access_connector" "main" {
  name          = "farm-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.main.name

  depends_on = [google_compute_network.main]
}

# ============================================================================
# OUTPUTS - Essential information for deployment
# ============================================================================

output "gke_cluster_name" {
  value = google_container_cluster.main.name
}

output "gke_cluster_endpoint" {
  value     = google_container_cluster.main.endpoint
  sensitive = true
}

output "redis_host" {
  value = google_redis_instance.main.host
}

output "redis_port" {
  value = google_redis_instance.main.port
}

output "vpc_connector_name" {
  value = google_vpc_access_connector.main.name
}

output "gke_service_account" {
  value = google_service_account.gke_workload.email
}

output "function_service_account" {
  value = google_service_account.cloud_function.email
}

output "bigquery_datasets" {
  value = {
    for k, v in google_bigquery_dataset.main : k => v.dataset_id
  }
}

output "pubsub_topics" {
  value = {
    for k, v in google_pubsub_topic.main : k => v.name
  }
}

output "storage_buckets" {
  value = {
    for k, v in google_storage_bucket.main : k => v.name
  }
}

# ============================================================================
# MONITORING - Alert Policies, Notification Channels, and Dashboards
# ============================================================================

# Notification channel for alerts
resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "Email Notifications"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }

  enabled = true
}

# Alert Policy: High Error Rate - Cloud Functions
resource "google_monitoring_alert_policy" "high_error_rate" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "High Error Rate - Cloud Functions"
  combiner     = "OR"

  documentation {
    content   = "Cloud Functions are experiencing high error rates (>5% for 5 minutes)"
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Error rate above 5%"
    condition_threshold {
      filter          = "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.label.status!=\"ok\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
  alert_strategy {
    auto_close = "1800s"
  }
}

# Alert Policy: GKE High CPU Usage
resource "google_monitoring_alert_policy" "gke_high_cpu" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "GKE High CPU Usage"
  combiner     = "OR"

  documentation {
    content   = "Kubernetes pods are using high CPU (>80% for 5 minutes)"
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "CPU usage above 80%"
    condition_threshold {
      filter          = "resource.type=\"k8s_container\" AND resource.label.namespace_name=\"trading-agents\" AND metric.type=\"kubernetes.io/container/cpu/core_usage_time\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = ["resource.label.pod_name"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
}

# Alert Policy: BigQuery High Slot Usage
resource "google_monitoring_alert_policy" "bigquery_high_slots" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "BigQuery High Slot Usage"
  combiner     = "OR"

  documentation {
    content   = "BigQuery is using too many slots (>1000 for 10 minutes) - potential cost issue"
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Slot usage above 1000"
    condition_threshold {
      filter          = "resource.type=\"bigquery_project\" AND metric.type=\"bigquery.googleapis.com/slots/total_allocated\""
      duration        = "600s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1000

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
}

# Alert Policy: Paper Trading Pod Failures
resource "google_monitoring_alert_policy" "pod_failures" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "Paper Trading Pod Failures"
  combiner     = "OR"

  documentation {
    content   = "Paper trading pods are failing or restarting frequently (>3 restarts in 10 minutes)"
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "Pod restart rate too high"
    condition_threshold {
      filter          = "resource.type=\"k8s_container\" AND resource.label.namespace_name=\"trading-agents\" AND metric.type=\"kubernetes.io/container/restart_count\""
      duration        = "600s"
      comparison      = "COMPARISON_GT"
      threshold_value = 3

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_MAX"
        group_by_fields      = ["resource.label.pod_name"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email[0].id]
}

# Dashboard: Trading Platform Overview
resource "google_monitoring_dashboard" "main" {
  dashboard_json = jsonencode({
    displayName = "Spooky Labs - Trading Platform Dashboard"
    mosaicLayout = {
      tiles = [
        {
          width  = 6
          height = 4
          widget = {
            title = "Cloud Functions - Request Count"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.function_name"]
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              yAxis = {
                label = "Requests/sec"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          width  = 6
          height = 4
          xPos   = 6
          widget = {
            title = "Cloud Functions - Error Rate"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.label.status!=\"ok\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.function_name"]
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              yAxis = {
                label = "Errors/sec"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          width  = 6
          height = 4
          yPos   = 4
          widget = {
            title = "GKE - CPU Usage"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_container\" AND resource.label.namespace_name=\"trading-agents\" AND metric.type=\"kubernetes.io/container/cpu/core_usage_time\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_MEAN"
                      groupByFields      = ["resource.label.pod_name"]
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              yAxis = {
                label = "CPU Cores"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          width  = 6
          height = 4
          xPos   = 6
          yPos   = 4
          widget = {
            title = "GKE - Memory Usage"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_container\" AND resource.label.namespace_name=\"trading-agents\" AND metric.type=\"kubernetes.io/container/memory/used_bytes\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_MEAN"
                      groupByFields      = ["resource.label.pod_name"]
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              yAxis = {
                label = "Memory (bytes)"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          width  = 6
          height = 4
          yPos   = 8
          widget = {
            title = "Redis - Operations/sec"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"redis_instance\" AND metric.type=\"redis.googleapis.com/stats/operations_count\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              yAxis = {
                label = "Ops/sec"
                scale = "LINEAR"
              }
            }
          }
        },
        {
          width  = 6
          height = 4
          xPos   = 6
          yPos   = 8
          widget = {
            title = "BigQuery - Bytes Processed"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"bigquery_project\" AND metric.type=\"bigquery.googleapis.com/query/scanned_bytes\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType   = "LINE"
                targetAxis = "Y1"
              }]
              yAxis = {
                label = "Bytes/sec"
                scale = "LINEAR"
              }
            }
          }
        }
      ]
    }
  })
}

output "monitoring_dashboard_url" {
  value       = "https://console.cloud.google.com/monitoring/dashboards/custom/${google_monitoring_dashboard.main.id}?project=${var.project_id}"
  description = "URL to the Cloud Monitoring dashboard"
}

output "alert_policies_enabled" {
  value       = var.alert_email != "" ? "Yes - alerts will be sent to ${var.alert_email}" : "No - set alert_email to enable alerts"
  description = "Whether alert policies are enabled"
}

output "notification_channel" {
  value       = var.alert_email != "" ? google_monitoring_notification_channel.email[0].name : "No notification channel created"
  description = "Notification channel for alerts"
}