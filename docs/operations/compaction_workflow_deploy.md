<!-- markdownlint-disable MD032 MD040 MD025 MD022 MD007 MD010 -->
# Compaction Workflow Deploy & Ops Guide

This note summarizes how to deploy the compaction workflow to Cloudflare, create the Supabase tables, build Cloudflare Pages without WASM, and how dotenvx is used in this repo.

## 1. Cloudflare Workflows (compaction-workflow)

Prerequisites: Node 18+, Wrangler, Cloudflare account with Workflows enabled.

Suggested `wrangler.toml` (place under `packages/FUSOU-WORKFLOW/`):

```toml
name = "fusou-workflow"
main = "src/index.ts"
compatibility_date = "2024-12-16"
compatibility_flags = ["workflows"]
type = "service"

[[r2_buckets]]
binding = "BATTLE_DATA_BUCKET"
bucket_name = "<r2-bucket-name>"

[vars]
PUBLIC_SUPABASE_URL = "https://xxxxx.supabase.co"

[observability]
enabled = true
```

Deploy steps:

```bash
cd packages/FUSOU-WORKFLOW
npm install        # or pnpm install
npx wrangler workflows deploy --name fusou-workflow
npx wrangler secret put SUPABASE_SECRET_KEY
```

Bindings from other workers:
- Consumer uses `[[services]] binding = "COMPACTION_WORKFLOW" service = "fusou-workflow"` (already set in its wrangler.toml).
- R2 bucket binding name must match `BATTLE_DATA_BUCKET` in the workflow code.

## 2. Supabase tables (datasets, processing_metrics)

Apply the provided migration `supabase/migrations/20251216_add_compaction_tables.sql`:

```bash
# Using Supabase CLI
dcd /home/ogu-h/Documents/GitHub/FUSOU
supabase db push --file supabase/migrations/20251216_add_compaction_tables.sql

# Or via psql
psql "<connection-string>" -f supabase/migrations/20251216_add_compaction_tables.sql
```

This adds compression_ratio, row_count columns and extends status enums with `dlq` and `timeout`.

## 3. Cloudflare Pages build

WASM の依存は削除されており、Astro のみでビルドします：

```bash
cd packages/FUSOU-WEB
npm install    # or pnpm install
npm run build  # または直接: dotenvx run -fk ../.env.keys -f .env --verbose --overload -- astro build
```

`package.json` の scripts に実装済み：
- `dev`: `dotenvx run ... astro dev`
- `build`: `astro check && dotenvx run ... astro build`
- `build.no.keys`: `astro check && dotenvx run ... astro build` (keys 不要版)

## 4. dotenvx usage policy (Workers 対応済み)

- In-repo: `.env` files are encrypted with dotenvx (`.env.keys` present). Local dev / Pages builds already run via `dotenvx run ...`.
- Cloudflare Workers/Workflows: **Cloudflare Secretsを必須** としつつ、ローカル開発・手元検証向けに dotenvx を Worker 本体へ組み込み済み。
	- 実装: Worker エントリで `import '@dotenvx/dotenvx/config'` を読み込み、`env.FOO || process.env.FOO` のフォールバックで解決。
	- 利用手順 (Worker 内で dotenvx を使う場合):
		1. Worker ディレクトリに `.env` を置き、`bunx dotenvx encrypt` 等で `.env.keys` を生成。
		2. Cloudflare に `DOTENV_PRIVATE_KEY` を secret 登録: `wrangler secret put DOTENV_PRIVATE_KEY`。
		3. 必要ならローカルで `dotenvx run -- wrangler dev` を実行（process.env に復号された値が入る）。
		4. 本番では Cloudflare 側の環境変数/Secrets が優先され、dotenvx はフォールバックとしてのみ動作。
- Secrets例: `SUPABASE_SECRET_KEY` は必ず Cloudflare Secret にも設定してください（dotenvx はローカル補助）。

## Quick deployment checklist
- [ ] Deploy fusou-workflow via `wrangler workflows deploy`
- [ ] Set `SUPABASE_SECRET_KEY` secret on the workflow
- [ ] Ensure R2 binding name matches `BATTLE_DATA_BUCKET`
- [ ] Apply Supabase migration `20251216_add_compaction_tables.sql`
- [ ] Build Pages with `dotenvx run ... astro build` (no WASM path)
