# SQL Schemas and Migrations

This directory consolidates all SQL files for the FUSOU project.

## Directory Structure

- `d1/`: Cloudflare D1 schemas.
  - `asset-index.sql`: Active schema for `ASSET_INDEX_DB`.
  - `deprecated_*.sql`: Legacy schemas.
- `workflow/`: Schemas for FUSOU-WORKFLOW (Cloudflare D1).
  - `schema.sql`: Active schema for `BATTLE_INDEX_DB` (implements Hot/Cold architecture).
  - `migrations/`: Migration history.
- `supabase/`: Supabase schemas and migrations.
  - `schema.sql`: Main Supabase schema (User/Auth integration).
  - `migrations/`: Supabase CLI migrations.

## Workflow Integration

- **FUSOU-WORKFLOW**: Uses `docs/sql/workflow/schema.sql` for `local` and `remote` schema execution.
- **FUSOU-WEB**: Uses `docs/sql/d1/asset-index.sql` for asset management.
