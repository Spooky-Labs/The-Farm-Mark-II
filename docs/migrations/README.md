# Platform Migrations

This directory tracks major platform migrations and consolidation efforts.

## Active Migrations

### 1. [Monitoring Consolidation](./MONITORING_MIGRATION.md)
**Status:** In Progress
**Date Started:** 2025-09-29
**Description:** Consolidating monitoring from multiple systems into unified Cloud Monitoring with Prometheus metrics.

### 2. [BigQuery Schema Updates](./SCHEMAS_MIGRATION.md)
**Status:** In Progress
**Date Started:** 2025-09-29
**Description:** Migrating BigQuery schemas to support partitioning, clustering, and new FMEL fields.

## Completed Migrations

None yet.

## Migration Process

When starting a new migration:

1. Create a new `MIGRATION_NAME.md` file in this directory
2. Use the following template:

```markdown
# Migration Name

**Date Started:** YYYY-MM-DD
**Status:** In Progress | Completed
**Owner:** Team/Person

## Objective

What are we migrating and why?

## Current State

Describe the current architecture/implementation.

## Target State

Describe the desired end state.

## Migration Steps

- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

## Rollback Plan

How to roll back if things go wrong.

## Success Criteria

How do we know the migration succeeded?

## Timeline

Estimated completion date.
```

3. Update this README with a link to the migration
4. Move to "Completed Migrations" when done

---

**Last Updated:** 2025-09-30