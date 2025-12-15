# FUSOU Project AI Coding Instructions

## Project Overview

FUSOU is a monorepo for a KanColle proxy toolkit. It combines Rust backend services (proxy, auth, API) with TypeScript frontend applications (Tauri desktop app, Astro web portal) and a shared UI library.

## Key Architecture

### Core Components

- **FUSOU-APP**: Tauri desktop app with SolidJS frontend and Rust backend
- **FUSOU-PROXY**: HTTP/HTTPS intercepting proxy (Rust)
  - `proxy-https`: Main proxy with optional gRPC transport
  - `proxy-http`: HTTP proxy wrapper
- **FUSOU-WEB**: Astro-based web portal (TypeScript)
- **kc_api**: Rust workspace for KanColle game API parsing
- **shared-ui**: Lit web components library
- **Supporting crates**: `fusou-auth` (Supabase auth), `fusou-upload`, `configs`

### External HTTPS Connections

| Service              | Purpose                    | Location                                                                | Notes                                                                  |
| -------------------- | -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Supabase**         | Authentication & data APIs | `fusou-auth/src/manager.rs`, `FUSOU-APP/src-tauri/src/auth/supabase.rs` | Token refresh at `/auth/v1/token`, Bearer auth, manual 401 retry logic |
| **Cloudflare R2**    | Asset storage (FUSOU-WEB)  | `FUSOU-WEB/src/pages/api/admin/sync-r2-to-d1.ts`                        | Bound via environment; for asset sync operations                       |
| **Cloudflare D1**    | Database (FUSOU-WEB)       | `FUSOU-WEB/src/pages/api/admin/sync-r2-to-d1.ts`                        | Bound via environment; indexes asset metadata                          |
| **KC Period API**    | Game period data           | `FUSOU-APP/src-tauri/src/auth/supabase.rs`                              | Configured endpoint; fetches period tag for sync                       |
| **DMM Game URL**     | KanColle game entry        | `FUSOU-APP/src-tauri/src/window/external.rs`                            | `http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/`         |
| **KanColle Servers** | Game API targets           | Proxy PAC files                                                         | Multiple `w*.kancolle-server.com` hosts                                |

## Critical Patterns

### Authentication Flow

- `fusou-auth` crate provides `AuthManager<S>` with token refresh
- Refresh token stored in `FileStorage`; auto-refresh on 401 with one retry
- All Supabase requests use Bearer token via `request_with_refresh()`
- See: `fusou-auth/src/manager.rs:request_with_refresh()` for template

### Proxy Architecture

- **In-process**: Default tokio::mpsc channel for `BidirectionalChannel<StatusInfo>`
- **gRPC**: Optional `--features grpc` enables `tonic` transport (protobufs, separate processes)
- PAC (Proxy Auto Config) files intercept KanColle traffic to local proxy
- HTTPS proxy uses self-signed CA; regenerated on each run
- **Asset sync**: Background worker uploads non-API resources to R2
  - Phase 1: Independent tokio::spawn task (non-blocking initialization)
  - Phase 2: Bounded mpsc::channel(100) with backpressure (try_send, drops on full)
  - Phase 3: Async I/O (tokio::fs) for all file operations
  - Prevents WebView hang when HTTPS proxy enabled
  - See: `FUSOU-PROXY/proxy-https/src/asset_sync.rs` for implementation
- See: `FUSOU-PROXY/proxy-https/README.md` for feature flags

### Data Flow

1. Proxy captures requests to `w*.kancolle-server.com`
2. Passes to `kc_api` parser via IPC (Tauri)
3. Parser emits structured data to desktop app
4. Optional: Upload snapshots to Supabase/R2 via `FUSOU-WEB` APIs
5. Asset sync service: Mirrors to R2 + D1 index

### Storage Providers Architecture

FUSOU-APP supports three storage backends for KanColle game data:

| Provider | Data Format | Conversion | Integration | Purpose |
|----------|------------|------------|-------------|---------|
| **LocalFileSystemProvider** | Avro (.avro) | None | Client-side periodic (tokio_cron) | Local backup with file merging |
| **CloudTableStorageProvider** (Google Drive) | Avro (.avro) | None | Client-side periodic (tokio_cron) | Cloud backup with individual files |
| **R2StorageProvider** | Parquet (.bin) | Client-side (BatchUploadBuilder) | Server-side (Cloudflare Workers) | Shared database with batch upload |

#### Key Implementation Details

- **Storage trait**: `StorageProvider` in `src-tauri/src/storage/service.rs`
  - Methods: `write_get_data_table()`, `write_port_table()`, `integrate_port_table()`
  - Each provider implements for master data (get_data) and transaction data (port)

- **Avro → Parquet conversion**: 
  - **R2 ONLY** using `kc_api::database::batch_upload::BatchUploadBuilder`
  - Location: `kc_api/crates/kc-api-database/src/batch_upload.rs`
  - Underlying converter: `AvroToParquetConverter` in `avro_to_parquet.rs`
  - Process: Converts multiple Avro tables → Parquet → concatenates into single binary
  - Executed via `tokio::task::spawn_blocking` (CPU-intensive)
  - Generates metadata JSON with table offsets for later extraction

- **Type conversion in Avro → Parquet**:
  - Critical: Schema types must match data types exactly
  - `create_record_batch()` implements type-aware array builders:
    * `Boolean` → `BooleanBuilder`
    * `Int32` → `Int32Builder` (also accepts `Value::Long` with cast)
    * `Int64` → `Int64Builder` (also accepts `Value::Int` with cast)
    * `Float32` → `Float32Builder`
    * `Float64` → `Float64Builder`
    * `Utf8` → `StringBuilder` (handles String, Uuid, and debug formatting)
    * `Binary` → `BinaryBuilder`
    * `Timestamp` → `TimestampMillisecondBuilder`
  - Previous bug: All fields converted to `StringBuilder` regardless of schema → "expected Int32 but found Utf8" errors
  - **Fixed**: `build_column_for_field()` matches Arrow schema types with proper builders
  - Fallback: Unsupported types default to `Utf8` with warning log

- **Error handling in conversion**:
  - Empty Avro data → `ValidationError`
  - Schema mismatch → `SchemaError`
  - Type conversion failure → `ParquetError` with detailed message
  - All errors include context (table name, byte position, field index)

- **Avro file integration**:
  - **Local & Google Drive** periodically merge multiple `.avro` files
  - Scheduled via `tokio_cron_scheduler` (see `src-tauri/src/scheduler/integrate_file.rs`)
  - Cron schedule: `configs.database.google_drive.get_schedule_cron()` (default: hourly)
  - Uses `integrate_by_table_name()` from `storage/common/integration.rs`
  - Batch size: `page_size` config (default: 100 files per integration)

- **Google Drive CloudStorageProvider trait**:
  - Methods: `upload_file()`, `download_file()`, `list_files()`, `list_folders()`, `delete_file()`, `create_folder()`
  - `list_files()`: Returns only files (excludes folders via `mimeType!='application/vnd.google-apps.folder'`)
  - `list_folders()`: Returns only subdirectories (filters `mimeType='application/vnd.google-apps.folder'`)
  - Authentication: Refresh token stored via `set_refresh_token()`, auto-initialized at startup

- **File organization**:
  ```
  period_data/
    {period_tag}/
      master/               # get_data tables (master data)
        {table_name}.avro   # Local/Google Drive: individual files
      transaction/          # port tables (battle data)
        {maparea}-{mapinfo}/
          {table_name}/
            {timestamp}.avro
  ```

- **R2 upload format**:
  - Tag: `{period_tag}-port-{maparea_id}-{mapinfo_no}`
  - Content: Concatenated Parquet binary with metadata
  - Server integration: FUSOU-WEB `_scheduled.ts` processes uploads

- **Provider initialization**:
  - Triggered in `StorageService::resolve()` based on config flags:
    - `allow_data_to_cloud`: Google Drive
    - `allow_data_to_local`: Local filesystem
    - `allow_data_to_shared_cloud`: R2
  - Dependencies: `PendingStore`, `UploadRetryService` for upload retry logic

- **Critical**: Never use `BatchUploadBuilder` for Google Drive or Local FS - they require raw Avro files for integration

See: `FUSOU-APP/src-tauri/src/storage/` for all provider implementations

### Frontend Patterns

- **FUSOU-APP**: SolidJS with Tauri for desktop. Storybook for components.
- **FUSOU-WEB**: Astro for static portal + dynamic API routes
- **shared-ui**: Lit web components exported as package (built via rollup)
- Environment: dotenvx for secrets management (`.env`, `.env.keys`)

## Build & Development Commands

### Workspace

```bash
pnpm install              # Install all dependencies
pnpm build               # Build all packages
pnpm dev                 # Dev mode (varies per package)
```

### FUSOU-APP (Tauri + SolidJS)

```bash
cd packages/FUSOU-APP
pnpm dev                 # Vite dev server + Tauri window
pnpm tauri build         # Build native app (requires `dotenvx`)
pnpm clippy              # Rust linting
pnpm rustfmt:fix         # Format Rust
pnpm lint:fix            # ESLint + Prettier
pnpm storybook           # Component showcase
```

### FUSOU-PROXY (Rust monorepo)

```bash
cd packages/FUSOU-PROXY/proxy-https
cargo build              # Standard build
cargo run --features grpc --bin channel_service  # gRPC channel server
cargo check -p proxy-https --features grpc       # Validate gRPC feature
RUST_LOG=info cargo run  # Enable tracing
```

### FUSOU-WEB (Astro)

```bash
cd packages/FUSOU-WEB
pnpm dev                 # Dev server at localhost:4321
pnpm build               # Static build (with astro check)
# Requires: dotenvx, SUPABASE_URL, admin API credentials
```

### kc_api (Rust data parsing)

```bash
cd packages/kc_api
cargo build
cargo test               # Run integration tests
# Bindings auto-generated: TypeScript in `bindings/`
```

## Configuration & Secrets

- **Build-time**: Environment variables embedded via `option_env!()` in Rust
- **Runtime**: `configs` crate reads `configs.toml` (user directory)
- **Web**: `.env` files + Cloudflare environment bindings (R2, D1)
- **Tool**: `dotenvx` for encrypted `.env.keys` management

## Common Development Patterns

### Storage Provider Implementation Checklist

When modifying storage providers, **always verify**:

1. **Before deletion**: 
   - Search for similar implementations across all providers (Local, Google Drive, R2)
   - Check if functionality exists elsewhere via `grep_search` or `semantic_search`
   - Verify usage with `list_code_usages` for the symbol being removed

2. **Data format correctness**:
   - Local FS: Avro only, no conversion
   - Google Drive: Avro only, no conversion
   - R2: **Must convert Avro → Parquet** using `BatchUploadBuilder`

3. **Integration requirements**:
   - Local FS: Implements `integrate_port_table()` with file merging
   - Google Drive: Implements `integrate_port_table()` with cloud file merging
   - R2: No-op `integrate_port_table()` (server-side processing)

4. **Logging standards**:
   - Prefix logs with provider name: `"Google Drive: ..."`, `"R2: ..."`, `"Local FS: ..."`
   - Use `tracing::info!` for major operations (start, success)
   - Use `tracing::debug!` for detailed steps (file collection, individual uploads)
   - Use `tracing::warn!` for skipped/empty data
   - Use `tracing::error!` for failures with full context

### Adding External HTTPS Call

1. Use `reqwest::Client` with rustls-tls (preferred for security)
2. Implement automatic token refresh (see `AuthManager::request_with_refresh`)
3. Log failures with `tracing::warn!` and error type
4. Avoid embedding secrets; use environment variables

### Modifying Proxy Behavior

- PAC files control routing (`proxy_local.pac`, `proxy_auto.pac`)
- Edit target hosts in PAC; replace `[REPLACE HOST]` comments
- Proxy handler in `proxy_server_https.rs` processes requests
- Asset sync uploads via `asset_sync.rs`

### Cross-Package Communication

- **Tauri IPC**: Desktop app ↔ Rust backend (strongly typed)
- **HTTP APIs**: FUSOU-WEB endpoints (Astro API routes)
- **gRPC**: Optional microservice transport (enable with `--features grpc`)

## Testing Strategy

- **Tauri app**: Use Vitest + Storybook (web components)
- **Proxy**: Manual via PAC + local server
- **APIs**: Cloudflare Workers simulation; check Supabase credentials
- **Rust**: Standard `cargo test`; integration tests in kc_api
- **Build Check**: Always run `cargo check` after Rust code changes to verify compilation (required in `FUSOU-APP/src-tauri`)

## Known Issues & Constraints

- Self-signed proxy certificates regenerated on startup (not persisted)
- Supabase refresh tokens expire; handled via 401 retry
- gRPC feature requires protobuf recompilation (`build.rs`)
- Admin API endpoints require secret bearer token (rate-limited)
- **Google Drive credentials**: Must be provided at build time via `option_env!("GOOGLE_CLIENT_ID")` and `option_env!("GOOGLE_CLIENT_SECRET")` - no runtime fallback
- **Asset sync backpressure**: Queue capacity 100; exceeding drops assets (logs warning, prevents blocking)
- **PROCESSED_KEYS growth**: `DashSet` in asset_sync accumulates keys without periodic cleanup (clears only on period tag change)

## Recent Changes (r2_parquet branch)

### Storage Provider Refactoring
- **Google Drive**: Removed incorrect Parquet conversion, now uploads raw Avro files
- **R2**: Added `BatchUploadBuilder` for proper Avro → Parquet conversion with `spawn_blocking`
- **Integration**: Implemented `integrate_port_table()` for Google Drive (previously no-op)
- **Logging**: Enhanced all providers with detailed operation logs (provider-prefixed), aligned Google Drive logs with Local FS format

### Avro → Parquet Type Conversion Fix
- **Problem**: `create_record_batch()` converted all fields to `StringBuilder` → type mismatch errors
  - Log example: `"column types must match schema types, expected Int32 but found Utf8 at column index 0"`
  - Occurred when: R2 uploads attempted, Google Drive uploads (before Avro-only fix)
- **Solution**: Implemented type-aware `build_column_for_field()` with proper builders per Arrow schema type
  - Int32 fields → `Int32Builder`, Int64 → `Int64Builder`, etc.
  - Handles type coercion (e.g., `Value::Long` → `i32` cast for Int32 fields)
  - UUID types → String conversion with `.to_string()`
  - Unsupported types → fallback to `Utf8` with warning
- **Impact**: R2 Parquet uploads now succeed with correct schema preservation

### Asset Sync Optimization
- Phase 1-3 optimizations to prevent WebView hang
- Bounded queue with backpressure handling
- All file I/O converted to async (tokio::fs)

### Authentication
- Google Drive authentication strictly compile-time (option_env! only)
- Enhanced logging for provider initialization and token fetching

## References

- Supabase auth: `fusou-auth/src/manager.rs`
- Proxy internals: `FUSOU-PROXY/proxy-https/README.md`
- Data parsing: `kc_api/crates/kc-api-parser/`
- Web API patterns: `FUSOU-WEB/src/pages/api/`
