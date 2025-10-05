# API Gateway + Cloud Run Architecture for Spooky Labs
# Clean, modular infrastructure as code

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    # Set via: terraform init -backend-config="bucket=PROJECT_ID-terraform-state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ============================================================================
# VARIABLES
# ============================================================================

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

# ============================================================================
# API GATEWAY
# ============================================================================

# API Gateway API
resource "google_api_gateway_api" "main" {
  provider     = google-beta
  api_id       = "spooky-labs-api"
  display_name = "Spooky Labs Trading Platform API"

  labels = {
    environment = var.environment
    team        = "platform"
  }
}

# API Gateway Configuration
resource "google_api_gateway_api_config" "main" {
  provider      = google-beta
  api           = google_api_gateway_api.main.api_id
  api_config_id = "api-config-${substr(md5(file("${path.module}/../api-gateway/openapi-spec.yaml")), 0, 8)}"
  display_name  = "API Config"

  openapi_documents {
    document {
      path = "spec.yaml"
      contents = base64encode(templatefile("${path.module}/../api-gateway/openapi-spec.yaml", {
        PROJECT_ID = var.project_id
        HASH       = substr(md5(timestamp()), 0, 8)
      }))
    }
  }

  gateway_config {
    backend_config {
      google_service_account = google_service_account.api_gateway.email
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# API Gateway Deployment
resource "google_api_gateway_gateway" "main" {
  provider     = google-beta
  gateway_id   = "spooky-labs-gateway"
  display_name = "Spooky Labs API Gateway"
  api_config   = google_api_gateway_api_config.main.id
  region       = var.region

  labels = {
    environment = var.environment
  }
}

# ============================================================================
# SERVICE ACCOUNTS
# ============================================================================

# API Gateway Service Account
resource "google_service_account" "api_gateway" {
  account_id   = "api-gateway-sa"
  display_name = "API Gateway Service Account"
}

# Cloud Run Services Service Account
resource "google_service_account" "cloud_run" {
  account_id   = "cloud-run-services-sa"
  display_name = "Cloud Run Services Service Account"
}

# ============================================================================
# IAM PERMISSIONS
# ============================================================================

# API Gateway permissions
resource "google_project_iam_member" "api_gateway_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.api_gateway.email}"
}

# Cloud Run service permissions
resource "google_project_iam_member" "cloud_run_permissions" {
  for_each = toset([
    "roles/firestore.dataEditor",
    "roles/storage.objectAdmin",
    "roles/bigquery.dataEditor",
    "roles/pubsub.publisher",
    "roles/redis.editor",
    "roles/cloudbuild.builds.editor"
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ============================================================================
# CLOUD RUN SERVICES
# ============================================================================

# Define all services
locals {
  services = {
    "agents-service" = {
      cpu    = "1"
      memory = "512Mi"
      env_vars = {
        PROJECT_ID = var.project_id
      }
    }
    "backtest-service" = {
      cpu    = "1"
      memory = "1Gi"
      env_vars = {
        PROJECT_ID = var.project_id
      }
    }
    "paper-trading-service" = {
      cpu    = "2"
      memory = "2Gi"
      env_vars = {
        PROJECT_ID = var.project_id
      }
    }
    "leaderboard-service" = {
      cpu    = "1"
      memory = "512Mi"
      env_vars = {
        PROJECT_ID  = var.project_id
        REDIS_HOST  = google_redis_instance.main.host
      }
    }
    "fmel-service" = {
      cpu    = "1"
      memory = "1Gi"
      env_vars = {
        PROJECT_ID = var.project_id
      }
    }
  }
}

# Cloud Run Services
resource "google_cloud_run_service" "services" {
  for_each = local.services

  name     = each.key
  location = var.region

  template {
    spec {
      service_account_name = google_service_account.cloud_run.email

      containers {
        image = "gcr.io/${var.project_id}/${each.key}:latest"

        resources {
          limits = {
            cpu    = each.value.cpu
            memory = each.value.memory
          }
        }

        dynamic "env" {
          for_each = each.value.env_vars
          content {
            name  = env.key
            value = env.value
          }
        }

        # Add service mesh headers
        env {
          name  = "SERVICE_NAME"
          value = each.key
        }

        # Health check endpoint
        startup_probe {
          http_get {
            path = "/health"
          }
          initial_delay_seconds = 10
          period_seconds        = 10
        }

        liveness_probe {
          http_get {
            path = "/health"
          }
          period_seconds = 30
        }
      }

      # Auto-scaling configuration
      container_concurrency = 100
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/minScale" = "0"  # Scale to zero
        "autoscaling.knative.dev/maxScale" = "10"
        "run.googleapis.com/startup-cpu-boost" = "true"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }

  lifecycle {
    ignore_changes = [
      template[0].spec[0].containers[0].image,  # Ignore image changes (managed by CI/CD)
    ]
  }
}

# Allow unauthenticated access for public endpoints (API Gateway will handle auth)
resource "google_cloud_run_service_iam_member" "public_access" {
  for_each = google_cloud_run_service.services

  service  = each.value.name
  location = each.value.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.api_gateway.email}"
}

# ============================================================================
# REDIS (for Leaderboard)
# ============================================================================

resource "google_redis_instance" "main" {
  name           = "leaderboard-redis"
  memory_size_gb = 1
  region         = var.region
  redis_version  = "REDIS_7_0"

  tier = "BASIC"  # Use STANDARD_HA for production

  auth_enabled = true

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 3
        minutes = 0
      }
    }
  }
}

# ============================================================================
# PUBSUB TOPICS (for async communication)
# ============================================================================

locals {
  pubsub_topics = [
    "backtest-requests",
    "paper-trading-commands",
    "leaderboard-updates",
    "fmel-records"
  ]
}

resource "google_pubsub_topic" "topics" {
  for_each = toset(local.pubsub_topics)
  name     = each.value

  message_retention_duration = "86400s"  # 1 day
}

resource "google_pubsub_subscription" "subscriptions" {
  for_each = toset(local.pubsub_topics)

  name  = "${each.value}-sub"
  topic = google_pubsub_topic.topics[each.value].id

  ack_deadline_seconds = 600

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }
}

resource "google_pubsub_topic" "dead_letter" {
  name = "dead-letter-queue"
}

# ============================================================================
# ARTIFACT REGISTRY (for container images)
# ============================================================================

resource "google_artifact_registry_repository" "services" {
  location      = var.region
  repository_id = "cloud-run-services"
  format        = "DOCKER"

  description = "Docker images for Cloud Run services"

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }
}

# ============================================================================
# CLOUD BUILD TRIGGER (for CI/CD)
# ============================================================================

resource "google_cloudbuild_trigger" "deploy_services" {
  name        = "deploy-cloud-run-services"
  description = "Deploy Cloud Run services on push to main"

  github {
    owner = "Spooky-Labs"
    name  = "The-Farm-Mark-II"
    push {
      branch = "^main$"
    }
  }

  included_files = ["cloud-run-services/**"]

  build {
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "build",
        "-t", "gcr.io/${var.project_id}/$${_SERVICE_NAME}:$${COMMIT_SHA}",
        "-t", "gcr.io/${var.project_id}/$${_SERVICE_NAME}:latest",
        "cloud-run-services/$${_SERVICE_NAME}"
      ]
    }

    step {
      name = "gcr.io/cloud-builders/docker"
      args = ["push", "--all-tags", "gcr.io/${var.project_id}/$${_SERVICE_NAME}"]
    }

    step {
      name = "gcr.io/cloud-builders/gcloud"
      args = [
        "run", "deploy", "$${_SERVICE_NAME}",
        "--image", "gcr.io/${var.project_id}/$${_SERVICE_NAME}:$${COMMIT_SHA}",
        "--region", var.region
      ]
    }

    substitutions = {
      _SERVICE_NAME = "agents-service"  # Will be parameterized
    }
  }
}

# ============================================================================
# MONITORING & ALERTING
# ============================================================================

resource "google_monitoring_dashboard" "api_dashboard" {
  dashboard_json = jsonencode({
    displayName = "API Gateway & Cloud Run Dashboard"
    gridLayout = {
      widgets = [
        {
          title = "API Gateway Requests"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"api\" resource.labels.service=\"${google_api_gateway_api.main.api_id}\""
                }
              }
            }]
          }
        },
        {
          title = "Cloud Run Service Latency"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" metric.type=\"run.googleapis.com/request_latencies\""
                }
              }
            }]
          }
        }
      ]
    }
  })
}

# ============================================================================
# OUTPUTS
# ============================================================================

output "api_gateway_url" {
  value       = "https://${google_api_gateway_gateway.main.id}-${substr(google_api_gateway_gateway.main.id, 0, 8)}.${var.region}.gateway.dev"
  description = "API Gateway URL"
}

output "cloud_run_service_urls" {
  value = {
    for name, service in google_cloud_run_service.services :
    name => service.status[0].url
  }
  description = "Cloud Run service URLs"
}

output "redis_host" {
  value       = google_redis_instance.main.host
  description = "Redis instance host"
}