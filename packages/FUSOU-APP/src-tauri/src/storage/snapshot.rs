use kc_api::interface::{ship, slot_item, use_items};
use kc_api::fleet_snapshot::fleet::FleetSnapshot;
use reqwest::Client;
use serde_json::json;
use tauri::AppHandle;
use crate::notify;
use uuid::Uuid;
use fusou_auth::{AuthManager, FileStorage};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use fusou_upload::{PendingStore, UploadContext, Uploader, UploadRequest, UploadResult};
use crate::auth::auth_server;

fn get_payload_data() -> serde_json::Value {
    let use_items = use_items::UseItems::load();
    let ships = ship::Ships::load();
    let slot_items = slot_item::SlotItems::load();
    let payload = FleetSnapshot::new(
        ships.ships.values().cloned().collect(),
        use_items.use_items.values().cloned().collect(),
        slot_items.slot_items.values().cloned().collect(),
    );
    json!(payload)
}

fn canonicalize_json(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::{Map, Value};
    match value {
        Value::Object(map) => {
            let mut btree: std::collections::BTreeMap<String, Value> = std::collections::BTreeMap::new();
            for (k, v) in map.iter() {
                btree.insert(k.clone(), canonicalize_json(v));
            }
            let mut ordered = Map::new();
            for (k, v) in btree.into_iter() {
                ordered.insert(k, v);
            }
            Value::Object(ordered)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(canonicalize_json).collect()),
        _ => value.clone(),
    }
}

pub async fn perform_snapshot_sync_app(
    app: &AppHandle,
    auth_manager: Arc<Mutex<AuthManager<FileStorage>>>,
) -> Result<serde_json::Value, String> {
    tracing::info!("Starting snapshot sync");

    let app_configs = configs::get_user_configs_for_app();
    
    let snapshot_url = if let Some(explicit) = app_configs.asset_sync.get_snapshot_endpoint() {
        explicit
    } else {
        tracing::error!("Snapshot endpoint not configured");
        return Err("Snapshot endpoint not configured".to_string());
    };

    let payload_data = canonicalize_json(&get_payload_data());
    // Compute SHA-256 of the raw JSON bytes to satisfy server-side verification
    let payload_bytes = match serde_json::to_vec(&payload_data) {
        Ok(b) => b,
        Err(e) => {
            let msg = format!("Failed to serialize payload: {}", e);
            tracing::error!("{}", msg);
            return Err(msg);
        }
    };

    tracing::info!(
        payload_size_bytes = payload_bytes.len(),
        "Prepared snapshot data"
    );

    // Build handshake request body via common helper
    let handshake_body = fusou_upload::Uploader::build_snapshot_handshake("latest");

    let mut headers = std::collections::HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    let idempotency_key = Uuid::new_v4().to_string();
    headers.insert("Idempotency-Key".to_string(), idempotency_key);

    let request = UploadRequest {
        endpoint: &snapshot_url,
        handshake_body,
        data: payload_bytes,
        headers,
        context: UploadContext::Snapshot { is_snapshot: true },
    };

    let client = Client::new();
    let manager = auth_manager.lock().unwrap().clone();
    let pending_store = app.try_state::<Arc<PendingStore>>();

    tracing::info!(endpoint = %snapshot_url, "Starting snapshot upload via Uploader");
    match Uploader::upload(&client, &manager, request, pending_store.as_deref().map(|s| s.as_ref())).await {
        Ok(UploadResult::Success) => {
            tracing::info!("Snapshot upload successful");
            notify::show(app, "Snapshot sync", "Snapshot sync completed");
            Ok(json!({ "ok": true, "tag": "latest" }))
        }
        Ok(UploadResult::Skipped) => {
            tracing::info!("Snapshot skipped (already exists or empty)");
            notify::show(app, "Snapshot sync", "Snapshot already up-to-date");
            Ok(json!({ "ok": true, "skipped": true, "tag": "latest" }))
        }
        Err(e) => {
            // Check for authentication errors
            if e.contains("Authentication error") {
                notify::show(app, "Sign-in Required", "Session expired. Please sign in again.");
                let _ = auth_server::open_auth_page();
            } else {
                notify::show(app, "Snapshot sync failed", &format!("Upload error: {}", e));
            }
            tracing::error!(error = %e, "Snapshot upload failed");
            Err(e)
        }
    }
}
