use kc_api::interface::{ship, slot_item, use_items};
use kc_api::fleet_snapshot::fleet::FleetSnapshot;
use reqwest::Client;
use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use proxy_https::asset_sync;
use uuid::Uuid;
use serde::Deserialize;

#[derive(Deserialize)]
struct PrepareResponse {
    #[serde(rename = "uploadUrl")]
    upload_url: String,
}

#[derive(Serialize)]
struct SnapshotRequest {
    tag: String,
    payload: serde_json::Value,
    title: Option<String>,
    version: Option<i64>,
}

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

pub async fn perform_snapshot_sync_app(app: &AppHandle) -> Result<serde_json::Value, String> {
    tracing::info!("Starting snapshot sync");

    let app_configs = configs::get_user_configs_for_app();
    
    let snapshot_url = if let Some(explicit) = app_configs.asset_sync.get_snapshot_endpoint() {
        explicit
    } else {
        tracing::error!("Snapshot endpoint not configured");
        return Err("Snapshot endpoint not configured".to_string());
    };

    let token = match asset_sync::get_supabase_access_token() {
        Some(t) if !t.is_empty() => t,
        _ => {
            let msg = "Snapshot sync requires auth but no token available";
            tracing::error!("{}", msg);
            let _ = app.notification().builder().title("Sync Failed").body(msg).show();
            return Err(msg.to_string());
        }
    };

    let payload_data = get_payload_data();

    let request_body = SnapshotRequest {
        tag: "latest".to_string(),
        payload: payload_data,
        title: Some("Auto Snapshot".to_string()),
        version: Some(chrono::Utc::now().timestamp()),
    };

    let client = Client::new();
    let idempotency_key = Uuid::new_v4().to_string();

    tracing::info!(endpoint = %snapshot_url, "Preparing snapshot upload");
    let prepare_req = client
        .post(&snapshot_url)
        .json(&request_body)
        .header("Idempotency-Key", &idempotency_key)
        .bearer_auth(token.clone());

    let prepare_resp = prepare_req.send().await.map_err(|e| {
        tracing::error!("Snapshot preparation failed: {}", e);
        let _ = app.notification().builder().title("Sync Failed").body("Network error during preparation").show();
        e.to_string()
    })?;

    let prepare_status = prepare_resp.status();
    let prepare_text = prepare_resp.text().await.unwrap_or_default();

    if !prepare_status.is_success() {
        tracing::error!(status = prepare_status.as_u16(), body = %prepare_text, "Snapshot preparation failed");
        let _ = app.notification().builder().title("Sync Failed").body(&format!("Server error during preparation: {}", prepare_status)).show();
        return Err(format!("Status: {}, Body: {}", prepare_status, prepare_text));
    }

    let prepare_json: PrepareResponse = match serde_json::from_str(&prepare_text) {
        Ok(json) => json,
        Err(e) => {
            tracing::error!("Failed to parse preparation response: {}", e);
            return Err("Invalid response from server".to_string());
        }
    };

    let upload_url = prepare_json.upload_url;
    tracing::info!(endpoint = %upload_url, "Uploading snapshot data");
    
    let upload_req = client
        .post(&upload_url)
        .json(&request_body)
        .bearer_auth(token);

    let upload_resp = upload_req.send().await.map_err(|e| {
        tracing::error!("Snapshot upload failed: {}", e);
        let _ = app.notification().builder().title("Sync Failed").body("Network error during upload").show();
        e.to_string()
    })?;

    let upload_status = upload_resp.status();
    let upload_text = upload_resp.text().await.unwrap_or_default();

    if upload_status.is_success() {
        tracing::info!(status = upload_status.as_u16(), "Snapshot upload successful");
        // Log server response body so operators can see diagnostic fields in tracing output
        tracing::info!(response_body = %upload_text, "Snapshot upload response body");
        let _ = app
            .notification()
            .builder()
            .title("Snapshot sync")
            .body("Snapshot sync completed")
            .show();
        
        let json_resp: serde_json::Value = serde_json::from_str(&upload_text).unwrap_or(json!({}));

        Ok(json_resp)
    } else {
        tracing::error!(status = upload_status.as_u16(), body = %upload_text, "Snapshot upload failed");
        let _ = app
            .notification()
            .builder()
            .title("Snapshot sync failed")
            .body(&format!("Server error during upload: {}", upload_status))
            .show();
        
        Err(format!("Status: {}, Body: {}", upload_status, upload_text))
    }
}
