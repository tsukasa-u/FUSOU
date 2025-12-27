# D1 SQL Schemas

This directory contains SQL schemas for Cloudflare D1 databases.

## Active Schemas

- `asset-index.sql`: Schema for `dev_kc_asset_index` (Active). Used by `FUSOU-WEB` and asset services.
- `hot-cold-schema.sql` (Deprecated/Merged): This file has been consolidated into `../workflow/schema.sql`. Please use the workflow schema for the Hot/Cold architecture.

## Deprecated/Reference

- `deprecated_asset_index_ref.sql` (formerly `schema.sql`): Old schema for asset index, kept for reference.
- `deprecated_parquet_battle_index.sql` (formerly `battle-index.sql`): Old Parquet-based schema. Replaced by Avro architecture.
- `avro-schema.sql`: Early Avro schema. The active Avro schema (with Hot/Cold support) is in `../workflow/schema.sql`.

## Note

The main Battle Index database (`dev_kc_battle_index`) schema is located in `../workflow/schema.sql` as it is managed by the FUSOU-WORKFLOW package.
