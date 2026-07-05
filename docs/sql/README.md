# SQL Schemas and Migrations

This directory consolidates all SQL files for the FUSOU project.

## Directory Structure

- `d1/`: Cloudflare D1 schema definitions.
  - `schema.sql`: Canonical D1 schema used for workflow/battle/quest/master-data setup.
- `turso/`: Turso (libSQL) schema definitions.
  - `schema.sql`: Canonical Turso schema for hot buffer tables (`buffer_logs_active`, `buffer_logs_processing`).
  - `migration_0001_create_buffer_tables.sql`: Initial migration for hot buffer tables.
- `tidb/`: TiDB schema definitions.
  - `schema.sql`: TiDB table definition for hot buffer (`buffer_logs`).
  - `migration_0001_rename_schema_version.sql`: TiDB migration script.
- `supabase/`: Supabase schemas and migrations.
  - `schema.sql`: Main Supabase schema (User/Auth integration).
  - `migrations/`: Supabase CLI migrations.

## Workflow Integration

- **FUSOU-WORKFLOW**: Uses `docs/sql/d1/schema.sql` for `schema:local` and `schema:remote` execution.
- **FUSOU-WORKFLOW hot buffer**: Uses `docs/sql/turso/schema.sql` on Turso.
- **TiDB setups**: Kept as legacy reference only.
- **FUSOU-WEB**: Uses per-database migrations in `packages/FUSOU-WEB/migrations/*` via `migrations_dir` in `wrangler.toml`.
