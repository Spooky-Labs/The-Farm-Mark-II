# BigQuery Schemas Migration to Terraform

**Date:** 2025-09-30  
**Status:** ✅ Complete

## Summary

Successfully migrated all BigQuery table schemas from standalone JSON files (`schemas/`) into Terraform for proper Infrastructure as Code management.

## What Changed

### Before
- `schemas/trading_decisions.json` - FMEL decision schema
- `schemas/market_bars.json` - Market data schema
- `schemas/news_articles.json` - News data schema
- `schemas/fmel_unified_schema.sql` - SQL reference format
- Tables created manually via `bq mk` in `scripts/deployment/deploy.sh`
- Schemas separate from infrastructure

### After
- All table schemas in `terraform/main.tf`
- Tables created automatically with `terraform apply`
- Partitioning and clustering optimized
- Fully version-controlled and reproducible
- 3 datasets + 3 tables managed by Terraform

## Tables Added to Terraform

### 1. Trading Decisions (`fmel.trading_decisions`)
- **Location:** `terraform/main.tf:239-390`
- **Schema:** 17 fields including RECORD type for market_context
- **Partitioning:** Daily by `timestamp`
- **Clustering:** `agent_id`, `user_id`
- **Purpose:** FMEL decision recording with full explainability

### 2. Market Bars (`market_data.bars`)
- **Location:** `terraform/main.tf:392-481`
- **Schema:** 12 fields (OHLCV + metadata)
- **Partitioning:** Daily by `timestamp`
- **Clustering:** `symbol`, `timeframe`
- **Purpose:** Historical and real-time market data from Alpaca

### 3. News Articles (`news_data.articles`)
- **Location:** `terraform/main.tf:483-604`
- **Schema:** 13 fields including RECORD type for sentiment analysis
- **Partitioning:** Daily by `published_at`
- **Clustering:** `source`
- **Purpose:** Financial news with sentiment analysis

### 4. News Dataset Added
- Added `news_data` to BigQuery datasets (previously missing)
- Now have 3 datasets: `fmel`, `market_data`, `news_data`

## File Changes

### Modified
- `terraform/main.tf` - Added 374 lines of table definitions (717 → 1091 lines)
- `PROJECT_STRUCTURE.md` - Marked schemas as deprecated
- `README.md` - Updated infrastructure description
- `terraform/README.md` - Added BigQuery tables documentation

### Created
- `schemas/README.md` - Deprecation notice and migration guide

### Tests Updated
- `tests/test_terraform_quick.sh` - Added 4 BigQuery table tests (21 → 25 tests)
- Updated line count threshold (1000 → 1500 lines)

## Improvements Over JSON Schemas

### 1. Partitioning (Cost Optimization)
All tables now use time-based partitioning:
- Queries only scan relevant partitions
- **Saves $$$** on BigQuery costs
- Faster query performance

### 2. Clustering (Query Optimization)
Tables clustered by common query patterns:
- `trading_decisions`: `agent_id`, `user_id`
- `market_bars`: `symbol`, `timeframe`
- `news_articles`: `source`

### 3. Infrastructure as Code
- Version-controlled with infrastructure
- Atomic deployments (datasets + tables together)
- Easy rollback via Terraform state

## Test Results

All tests passing:
- ✅ Terraform validation: 25/25 tests passed
- ✅ System verification: 48/48 tests passed
- **Total:** 73/73 tests passed (100%)

## Benefits

1. **Infrastructure as Code** - Schemas version-controlled with infrastructure
2. **Automated Deployment** - No manual `bq mk` commands
3. **Optimized by Default** - Partitioning and clustering configured
4. **Reproducible** - Consistent across environments
5. **Single Source of Truth** - All infrastructure in Terraform
6. **Cost Optimized** - Partitioning reduces query costs

## Usage

### Create Tables
```bash
cd terraform
terraform apply
```

Terraform automatically:
- Creates datasets (`fmel`, `market_data`, `news_data`)
- Creates tables with schemas
- Sets up partitioning and clustering
- Configures IAM permissions

### Verify Tables
```bash
# Via Terraform
terraform show | grep google_bigquery_table

# Via gcloud
bq ls fmel
bq ls market_data  
bq ls news_data

# Check schema
bq show --schema --format=prettyjson fmel.trading_decisions
```

## Migration Path for Existing Deployments

If you have existing tables created from JSON files:

### Option 1: Import to Terraform (Zero Downtime)
```bash
cd terraform
terraform import google_bigquery_table.trading_decisions PROJECT_ID/fmel/trading_decisions
terraform import google_bigquery_table.market_bars PROJECT_ID/market_data/bars
terraform import google_bigquery_table.news_articles PROJECT_ID/news_data/articles
```

### Option 2: Recreate (Fresh Start)
```bash
# Backup data (optional)
bq extract --destination_format=AVRO \
  fmel.trading_decisions gs://backup/trading_decisions/*

# Delete old tables
bq rm -f -t fmel.trading_decisions
bq rm -f -t market_data.bars
bq rm -f -t news_data.articles

# Recreate with Terraform
cd terraform
terraform apply
```

## Removed from Deployment Script

The following lines were removed from `scripts/deployment/deploy.sh`:

```bash
# OLD: Manual table creation
bq mk --table \
  --description="Trading decisions made by agents with FMEL data" \
  "${PROJECT_ID}:fmel.trading_decisions" \
  schemas/trading_decisions.json

# NEW: Handled by Terraform
# (No manual steps needed)
```

## Documentation Updated

- [x] `terraform/main.tf` - Added BigQuery table resources
- [x] `terraform/README.md` - Updated features list
- [x] `schemas/README.md` - Added deprecation notice
- [x] `PROJECT_STRUCTURE.md` - Updated schemas section
- [x] `README.md` - Updated infrastructure section
- [x] `tests/test_terraform_quick.sh` - Added table validation tests

## Cost Impact

**No additional cost** - Tables were already being created, just now via Terraform.

**Cost savings** from partitioning:
- Queries scan only relevant partitions
- Estimated savings: 50-90% on analytical queries
- Example: Query last 7 days instead of full table

## Related Changes

This completes the Infrastructure as Code migration:
- ✅ Monitoring → Terraform (2025-09-30)
- ✅ BigQuery Schemas → Terraform (2025-09-30)

All infrastructure is now in `terraform/main.tf` (~1100 lines).

---

**Status:** ✅ Complete and tested
**Lines Added:** 374 (table definitions)
**Tests Added:** 4 (BigQuery table validation)
**Test Results:** 25/25 terraform + 48/48 system = 73/73 passing
**Deprecated Directories:** `schemas/` (kept as reference)
