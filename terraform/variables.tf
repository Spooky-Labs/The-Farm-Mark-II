# The Farm Mark II - Simplified Variables
# Only essential configuration options

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region for resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (dev/staging/prod)"
  type        = string
  default     = "prod"
}

variable "alert_email" {
  description = "Email for monitoring alerts (creates notification channel, alert policies, and dashboard if provided)"
  type        = string
  default     = ""
}