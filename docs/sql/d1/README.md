# D1 SQL Schemas

This directory contains SQL schemas for Cloudflare D1 databases.

## Active Schema

- `schema.sql`: Canonical D1 schema used by workflow-related setup and documentation.

## Notes

- The previously referenced files `avro-schema.sql`, `hot-cold-schema.sql`, and `../workflow/schema.sql` are no longer maintained in this repository layout.
- Use `docs/sql/d1/schema.sql` as the source of truth for D1 schema bootstrap commands.

## Battle Index Note

The main Battle Index database (`dev_kc_battle_index`) schema bootstrap is executed from `docs/sql/d1/schema.sql` by FUSOU-WORKFLOW scripts.
