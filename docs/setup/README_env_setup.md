# Env setup and testing for snapshot API

This document explains how to configure Cloudflare Pages/Workers and Supabase environment variables and how to test the `POST /api/fleet/snapshot` endpoint.

## Required environment variables

- `ASSET_PAYLOAD_BUCKET` (Cloudflare R2 binding name) — set as a Pages/Workers binding.
- `SUPABASE_URL` — your Supabase project URL (e.g. `https://xyz.supabase.co`).
- `SUPABASE_SERVICE_KEY` — service_role key from Supabase (keep secret; only use from server/worker).

## Setting variables in Cloudflare Pages (via dashboard)

1. Open your Cloudflare Pages project.
2. Go to `Settings` → `Environment variables`.
3. Add the variables above for the `Production` (and `Preview` if you want) environment.

Alternatively using `wrangler` for Workers (example):

```bash
# Login wrangler first:
wrangler login
# Put secret (example for service key)
wrangler secret put SUPABASE_SERVICE_KEY
```

R2 binding: in Pages/Workers, configure an R2 bucket binding named `ASSET_PAYLOAD_BUCKET` (or change the name to match the code).

## Testing locally / deploying

1. Deploy your Pages site so the API is reachable, or use `wrangler dev` for Workers.
2. Use the test script `docs/scripts/test_snapshot.sh` to POST a sample payload.

Example:

```bash
export SITE_URL="https://your-site.pages.dev"
export AUTH_TOKEN="<service-or-test-jwt>"
export OWNER_ID="<uuid>"
export TAG="test"
./docs/scripts/test_snapshot.sh
```

If the request succeeds you should see a JSON response with `ok: true` and the `r2_key` of the stored object.

## Applying the Supabase schema

If you have `psql` and your Supabase DB URL, you can apply the SQL in `docs/sql/supabase_fleets_schema.sql`:

```bash
export SUPABASE_DB_URL="postgres://..."
./docs/scripts/apply_supabase_schema.sh
```

Or use Supabase CLI if you prefer.

## Security notes

- Never expose `SUPABASE_SERVICE_KEY` to client-side code. Only store it in worker/server env. Use Supabase RLS policies and JWT validation.
- For public previews, consider using different keys or restricting service_key usage.

## Next steps after testing

- Implement `GET /s/:token` Worker to resolve `share_token` and serve the payload with proper `ETag` and `Cache-Control`.
- Harden the snapshot endpoint with JWT verification and rate limits.
