# SQL Schemas and Migrations

This directory consolidates all SQL files for the FUSOU project.

## Directory Structure

- `d1/`: Cloudflare D1 schema definitions.
  - `schema.sql`: Canonical D1 schema used for workflow/battle/quest/master-data setup.
- `tidb/`: TiDB schema definitions.
  - `schema.sql`: TiDB table definition for hot buffer (`buffer_logs`).
  - `migration_0001_rename_schema_version.sql`: TiDB migration script.
- `supabase/`: Supabase schemas and migrations.
  - `schema.sql`: Main Supabase schema (User/Auth integration).
  - `migrations/`: Supabase CLI migrations.

## Workflow Integration

- **FUSOU-WORKFLOW**: Uses `docs/sql/d1/schema.sql` for `schema:local` and `schema:remote` execution.
- **TiDB setups**: Use `docs/sql/tidb/schema.sql` in TiDB Console for `buffer_logs`.
- **FUSOU-WEB**: Uses per-database migrations in `packages/FUSOU-WEB/migrations/*` via `migrations_dir` in `wrangler.toml`.
