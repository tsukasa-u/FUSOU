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
- See: `FUSOU-PROXY/proxy-https/README.md` for feature flags

### Data Flow

1. Proxy captures requests to `w*.kancolle-server.com`
2. Passes to `kc_api` parser via IPC (Tauri)
3. Parser emits structured data to desktop app
4. Optional: Upload snapshots to Supabase/R2 via `FUSOU-WEB` APIs
5. Asset sync service: Mirrors to R2 + D1 index

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

## References

- Supabase auth: `fusou-auth/src/manager.rs`
- Proxy internals: `FUSOU-PROXY/proxy-https/README.md`
- Data parsing: `kc_api/crates/kc-api-parser/`
- Web API patterns: `FUSOU-WEB/src/pages/api/`
