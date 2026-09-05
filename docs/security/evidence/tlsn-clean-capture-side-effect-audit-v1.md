# TLSN Clean-Capture Side-Effect Audit v1

Date: 2026-03-03
Audited revision: `186609d2e9dd2ae54e3ef1067af74507e8335923`
Scope: repository-local source review only. No Game Server access, replay, request injection, capture generation, or traffic generation was performed for this audit.

## Decision

Final classification: `NOT_SAFE_FOR_CLEAN_CAPTURE`.

The current `FUSOU-APP/scripts/testplay-verify.mjs` launcher disables the principal configured persistence and upload features for a fresh process, and its local override/restoration behavior is covered by deterministic tests. It does not provide a process-wide network deny boundary, however. The source contains reachable external sinks that are independent of the disabled asset/database flags, and the launcher does not close the remaining configuration, process, or signal races. A future capture started with this launcher must not be represented as privacy-qualified solely because the launcher completed normally.

This classification is independent of natural provenance. It does not make the historical capture natural or unnatural; that capture remains disqualified for P0-04 because its privacy qualification is blocked.

## Scope and method

Reviewed:

- launcher mutation and restoration behavior;
- app startup ordering and configuration initialization;
- proxy persistence and raw-wire capture behavior;
- auth, deep-link sync, period-tag fetch, Discord IPC, updater, snapshot, sender, storage-provider, uploader, and pending-retry paths;
- direct `Uploader::upload` call sites;
- process-global `OnceCell` configuration, storage, sender, and retry state;
- deterministic local launcher tests.

The audit asks whether a fresh ordinary gameplay run can be proven to have no unintended external side effects. It does not ask whether the intended TLSN raw-wire artifact is written: that artifact is the explicitly allowed output of the capture procedure.

## Launcher controls verified

`testplay-verify.mjs` rewrites or appends these settings in the temporary roaming config:

- proxy API/resource persistence: `allow_save_api_requests`, `allow_save_api_responses`, `allow_save_resources`, and `allow_save_main_js_local` to `false`;
- database providers: `allow_data_to_cloud`, `allow_data_to_shared_cloud`, and `allow_data_to_local` to `false`;
- asset upload: `asset_upload_enable` to `false`;
- auth bootstrap: `deny_auth` to `true`;
- four custom senders: each `enable` to `false`;
- capture: `capture_enabled` to `true` and `capture_output_path` to the supplied absolute path.

The launcher rejects an output path inside the repository and writes capture artifacts outside the repository. On normal child exit, it restores the exact original UTF-8 string or removes a config file that was originally absent.

The focused test command passed:

```text
pnpm --dir packages/FUSOU-APP test:clean-capture
2 passed, 0 failed
```

These controls are configuration controls, not a universal outbound-I/O control.

## Sink table

| Sink | Source chain | Launcher control | Residual finding |
| --- | --- | --- | --- |
| Intended exact-wire capture | proxy `serve_proxy` -> `RawCaptureHook` | `capture_enabled=true`, private absolute output | Allowed and intentional. It is not evidence that other sinks are blocked. |
| Proxy API/resource persistence | proxy `serve_proxy` -> `LogHandler` | Four `allow_save_*` flags set false | Fresh proxy handler reads the flags once and skips those persistence paths. The capture hook still writes raw artifacts by design. |
| Proxy asset worker | proxy `serve_proxy` -> `_app_configs.asset_sync.get_enable()` -> `asset_sync::start` | `asset_upload_enable=false` | The current config getter maps `get_enable()` to `asset_upload_enable`, so the launcher disables this worker for a fresh process. This is not a general guard for app-side upload callers. |
| Database providers | `StorageService::get_instance` -> `initialize` -> cloud/local/R2 providers | All three database allow flags false | Fresh initialization creates no providers. The service is a process-global `OnceCell`; an already initialized service is not re-evaluated when settings change. |
| Custom sender uploads | JSON parser -> sender worker -> `get_period_tag` and `Uploader::upload` | Sender `enable=false` | Sender workers have no dynamic deny check. Existing singleton/worker state or startup ordering can outlive the intended override. |
| Pending upload retry | startup background loop / retry command -> `trigger_retry*` -> `retry_one` -> `Uploader::upload` | `deny_auth=true` checked at entry points | The background task enters through a guarded method, but an already-running retry operation is not cancelled. `retry_one` and `Uploader::upload` have no central clean-capture gate. |
| Snapshot upload | Tauri snapshot command -> `perform_snapshot_sync_app` -> `Uploader::upload` | `asset_upload_enable=false` | Fresh calls return before upload. This is an execution guard, not cancellation of a call already in progress. |
| Period-tag API GET | `launch_with_options` or sender/storage path -> `auth::supabase::get_period_tag` -> `fetch_period_tag_via_api` -> `reqwest::Client::get(...).send()` | No launcher override | Reachable independently of `asset_upload_enable`. The first invocation can GET `kc_period_endpoint` and then cache the result. This is a concrete uncovered external sink. |
| Deep-link public-id sync | single-instance callback -> `handle_public_id_sync_async` -> `send_supabase_update` -> `reqwest::Client::post(...).send()` | No launcher override or `deny_auth` check | A `fusou://sync?token=...` invocation can POST to the configured complete endpoint with retries. This path is not blocked by the current launcher. |
| Discord IPC | `setup_discord` -> `discord::connect` / `set_activity_button` | Discord setting is preserved, not forced false | A user config with Discord enabled can transmit activity through the local Discord IPC connection. It is an external side effect outside the proxy and HTTP upload controls. |
| Supabase auth refresh/provider token | startup bootstrap or provider setup -> `AuthManager::get_access_token`, `force_refresh`, `fetch_provider_token` | Startup anonymous auth returns under `deny_auth`; provider creation is normally disabled | Lower-level auth methods have no deny gate. They remain callable by unguarded paths and can perform refresh or provider-token GET/POST requests if invoked. |
| Local pending/config state | `PendingStore`, config setup/update, auth token persistence | No full local-state isolation | Failed uploads can create pending files; auth/config code can rewrite local state. These writes are not external network traffic, but they affect provenance and future retry behavior. |
| Release updater | release-only setup -> updater plugin/check path | `tauri dev` normally excludes release setup | Not expected in the current dev launcher path, but this is conditional on build configuration rather than an explicit launcher deny. |

## Source chains and controlling evidence

### Configuration and singleton boundary

The launcher edits `src-tauri/roaming/user/configs.toml` before starting `pnpm tauri dev`. The app later calls `setup_configs()`, which calls `configs::set_user_config()`. `configs::set_user_config()` stores the parsed config in a process-global `OnceCell`; a second initialization keeps the first instance. Missing fields can fall back to embedded defaults, and `get_configs()` may rewrite the file with merged defaults. This means the audit cannot treat the on-disk file as a live, dynamically enforced policy after process initialization.

Relevant sources:

- [testplay-verify.mjs](../../../packages/FUSOU-APP/scripts/testplay-verify.mjs)
- [setup.rs](../../../packages/FUSOU-APP/src-tauri/src/builder_setup/setup.rs)
- [configs.rs](../../../packages/configs/src/configs.rs)

### App-side direct HTTP paths

`launch_with_options()` enters `sequence::launch::launch_with_options`. That path calls `auth::supabase::get_period_tag()`. The first call reaches `fetch_period_tag_via_api()`, which sends a GET to the configured `kc_period_endpoint`; on failure it falls back to a local date, but the request attempt has already occurred.

The four sender paths also call `get_period_tag()` before their upload decision. Their `Uploader::upload` calls are controlled by sender initialization and enablement, but the period-tag request is not.

The public-id handoff path is separate: the single-instance callback recognizes `fusou://sync?token=...`, spawns the sync task, and posts to the configured complete endpoint. No `deny_auth` read occurs in that chain.

Relevant sources:

- [launch.rs](../../../packages/FUSOU-APP/src-tauri/src/sequence/launch.rs)
- [supabase.rs](../../../packages/FUSOU-APP/src-tauri/src/auth/supabase.rs)
- [single_instance.rs](../../../packages/FUSOU-APP/src-tauri/src/builder_setup/single_instance.rs)
- [quest_tree_sender.rs](../../../packages/FUSOU-APP/src-tauri/src/senders/quest_tree_sender.rs)
- [ship_growth_sender.rs](../../../packages/FUSOU-APP/src-tauri/src/senders/ship_growth_sender.rs)
- [soku_speed_sender.rs](../../../packages/FUSOU-APP/src-tauri/src/senders/soku_speed_sender.rs)
- [remodel_sender.rs](../../../packages/FUSOU-APP/src-tauri/src/senders/remodel_sender.rs)

### Upload and retry boundary

`Uploader::upload` performs the handshake and binary upload requests and may persist failed requests to `PendingStore`. It does not inspect `deny_auth`, `asset_upload_enable`, or a clean-capture mode. The direct callers include all four custom senders, snapshot sync, app retry handling, storage providers, and the shared retry service.

`StorageService` constructs providers only once using the database flags. R2 and cloud providers can therefore be disabled for a fresh process, but a provider already present in the process is not removed by a later config edit. The same reasoning applies to sender workers and the retry service.

Relevant sources:

- [uploader.rs](../../../packages/fusou-upload/src/uploader.rs)
- [retry_service.rs](../../../packages/fusou-upload/src/retry_service.rs)
- [service.rs](../../../packages/fusou-storage/src/service.rs)
- [snapshot.rs](../../../packages/FUSOU-APP/src-tauri/src/storage/snapshot.rs)
- [retry_handler.rs](../../../packages/FUSOU-APP/src-tauri/src/storage/retry_handler.rs)

## Race and failure analysis

### Before the `try/finally` restoration block

The launcher creates the output directory, creates the config parent directory, reads the original config, reads the default config when needed, computes the override, and writes the temporary config before entering `try/finally`. Any failure in these operations can leave a previously absent or previously existing config unchanged or partially replaced, depending on the failing operation. The config write is a direct `fs.writeFile`, not an atomic temporary-file-plus-rename transaction.

### During app execution

The launcher forwards `SIGINT` and `SIGTERM` only to the direct `pnpm` child. It does not create or terminate a process group. Descendant processes can therefore outlive the child and continue using the temporary config or performing work. The launcher also does not reject or isolate an already-running FUSOU-APP instance; Tauri single-instance behavior can route work to an existing process whose `OnceCell` config and workers were initialized under different settings.

The launcher cannot cancel in-flight requests, retry tasks, sender workers, Discord IPC, or period-tag fetches. A normal child exit only proves that the direct child closed; it does not prove that all descendant tasks and network operations stopped before restoration.

### After exit and restoration

Normal exit restores the exact original string or removes an originally absent file. Crash, `SIGKILL`, power loss, launcher termination, or a descendant surviving the direct child bypasses the `finally` block. A later process can also observe a stale temporary config. The restoration test covers normal completion semantics only, not crash recovery or process-group cleanup.

## Historical capture statement

The historical natural `require_info` capture may retain natural provenance based on its observed gameplay path, but it is not privacy-qualified. Earlier forensic review identified application-side persistence/upload and retry exposure in the historical run. The current audit does not alter that result and does not retroactively classify the historical artifact as P0-04 eligible.

Required gates remain:

- `P0-04=BLOCKED`;
- `P0-05=BLOCKED`;
- `IMPLEMENTATION=NO-GO`.

## Required changes before a clean capture claim

A future clean-capture launcher should have a single authoritative runtime deny policy enforced at every outbound sink, including period-tag fetch, deep-link sync, Discord, auth refresh/provider-token fetch, retries, storage providers, sender workers, snapshot upload, and `Uploader::upload` itself. It should also reject an existing app instance, use process-group/job cleanup, make config replacement atomic, and provide crash recovery or an isolated config path rather than mutating the normal roaming config.

Until those controls are implemented and tested, the only supportable claim is that this launcher disables selected configured persistence/upload features for a fresh process. It does not support a claim of zero external side effects.
