# BigQuery Schemas (Deprecated)

⚠️ **DEPRECATED:** This directory is kept for reference only.

## Migration to Terraform

All BigQuery table schemas have been migrated to Terraform for proper Infrastructure as Code management.

### What Changed

**Before (Manual):**
- Table schemas defined in JSON files (`schemas/*.json`)
- Tables created manually via `bq mk` commands in `scripts/deploy.sh`
- Separate from infrastructure deployment

**Now (Terraform):**
- All table schemas in `terraform/main.tf`
- Automatically deployed with infrastructure
- Version-controlled and reproducible
- Tables include partitioning and clustering optimizations

### Tables Now in Terraform

1. **`fmel.trading_decisions`** - Trading decisions with FMEL data
   - Partitioned by: `timestamp` (daily)
   - Clustered by: `agent_id`, `user_id`
   - Source: `trading_decisions.json` ➜ `terraform/main.tf:239-390`

2. **`market_data.bars`** - Historical and real-time market data
   - Partitioned by: `timestamp` (daily)
   - Clustered by: `symbol`, `timeframe`
   - Source: `market_bars.json` ➜ `terraform/main.tf:392-481`

3. **`news_data.articles`** - Financial news with sentiment analysis
   - Partitioned by: `published_at` (daily)
   - Clustered by: `source`
   - Source: `news_articles.json` ➜ `terraform/main.tf:483-604`

### Benefits of Terraform Migration

1. **Infrastructure as Code** - Schemas version-controlled with infrastructure
2. **Automated Deployment** - No manual `bq mk` commands
3. **Optimized by Default** - Partitioning and clustering configured
4. **Reproducible** - Consistent across environments
5. **Easy Updates** - Change schema in one place

### How Tables Are Created Now

Simply run:
```bash
cd terraform
terraform apply
```

Terraform automatically:
- Creates datasets (`fmel`, `market_data`, `news_data`)
- Creates tables with schemas
- Sets up partitioning and clustering
- Configures IAM permissions

### Reference Files

The files in this directory are kept as reference:
- `trading_decisions.json` - Original FMEL schema
- `market_bars.json` - Original market data schema
- `news_articles.json` - Original news data schema
- `fmel_unified_schema.sql` - SQL reference format

**DO NOT USE THESE FILES** - They are no longer read by any scripts.

### Migration for Existing Deployments

If you have existing tables created from these JSON files:

**Option 1: Import to Terraform (Recommended)**
```bash
cd terraform
terraform import google_bigquery_table.trading_decisions PROJECT_ID/fmel/trading_decisions
terraform import google_bigquery_table.market_bars PROJECT_ID/market_data/bars
terraform import google_bigquery_table.news_articles PROJECT_ID/news_data/articles
```

**Option 2: Recreate (Fresh Start)**
```bash
# Backup existing data (optional)
bq extract --destination_format=AVRO \
  PROJECT_ID:fmel.trading_decisions \
  gs://backup-bucket/trading_decisions_backup/*

# Delete old tables
bq rm -f -t PROJECT_ID:fmel.trading_decisions
bq rm -f -t PROJECT_ID:market_data.bars
bq rm -f -t PROJECT_ID:news_data.articles

# Let Terraform create new tables
cd terraform
terraform apply
```

### Verify Terraform Configuration

Check that tables are defined in Terraform:
```bash
cd terraform
terraform plan | grep google_bigquery_table
```

You should see:
```
# google_bigquery_table.trading_decisions will be created
# google_bigquery_table.market_bars will be created
# google_bigquery_table.news_articles will be created
```

### Related Documentation

- [Terraform Configuration](../terraform/README.md)
- [Deployment Guide](../docs/deployment/DEPLOYMENT.md)
- [Data Platform Architecture](../docs/architecture/DATA_PLATFORM.md)

---

**Last Updated:** 2025-09-30
**Status:** Deprecated - Use Terraform instead
**Migration:** Complete - All schemas in `terraform/main.tf`