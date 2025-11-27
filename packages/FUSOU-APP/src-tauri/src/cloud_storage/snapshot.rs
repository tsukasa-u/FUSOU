use sha2::{Digest, Sha256};
use flate2::write::GzEncoder;
use flate2::Compression;
use reqwest::Client;
use hex;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use proxy_https::asset_sync;
use uuid::Uuid;

// Use fully-qualified tracing macros to match project's style (no `use tracing::...`)

pub async fn perform_snapshot_sync_app(app: &AppHandle) -> Result<serde_json::Value, String> {
    // Notify start via tauri plugin notification (Rust-side notification per UX request)
    tracing::info!("Starting snapshot sync");
    let _ = app
        .notification()
        .builder()
        .title("Snapshot sync")
        .body("Starting snapshot sync...")
        .show();

    // TESTCODE: TS currently only sends a sync flag; payload sending is not implemented.
    // Use a placeholder payload for testing; the real payload will be prepared later.
    let payload_str = "TESTCODE".to_string();
    tracing::debug!("snapshot payload size: {} bytes", payload_str.as_bytes().len());

    // Compute SHA-256 over the uncompressed JSON payload
    let mut hasher = Sha256::new();
    hasher.update(payload_str.as_bytes());
    let hash = hasher.finalize();
    let hash_hex = hex::encode(hash);
    tracing::info!(sha256 = %hash_hex, "computed payload sha256");

    // Compress payload with gzip
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    use std::io::Write;
    if let Err(e) = encoder.write_all(payload_str.as_bytes()) {
        tracing::error!("gzip write failed: {}", e);
        let _ = app
            .notification()
            .builder()
            .title("Snapshot sync failed")
            .body(&format!("gzip write failed: {}", e))
            .show();
        return Err(format!("gzip write failed: {}", e));
    }
    let compressed = match encoder.finish() {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("gzip finish failed: {}", e);
            let _ = app
                .notification()
                .builder()
                .title("Snapshot sync failed")
                .body(&format!("gzip finish failed: {}", e))
                .show();
            return Err(format!("gzip finish failed: {}", e));
        }
    };
    tracing::info!(compressed_len = compressed.len(), "compressed payload size");

    // Derive upload endpoint from app configs and attach auth if available.
    // The configured `asset_sync.api_endpoint` usually points to the asset upload route
    // (e.g. `/api/asset-sync/upload`). We prefer to POST snapshot manifests to
    // the Pages API `/api/fleet/snapshot` route on the same origin. To do this we
    // parse the configured endpoint and build the `/api/fleet/snapshot` URL.
    let app_configs = configs::get_user_configs_for_app();

    // Prefer explicit snapshot endpoint when configured. Fall back to deriving
    // origin from `asset_sync.api_endpoint` and using `/api/fleet/snapshot`.
    let snapshot_url = if let Some(explicit) = app_configs.asset_sync.get_snapshot_endpoint() {
        tracing::debug!(snapshot_endpoint = %explicit, "using explicit snapshot_endpoint from config");
        explicit
    } else {
        let api_endpoint = app_configs
            .asset_sync
            .get_api_endpoint()
            .ok_or_else(|| "asset_sync.api_endpoint is not configured".to_string())?;

        let parsed = reqwest::Url::parse(&api_endpoint)
            .map_err(|e| format!("invalid asset_sync.api_endpoint: {}", e))?;
        let host = parsed
            .host_str()
            .ok_or_else(|| "asset_sync.api_endpoint missing host".to_string())?;
        let origin = if let Some(port) = parsed.port() {
            format!("{}://{}:{}", parsed.scheme(), host, port)
        } else {
            format!("{}://{}", parsed.scheme(), host)
        };
        format!("{}/api/fleet/snapshot", origin)
    };

    let client = Client::new();
    let mut req = client
        .post(&snapshot_url)
        .body(compressed)
        .header("Content-Encoding", "gzip");
    req = req.header("X-Content-Hash", format!("sha256:{}", hash_hex));
    // Add an idempotency key so the server can dedupe duplicate requests
    let idempotency = Uuid::new_v4().to_string();
    req = req.header("Idempotency-Key", idempotency.clone());
    tracing::info!(endpoint = %snapshot_url, "uploading snapshot to endpoint");

    // If asset_sync requires Supabase auth, try to obtain stored token from asset_sync module
    if app_configs.asset_sync.get_require_supabase_auth() {
        if let Some(token) = asset_sync::get_supabase_access_token() {
            if !token.is_empty() {
                tracing::debug!("attaching supabase bearer token to upload request (token present)");
                req = req.bearer_auth(token);
            } else {
                tracing::warn!("asset_sync requires supabase auth but no token available");
            }
        } else {
            tracing::warn!("asset_sync requires supabase auth but get_supabase_access_token returned None");
        }
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("upload request failed: {}", e);
            let _ = app
                .notification()
                .builder()
                .title("Snapshot sync failed")
                .body(&format!("upload request failed: {}", e))
                .show();
            return Err(format!("upload request failed: {}", e));
        }
    };
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status.is_success() {
        tracing::info!(status = status.as_u16(), "snapshot upload successful");
        let _ = app
            .notification()
            .builder()
            .title("Snapshot sync")
            .body("Snapshot sync completed")
            .show();
    } else {
        tracing::error!(status = status.as_u16(), "snapshot upload failed");
        let _ = app
            .notification()
            .builder()
            .title("Snapshot sync failed")
            .body(&format!("status: {}", status.as_u16()))
            .show();
    }

    let mut out = serde_json::Map::new();
    out.insert("status".to_string(), serde_json::json!(status.as_u16()));
    out.insert("body".to_string(), serde_json::json!(text));
    out.insert("sha256".to_string(), serde_json::json!(hash_hex));

    Ok(serde_json::Value::Object(out))
}
