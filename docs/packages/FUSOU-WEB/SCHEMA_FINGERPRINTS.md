# Schema Fingerprints Management

This app validates Avro slices against a table/version allowlist.

## Default: Bundled JSON
- Source: `src/server/config/fingerprints.json`
- Managed in the repo, kept in sync with `packages/FUSOU-WORKFLOW/schemas/fingerprints.json`.
- Changes require a WEB rebuild/deploy.

## Override per environment
- Set `SCHEMA_FINGERPRINTS_JSON` as an environment variable to override bundled JSON.
- Development: put the JSON into `.env` loaded by dotenvx.
- Production (Cloudflare Pages): configure in the Pages Dashboard → Settings → Environment Variables.

## Notes
- If both are present, environment variable wins.
- Keep `table_version` aligned with the KC API database `DATABASE_TABLE_VERSION`.
- Fingerprints are SHA-256 over canonical Avro schema JSON with `namespace = "fusou.v1"`.
