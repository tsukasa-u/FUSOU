# Supabase Integration: User ↔ Member ID Mapping

## Goal
- Bind Supabase `auth.users.id` (application user) to the game `member_id_hash` (salted SHA-256 of `member_id`), enabling cross-device data consolidation and secure per-user access control.

## Schema (SQL Migrations)

Migration file: [docs/sql/001_user_member_map.sql](./sql/001_user_member_map.sql)

### Applying the Migration

1. **Via Supabase Dashboard**:
   - Navigate to SQL Editor in Supabase dashboard
   - Copy and execute the migration SQL file

2. **Via Supabase CLI**:
   ```bash
   supabase migration new user_member_map
   # Copy the SQL into the generated migration file
   supabase db push
   ```

### Table Schema

```sql
create table if not exists public.user_member_map (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_member_map_member_id_hash
  on public.user_member_map (member_id_hash);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_user_member_map_updated_at on public.user_member_map;
create trigger trg_user_member_map_updated_at
  before update on public.user_member_map
  for each row execute function public.set_updated_at();
```

### Row Level Security (RLS)

```sql
alter table public.user_member_map enable row level security;

drop policy if exists user_member_map_select on public.user_member_map;
create policy user_member_map_select on public.user_member_map
  for select using (auth.uid() = user_id);

drop policy if exists user_member_map_insert on public.user_member_map;
create policy user_member_map_insert on public.user_member_map
  for insert with check (auth.uid() = user_id);

drop policy if exists user_member_map_update on public.user_member_map;
create policy user_member_map_update on public.user_member_map
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_member_map_delete on public.user_member_map;
create policy user_member_map_delete on public.user_member_map
  for delete using (auth.uid() = user_id);
```

### RPC Functions

> See the full SQL including metadata columns and RPCs (with `client_version`) in [docs/sql/001_user_member_map.sql](./sql/001_user_member_map.sql).

## Backend (Workers) Hook
- Endpoint: `POST /user/member-map/upsert`
- Authentication: Requires valid JWT in Authorization header
- Request body: `{ "member_id_hash": "<salted-sha256-hash>" }`
- Implementation: [FUSOU-WEB/src/server/routes/user.ts](../packages/FUSOU-WEB/src/server/routes/user.ts)
- Flow:
  1. Extract and validate JWT from Authorization header
  2. Parse request body and validate `member_id_hash`
  3. Create Supabase service role client (safe server-side only)
  4. Call `rpc_upsert_user_member_map` RPC with authenticated user's JWT
  5. RPC uses `auth.uid()` to bind user_id automatically
  6. Return success or error response
- Error handling:
  - 400: Missing or invalid `member_id_hash`
  - 401: Authentication failed (missing/invalid JWT)
  - 409: Conflict (member_id already mapped to another user)
  - 500: Server or database error
- Additional endpoint: `GET /user/member-map` (retrieves current user's mapping)

## Client Flow (Tauri App)
- Timing: `Set::Basic` が更新されたとき（ゲーム起動後、`get_data` または `require_info` API の後）に自動トリガー
- Implementation: `json_parser.rs` で `Set::Basic(data)` が `restore()` された直後に `try_upsert_member_id()` を呼び出す
- One-shot guarantee: `AtomicBool` フラグでセッション内一度きりを保証（失敗時は次回リトライ可能にフラグをリセット）
- Compute: `member_id_hash` は既存の `get_user_member_id()` でソルト付きSHA-256を取得
- Client version: `CARGO_PKG_VERSION` をコンパイル時に埋め込み、リクエストに含める
- Endpoint: `app.auth.member_map_endpoint` を使用（未設定・空の場合は`configs.toml`のデフォルトへ自動フォールバック）。オリジン推定は行いません。
- Error handling:
  - `member_id` が空の場合: スキップしてフラグをリセット（次回リトライ）
  - 認証トークン取得失敗: ログ出力してフラグをリセット
  - ネットワークエラー: ログ出力してフラグをリセット
  - 成功時: ログ出力してフラグ保持（以降スキップ）

## Notes
- Snapshots currently store under `fleets/{dataset_id}/{tag}/...` after API update (see server route changes). Previously it used `auth.users.id`.
- Battle data uploads already require `dataset_id` and are aligned with this mapping.
