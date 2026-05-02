# FUSOU Package Architecture Findings
**Generated:** 2026-04-06  
**Scope:** kc_api, fusou-upload, FUSOU-APP, fusou-auth

---

## Executive Summary

The FUSOU system is a **game data collection & analysis platform** structured around four main packages:

| Package | Role | Language | Key Responsibility |
|---------|------|----------|-------------------|
| **kc_api** | Foundation | Rust | Game API parsing + TypeScript binding generation |
| **fusou-auth** | Security | Rust | Supabase integration + token lifecycle |
| **fusou-upload** | Pipeline | Rust | Batch upload + R2 storage + retry logic |
| **FUSOU-APP** | Presentation | TypeScript/Rust | Desktop GUI + data collection trigger |

---

## 1. Package Responsibilities & Scope

### 1.1 kc_api — Game Data Structure & Parsing  

**What it does:**
- **Master data definitions** for Kancolle game entities (ships, equipment, maps, etc.)
- **API response/request parsing** into strongly-typed structs
- **TypeScript binding generation** for FUSOU-APP consumption

**Internal Workspace Structure:**
```
crates/
├── kc-api                      [Façade - re-exports everything]
├── kc-api-interface            [EmitData enum for typed events]
├── kc-api-parser               [Macro-driven endpoint routing]
├── kc-api-dto                  [DTO definitions from endpoints]
├── kc-api-interface-adapter    [DTO → EmitData conversion]
├── kc-api-database             [DB schema for master data]
└── kc-fleet-snapshot           [Fleet state snapshots]
```

**Entry Points:**
```rust
// Response parsing: Game API response → vec of typed events
response_parser(name: String, data: String) -> Result<Vec<EmitData>>

// Request parsing: Query string parameters → vec of typed events  
request_parser(name: String, data: String) -> Result<Vec<EmitData>>
```

**Supported EmitData Types:**
- Add: Materials, Ships, Battle, Cell
- Set: Materials, UseItems, DeckPorts, Basic, NDocks, Ships, SlotItems, Logs, AirBases, Cells, MstShips, MstSlotItems, etc.
- Identifier: Port, GetData, RequireInfo, MapStart

**Bindings Output:**
- TypeScript types auto-generated to `/bindings/` (battle.ts, cells.ts, port.ts, etc.)
- Aliased in FUSOU-APP vite.config.ts as `@ipc-bindings`
- Consumed by UI for type-safe data access

**Design Philosophy:**  
Built with macro-driven `expand_struct_selector` to automatically route endpoints to parser functions without manual mapping—reduces boilerplate for game API changes.

---

### 1.2 fusou-auth — Authentication & Session Management

**What it does:**
- **Supabase integration** for user identity management
- **Token lifecycle management** (proactive refresh 30s before expiry)
- **Session persistence** (file-based for Tauri, in-memory for testing)
- **Multi-session support** trait (for future multi-user scenarios)

**Public API:**
```rust
pub struct AuthManager<S: Storage> {
    get_access_token()        // Returns valid token, refreshes if needed
    force_refresh()           // Explicit refresh
    is_authenticated()        // Check session validity
    save_session()            // Persist session
    peek_session()            // Non-mutating read
}

// Implementations: InMemoryStorage, FileStorage
```

**Configuration:**
- Reads `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Compile-time optional embedding via `option_env!`
- Falls back to runtime env vars if not embedded

**Session Structure:**
```rust
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: Option<DateTime<Utc>>,
    // ... other fields
}
```

**Refresh Logic:**
- Proactively refreshes when within `refresh_margin_secs` of expiry (default: 30s)
- Single-flight refresh using mutex to prevent duplicate requests
- Embedded into any HTTP call before sending

**Integration Points:**
- Used by `fusou-upload` for authenticated API calls
- External: Supabase handles token generation and validation

---

### 1.3 fusou-upload — Data Upload & Retry Service

**What it does:**
- **Batch data upload** to R2 (Cloudflare) storage
- **Data transformation** (Avro → Parquet pipeline)
- **Retry management** with exponential backoff
- **Handshake protocol** for temporary upload URL acquisition
- **Pending store** for failed upload recovery

**Public API:**
```rust
pub async fn process_and_upload_batch(
    tables: HashMap<String, Vec<u8>>,     // Table name → binary data
    upload_url: &str,                      // Pre-signed R2 URL
    uploader_id: Uuid,
    is_public: bool,
    dataset_id: Uuid,
) -> Result<Vec<DatasetFileMetadata>>

pub struct UploadRetryService {
    trigger_retry()            // Manually trigger retry of failed uploads
}

pub struct UploadError {
    AuthenticationError { status_code, message },
    ClientError { status_code, message },
    ServerError { status_code, message },
    Conflict,                  // 409 resource already exists
}
```

**Data Pipeline:**
```
Binary Avro/Parquet Data
    ↓ [DatasetProcessor]
Convert to optimized Parquet format
    ↓
Concatenate all table files into single binary
    ↓ [Uploader]
Handshake with Supabase → acquire R2 upload URL + token
    ↓
Upload to R2 with multipart/form-data
    ↓ (on failure)
Store in [PendingStore] for retry
    ↓
[UploadRetryService] periodically retries failed uploads
```

**DatasetFileMetadata Returned:**
```rust
pub struct DatasetFileMetadata {
    pub id: Uuid,
    pub dataset_id: Uuid,
    pub table_name: String,
    pub file_path: String,        // R2 path
    pub start_byte: i64,          // For range queries
    pub byte_length: i64,
    pub is_public: bool,
    pub created_at: DateTime<Utc>,
}
```

**Retry Strategy:**
- Configurable max attempts (default: 5)
- Exponential backoff between retries
- Content-hash based dedup (skip if same content already pending)
- TTL for pending entries (cleanup on expiry)

**Dependencies:**
- `fusou-auth` for token acquisition
- `configs` for R2 settings and retry strategy
- `object_store`, `aws-sdk-s3` for R2 API

**Design Note:**  
Avro conversion is currently a stub (returns data as-is); full Avro support planned for MVP phase.

---

### 1.4 FUSOU-APP — Desktop GUI & Data Collection

**What it does:**
- **Desktop UI** for fleet management & battle analysis (Solid.js, SPA)
- **Real-time game data display** (Materials, Ships, Decks, Battles, AirBases)
- **Settings & theme management**
- **Logging interface** for diagnostics
- **Data collection trigger** (signals upload service)

**Entry Point:**
```typescript
// src/main.tsx
render(
  () => <Router>
    <Route path="/app" component={App} />
    <Route path="/" component={Start} />
    <Route path="/settings" component={SettingsComponent} />
    <Route path="/logs" component={LogViewerComponent} />
  </Router>,
  document.getElementById("root")
);
```

**Main Tabs (src/pages/app.tsx):**
1. **Fleet Info** - Materials, Decks, AirBases, Battles (real-time via providers)
2. **Ship Info** - Specification table with master data
3. **Settings** - User preferences, theme, font
4. **Logs** - Diagnostics output

**Data Distribution Architecture:**
- Uses Solid.js context providers for shared state
- Providers wrap data sources (kc_api bindings via @ipc-bindings)
- Components subscribe to providers and re-render on updates

**Key Providers:**
```typescript
// Real-time game data streams from proxy
<MaterialsProvider>
  <MstShipsProvider>
    <ShipsProvider>
      <SlotItemsProvider>
        <DeckPortsProvider>
          <AirBasesPortsProvider>
            <MstSlotItemEquipTypesProvider>
              <MstStypesProvider>
                <DeckBattlesProvider>
                  <AirBasesBattlesProvider>
                    <CellsContextProvider>
                      {/* Components consume */}
                    </CellsContextProvider>
                  </AirBasesBattlesProvider>
                </DeckBattlesProvider>
              </MstStypesProvider>
            </MstSlotItemEquipTypesProvider>
          </AirBasesPortsProvider>
        </DeckPortsProvider>
      </SlotItemsProvider>
    </ShipsProvider>
  </MstShipsProvider>
</MaterialsProvider>
```

**Type Safety:**
- Uses `@ipc-bindings` (kc_api generated TypeScript types)
- Compile-time checking of game data schemas
- No manual type definitions needed

**Integration Points:**
- **FUSOU-PROXY** - Receives game data stream (HTTP/2)
- **fusou-auth** - Session management (Tauri bridge)
- **fusou-upload** - Triggers batch uploads
- **configs** - Reads settings

**📌 Critical Missing:** 
- ❌ No quest-tree ingestion sender
- App does NOT intercept and send `questlist`, `start`, `stop`, `clearitemget` responses to WEB ingest endpoint
- Required for quest-tree feature to work end-to-end

---

## 2. Data Ingestion & Collection Patterns

### 2.1 Pattern: Hot Data Flow (Game → FUSOU-APP Real-time)

**Trigger:** Game client makes API call  
**Data Path:**
```
Game Server
    ↓
FUSOU-PROXY (intercepts HTTPS)
    ├─ Extracts response body
    ├─ Identifies endpoint name (e.g., api_get_member/port)
    └─ Sends stream to FUSOU-APP
    ↓
FUSOU-APP receives stream
    ├─ Deserializes using kc_api_parser
    ├─ Converts to EmitData enum via kc_api_interface_adapter
    └─ Routes to appropriate provider
    ↓
Provider (MaterialsProvider, ShipsProvider, etc.)
    ├─ Updates Solid.js context state
    └─ Triggers subscriber re-renders
    ↓
UI Components
    └─ Display live fleet state, battles, etc.
```

**Polling Frequency:** Event-driven (responsive to user actions)  
**Persistence:** None (transient display)  
**Latency:** <100ms (same-network)

---

### 2.2 Pattern: Batch Upload (Game State → R2 Archive)

**Frequency:** Periodic batching (configurable)  
**Data Path:**
```
FUSOU-APP accumulates game session data
    ↓
Triggers upload via fusou-upload service
    ├─ Creates HashMap<table_name, binary_data>
    └─ Adds metadata (dataset_id, uploader_id)
    ↓
fusou-upload::DatasetProcessor
    ├─ Validates input
    ├─ Converts Avro → Parquet (planning phase)
    └─ Concatenates all tables into single binary
    ↓
fusou-upload::Uploader
    ├─ Authenticates via fusou-auth (Supabase token)
    ├─ Handshake with Supabase → R2 upload URL + temp token
    └─ HTTP PUT/POST to R2 with binary
    ↓ (on success)
R2 Cloudflare Storage (cold)
    ↓ (on failure)
Local PendingStore (retry queue)
    ↓ (background)
UploadRetryService periodically retries
```

**Batch Strategy:** User-triggered or cron (configurable)  
**Persistence:** R2 Cloudflare (indefinite, queryable via range requests)  
**Retry:** Up to 5 attempts, exponential backoff

---

### 2.3 Pattern: Quest Tree Collection (Specialized Telemetry)

**Scope:** Dedicated collection for quest prerequisite inference  
**Trigger Endpoints:**
- `api_get_member/questlist` (list of available quests)
- `api_req_quest/start` (start quest)
- `api_req_quest/stop` (stop quest)
- `api_req_quest/clearitemget` (complete quest)

**Current Collection Location:** FUSOU-PROXY::QuestTreeSender  
**Flow:**
```
Game Response (quest endpoint)
    ↓ [QuestTreeSender]
Detect endpoint type
    ├─ Extract quest_id, page_no, timestamp
    └─ Calculate payload_hash (SHA256)
    ↓
Check dedup cache
    ├─ Key: {dataset_id}:{endpoint}:{logical_id}:{payload_hash}
    └─ TTL: 10 minutes
    ↓ (if new)
POST to WEB /quest-tree/ingest with JSON payload
    ↓ (if duplicate)
Skip and update cache timestamp
```

**Payload Schema (to WEB):**
```json
{
  "dataset_id": "uuid",
  "request_id": "uuid",
  "endpoint": "api_get_member/questlist",
  "quest_id": 123,
  "page_no": 1,
  "timestamp_ms": 1234567890,
  "period_tag": "2026-04",        // REQUIRED (user versioning)
  "table_version": "0.5",          // REQUIRED (schema versioning)
  "payload_hash": "sha256:..."     // For dedup
}
```

**WEB Processing (Ingest):**
```
Validate period_tag ≠ empty (now required, no fallback)
Validate table_version ≠ empty (now required, no fallback)
    ↓
Check if payload_hash already processed (idempotency)
    ↓ (if new)
Extract & normalize fields into D1 tables:
    ├─ ingest_events (raw collection log)
    ├─ questlist_snapshots (full quest state)
    ├─ quest_state_events (start/stop/clear)
    └─ quest_appearance_events (inferred new quests)
    ↓ (bootstrap phase)
If first complete questlist → mark bootstrap complete
    ↓
Enqueue quest_inference_tasks (async)
    └─ Rebuild quest graph, compute prerequisites
```

**⚠️ Missing Implementation:**  
APP-side sender NOT implemented. FUSOU-APP must intercept quest endpoints and call WEB ingest endpoint (currently only PROXY does this in attempt mode).

---

### 2.4 Pattern: Master Data Polling

**Trigger:** Game master data endpoints (mst_ships, mst_slot_items, etc.)  
**Frequency:** Periodic (on demand or cron)  
**Data Path:**
```
Game mst endpoint (e.g., api_start2 master data)
    ↓ [kc-api-parser]
Route to MstShip, MstSlotItem, etc. parser
    ↓ [kc-api-interface-adapter]
Convert to EmitData::Set(MstShips { ... })
    ↓ [FUSOU-APP provider]
Update MstShipsProvider context
    ↓ [D1 store]
Persist master data for ship queries
```

**Persistence:** D1 Cloudflare (reference data, indefinite)  
**Update Strategy:** Full refresh on poll (not incremental)

---

## 3. Authentication & Authorization Flow

### 3.1 Token Lifecycle

**Issuance:**
1. User logs in via FUSOU-APP (Tauri)
2. App calls fusou-auth::AuthManager::from_env()
3. AuthManager reads Supabase URL + API key from env
4. Makes auth request to Supabase token endpoint
5. Receives access_token + refresh_token + expires_at (~60 min)
6. Session persisted to disk (FileStorage)

**Proactive Refresh:**
```rust
// Whenever get_access_token() is called:
1. Load session from disk
2. Check if expires_at > now + 30s (refresh_margin_secs)
3. If valid: return cached token
4. If expiring soon or no expires_at: call force_refresh()
   └─ Acquire mutex lock (single-flight)
   └─ POST refresh_token to Supabase
   └─ Save new access_token + expires_at
   └─ Return new token
```

**Integration in HTTPS Calls:**
```rust
// Before making any API request:
let token = auth_manager.get_access_token().await?;
let headers = HeaderMap::from(
    ("Authorization", format!("Bearer {}", token))
);
client.post(url).headers(headers).send().await
```

### 3.2 Handshake for R2 Upload

**Prerequisite:** Must have valid access_token from Supabase

**Flow:**
```
1. FUSOU-APP calls fusou-upload::Uploader::upload()
   └─ Passes dataset_id, uploader_id, binary_data
    ↓
2. Uploader::handshake() is called
   ├─ Gets access_token from AuthManager
   ├─ POSTs to Supabase auth endpoint
   │  Body: { dataset_id, uploader_id }
   └─ Receives: { uploadUrl, token }
    ↓
3. Uploader uses temp token to PUT to R2
   ├─ Target: uploadUrl (pre-signed R2 URL)
   └─ Auth: temp token from handshake
    ↓
4. On success: R2 stores data
5. On failure: PendingStore persists for retry
```

**Session Persistence:**
- FileStorage writes JSON to disk: `~/.config/fusou-auth/session.json`
- Reloaded on app restart
- Cleared on logout

---

## 4. External API Call Patterns

### 4.1 Game API Interception (Request/Response)

**Caller:** FUSOU-PROXY  
**Target:** Kancolle game server  
**Protocol:** HTTPS (CONNECT tunnel, HTTP/2)  
**Direction:** Bidirectional interception

**Request Parsing:**
```
Game Client → Proxy
    ↓
Intercept query string parameters
    ↓ [kc-api-parser::request_parser()]
Deserialize to DTO (e.g., api_get_member/port Req)
    ↓
Convert to EmitData (may return empty if not tracked)
    ↓
Send to FUSOU-APP via stream
```

**Response Parsing:**
```
Game Server → Proxy
    ↓
Intercept response body (JSON)
    ↓ [kc-api-parser::response_parser()]
Deserialize to DTO (e.g., api_get_member/port Res)
    ↓
Convert via kc-api-interface-adapter to EmitData
    ↓
Send to FUSOU-APP + collect for batch
```

**Data Format:** JSON (game uses JSON responses with `api_data` wrapper)

### 4.2 Quest Ingestion (WEB Collection)

**Caller:** FUSOU-PROXY::QuestTreeSender (or FUSOU-APP, not yet implemented)  
**Target:** FUSOU-WEB `/quest-tree/ingest` endpoint  
**Protocol:** HTTP POST  
**Auth:** None (local network) or Bearer token (future)

**Request Payload:**
```json
POST /quest-tree/ingest
Content-Type: application/json

{
  "dataset_id": "550e8400-e29b-41d4-a716-446655440000",
  "request_id": "uuid-v4",
  "endpoint": "api_get_member/questlist",
  "quest_id": 201,           // optional, present for start/stop/clear
  "page_no": 1,              // optional, present for questlist
  "timestamp_ms": 1712345678000,
  "period_tag": "2026-04",   // REQUIRED as of v2
  "table_version": "0.5",    // REQUIRED as of v2
  "payload_hash": "abc123"   // SHA256 hex string
}
```

**WEB Response:**
```json
200 OK
{ "ingested": true, "event_id": "uuid", "session_id": "uuid" }

400 Bad Request
{ "error": "period_tag is required" }
```

**Error Handling:**
- WEB validates period_tag and table_version (required, no fallback as of v2)
- WEB checks idempotency (payload_hash already processed → 200 with existing event_id)
- Failures logged to monitoring

### 4.3 R2 Upload Handshake

**Caller:** fusou-upload  
**Target:** Supabase auth endpoint  
**Protocol:** HTTPS POST  
**Auth:** Bearer token from previous login

**Request:**
```
POST https://supabase.example.com/auth/v1/token
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "dataset_id": "550e8400-e29b-41d4-a716-446655440000",
  "uploader_id": "user-uuid"
}
```

**Response:**
```json
{
  "uploadUrl": "https://r2.example.com/upload/abc123?token=xyz",
  "token": "xyz-temp-token"
}
```

**Error Responses:**
- 401 Unauthorized → token expired (APP should refresh)
- 403 Forbidden → user lacks upload permission
- 409 Conflict → dataset already exists

### 4.4 R2 Binary Upload

**Caller:** fusou-upload  
**Target:** R2 (Cloudflare)  
**Protocol:** HTTPS PUT/POST (multipart)  
**Auth:** Temp token from handshake

**Request:**
```
PUT {uploadUrl}
Authorization: Bearer {temp_token}
Content-Type: application/octet-stream

[binary concatenated Parquet/Avro data]
```

**Response:**
```
200 OK
{ "etag": "abc123", "key": "raw/dataset-id/file-id.bin" }

409 Conflict
Already exists (key collision)

5xx Server Error
Retry eligible
```

**Retry Logic:**
- Status 5xx → add to PendingStore for retry
- Status 4xx (except 409) → log, don't retry
- Status 409 → check if content matches (if yes, OK; if no, error)

---

## 5. Configuration & Deployment

### 5.1 Configuration Source

**Package:** `configs` (shared)  
**Format:** TOML + environment variable overrides

**Key Sections:**
```toml
[app]
  [app.auth]
    supabase_url = "https://supabase.example.com"
    supabase_key = "public-anon-key"
  
  [app.upload]
    r2_bucket = "fusou-data"
    r2_region = "auto"
    
  [app.asset_sync]
    # Retry strategy for failed uploads
    max_attempts = 5
    backoff_ms = 1000
    ttl_days = 7
  
  [app.quest_ingestion]
    ingest_url = "http://localhost:5173/quest-tree/ingest"
    dataset_id = "${DATASET_ID}"
    period_tag = "${PERIOD_TAG}"
    table_version = "0.5"
```

**Env Override Pattern:**
- `PUBLIC_SUPABASE_URL` → fusou-auth (compile-time embed priority)
- `DATASET_ID` → used in config template substitution
- `PERIOD_TAG` → quest collection versioning

### 5.2 Build Integration

**FUSOU-APP vite.config.ts:**
```typescript
resolve: {
  alias: {
    "@ipc-bindings": resolve(__dirname, "../kc_api/bindings"),
  }
}
```

**kc_api Cargo.toml:**
- Includes macro derive crates for struct selector expansion
- Generates bindings during build via script

### 5.3 Runtime Initialization

**APP:**
```rust
// Tauri backend initialization
let auth = AuthManager::from_env(storage)?;
let uploader = Uploader::new(client, auth);
let retry_service = UploadRetryService::new(store, auth, None);
```

**WEB:**
```typescript
// Cloudflare Worker/Pages
const db = env.D1;
const r2 = env.R2_BUCKET;
const kv = env.KV_CACHE;
// Routes mount quest_tree routes
```

---

## 6. Data Flow Summary Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Game Client (Kancolle)                    │
└────────────────────────────────┬────────────────────────────┘
                                 │ (HTTPS)
                    ┌────────────▼──────────┐
                    │  FUSOU-PROXY (https)  │
                    │  Quest Interception   │
                    └────────┬────────┬─────┘
                             │        │
                      ┌──────▼──┐  ┌──▼────────────┐
                      │ Hot Flow │  │ Collection    │
                      └──────┬──┘  │ QuestTreeSend │
                             │      └──┬───────────┘
              ┌──────────────▼──┐      │ (HTTP POST)
              │  FUSOU-APP      │      │
              │  (Real-time UI) │      │
              │  - Providers    │      │
              │  - Components   │      │
              └────┬─────────┬──┘      │
                   │         │         │
              ┌────▼──┐  ┌──▼─────────▼────┐
              │Upload │  │ FUSOU-WEB       │
              │Trigger│  │ /quest-tree/ing │
              └────┬──┘  │ Normalize Data  │
                   │     └──┬────────┬─────┘
     ┌─────────────▼──┐     │        │
     │ fusou-upload   │     │        │
     │ DatasetProc    │  ┌──▼────┐┌──▼────┐
     │ UploadRetry    │  │ D1    ││ Infer │
     └────┬─────────┬─┘  │Tables ││Tasks  │
          │         │    └───────┘└──────┘
    ┌─────▼──┐   ┌──▼────────┐
    │Supabase│   │ R2 Store  │
    │ Auth   │   │ (Archive) │
    └────────┘   └───────────┘
```

---

## 7. Current State & Known Gaps

### ✅ Implemented
- kc_api: Complete parsing framework + bindings generation
- fusou-auth: Token lifecycle, session persistence
- fusou-upload: Upload pipeline, retry service
- FUSOU-APP: Real-time display + data collection trigger
- FUSOU-PROXY: Game interception, quest collection attempt
- FUSOU-WEB: Ingest validation, normalization, task enqueuing

### ⚠️ Planned/In Progress
- Quest tree async inference (task processing)
- Master data caching layer (KV/Durable Objects)
- Multi-session support in fusou-auth
- Avro format support in fusou-upload (currently stub)

### ❌ Missing / Not Yet Started
- **🔴 FUSOU-APP quest sender:** APP must implement quest endpoint interception + POST to WEB ingest
  - Status: Zero references to `/quest-tree/ingest` in FUSOU-APP codebase
  - Impact: Quest tree collection stuck at proxy level; APP cannot propagate
  - Timeline: Must be done before quest collection begins in production

---

## 8. Typical Workflow Sequence

### Scenario: User logs in, views fleet, triggers upload

```
┌─ USER ACTION: Open FUSOU-APP
│
├─ Step 1: Authenticate
│  ├─ App checks for existing session (FileStorage)
│  ├─ If none: redirects to login (Supabase)
│  └─ Session saved to disk with access_token
│
├─ Step 2: Connect to Game via FUSOU-PROXY
│  ├─ User launches game client
│  ├─ Client connects to proxy (transparent HTTPS)
│  └─ Proxy streams game data to FUSOU-APP
│
├─ Step 3: Real-time Display
│  ├─ Game sends api_get_member/port
│  ├─ Proxy intercepts, parses via kc_api
│  ├─ FUSOU-APP receives EmitData
│  ├─ Providers update state
│  └─ UI components re-render (Materials, Ships, Decks visible)
│
├─ Step 4: Quest Collection (Proxy)
│  ├─ User clicks questlist
│  ├─ Proxy intercepts api_get_member/questlist response
│  ├─ QuestTreeSender extracts quest list
│  ├─ Dedup check: is this the same questlist?
│  └─ If new: POST to WEB /quest-tree/ingest
│
├─ Step 5: Batch Upload
│  ├─ User clicks "Export Data" (or cron triggers)
│  ├─ APP gathers accumulated game state
│  ├─ fusou-upload::process_and_upload_batch() called
│  ├─ Authenticates via fusou-auth (token refresh if needed)
│  ├─ Handshakes with Supabase for R2 URL
│  ├─ Uploads binary to R2
│  └─ Logs success or adds to PendingStore on failure
│
└─ Step 6: Retry (Background)
   ├─ UploadRetryService wakes periodically
   ├─ Checks PendingStore for failed uploads
   ├─ Retries with exponential backoff
   └─ Max 5 attempts, then drops if still failing
```

---

## Conclusion

FUSOU is architected as a **data pipeline system** with clear separation of concerns:
- **kc_api**: Structure definition
- **fusou-auth**: Identity & token management
- **fusou-upload**: Data transport & storage
- **FUSOU-APP**: User interface & collection trigger
- **FUSOU-PROXY**: API interception & event extraction
- **FUSOU-WEB**: Ingest, normalization, inference

The system emphasizes **type safety** (via kc_api bindings), **resilience** (retry service), and **deduplication** (payload hashing). The critical missing piece is **APP-side quest sender**, which must be implemented to complete the quest-tree collection loop.
