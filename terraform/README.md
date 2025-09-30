# Terraform Configuration

## Overview

This is a **single-file Terraform configuration** that maintains all production features while being easier to understand and deploy.

## Architecture

### Design Philosophy
- **Single main.tf file** (~400 lines)
- **8-10 minute deployment**
- **Clear, linear structure**
- **Production-ready** with all essential features
- **YAGNI principle** - Just what's needed, nothing more

## Features

✅ **All critical infrastructure included:**
- Private GKE cluster with auto-scaling (1-3 nodes)
- Workload Identity for security
- BigQuery datasets + tables (FMEL, market data, news) with partitioning/clustering
- Pub/Sub for real-time data
- Redis for <10ms leaderboards
- Cloud Storage for artifacts
- Network isolation
- 2 service accounts with proper IAM
- **Cloud Monitoring** with dashboards and alert policies

## Quick Start

### 1. Configure Terraform

```bash
# Copy example configuration
cp terraform.tfvars.example terraform.tfvars

# Edit with your project ID and optional monitoring email
vim terraform.tfvars
# Set: project_id, region, and alert_email (for monitoring)
```

### 2. Initialize and Deploy

```bash
# Initialize Terraform
terraform init -backend-config="bucket=YOUR_PROJECT_ID-terraform-state"

# Review what will be created
terraform plan

# Deploy infrastructure (8-10 minutes)
terraform apply
```

### 3. Get Outputs

```bash
# Get cluster credentials
gcloud container clusters get-credentials $(terraform output -raw gke_cluster_name) \
  --region us-central1

# Get Redis connection info
echo "Redis Host: $(terraform output -raw redis_host)"
echo "Redis Port: $(terraform output -raw redis_port)"

# Get service accounts
echo "GKE SA: $(terraform output -raw gke_service_account)"
echo "Function SA: $(terraform output -raw function_service_account)"

# Get monitoring dashboard URL (always available)
terraform output monitoring_dashboard_url

# Check if alert policies are enabled
terraform output alert_policies_enabled
```

## Resource Costs

| Resource | Configuration | Cost/Month |
|----------|--------------|------------|
| GKE Cluster | 1-3 e2-standard-2 nodes | ~$70 |
| Redis | 1GB Basic tier | ~$48 |
| BigQuery | Storage + queries | ~$2 |
| Pub/Sub | Messages + storage | ~$5 |
| Cloud Storage | Versioned buckets | ~$1 |
| **Total** | | **~$126** |

## File Structure

```
terraform/
├── main.tf                 # All resources in one file
├── variables.tf            # Just 5 variables
├── terraform.tfvars.example # Example configuration
└── README.md               # This file
```

## Security

Production-level security maintained:

1. **Private GKE cluster** - Nodes have private IPs
2. **Workload Identity** - Secure pod authentication
3. **Least privilege IAM** - Only necessary permissions
4. **Network isolation** - Private VPC and subnets
5. **Secure boot** - Enabled on all nodes

## Why Single-File Works

1. **YAGNI Principle** - You Aren't Gonna Need It
   - Focus on what's actually needed now
   - No premature abstraction

2. **Single File Clarity**
   - Everything visible in one place
   - No jumping between modules
   - Clear dependency flow

3. **Terraform Best Practices**
   - Use `for_each` instead of `count`
   - Leverage Google's managed services
   - Trust platform defaults

4. **Maintenance Benefits**
   - New team members understand it quickly
   - Updates are straightforward
   - Debugging is simpler

## Support

This configuration is fully compatible with the rest of The Farm Mark II system. All deployment scripts and application code work without modification.

For questions, see the main project documentation or open an issue.