# Monitoring Configuration (Deprecated)

⚠️ **DEPRECATED:** This directory is kept for reference only.

## Migration to Terraform

All monitoring resources (alert policies, dashboards, notification channels) have been migrated to Terraform for proper Infrastructure as Code management.

### What Changed

**Before (Manual):**
- Alert policies defined in `alerts.yaml`
- Dashboard defined in `dashboard.json`
- Manual deployment via `setup-monitoring.sh`

**Now (Terraform):**
- All monitoring resources in `terraform/main.tf`
- Automatically deployed with infrastructure
- Version-controlled and reproducible
- Conditional deployment based on `alert_email` variable

### How to Use Monitoring

1. **View Dashboard** (always available after `terraform apply`):
   ```bash
   cd terraform
   terraform output monitoring_dashboard_url
   ```
   Or visit: https://console.cloud.google.com/monitoring/dashboards

2. **Enable Alert Policies** (optional) - Set the `alert_email` variable in `terraform/terraform.tfvars`:
   ```hcl
   alert_email = "alerts@example.com"
   ```

3. **Deploy/Update with Terraform:**
   ```bash
   cd terraform
   terraform apply
   ```

### Monitoring Resources Included

**Always Created (by default):**
- **1 Dashboard** with 6 widgets:
  - Cloud Functions request count
  - Cloud Functions error rate
  - GKE CPU usage
  - GKE memory usage
  - Redis operations/sec
  - BigQuery bytes processed

**Created when `alert_email` is set:**
- **1 Notification Channel** (email)
- **4 Alert Policies:**
  - High Error Rate - Cloud Functions (>5% for 5 min)
  - GKE High CPU Usage (>80% for 5 min)
  - BigQuery High Slot Usage (>1000 for 10 min)
  - Paper Trading Pod Failures (>3 restarts in 10 min)

### Reference Files

The files in this directory are kept as reference:
- `alerts.yaml` - Original alert policy definitions
- `dashboard.json` - Original dashboard configuration
- `setup-monitoring.sh` - Original setup script (DO NOT USE)

### Related Documentation

- [Terraform Configuration](../terraform/README.md)
- [Operations Guide](../docs/operations/OPERATIONS.md)
- [Architecture Overview](../docs/architecture/ARCHITECTURE.md)

---

**Last Updated:** 2025-09-30
**Status:** Deprecated - Use Terraform instead