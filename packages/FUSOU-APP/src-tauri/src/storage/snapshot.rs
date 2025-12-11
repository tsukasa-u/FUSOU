use kc_api::interface::{ship, slot_item, use_items};
use kc_api::fleet_snapshot::fleet::FleetSnapshot;
use reqwest::Client;
use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;
use serde::Deserialize;
use fusou_auth::{AuthManager, FileStorage};
use fusou_auth::error::AuthError;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use fusou_upload::PendingStore;
use fusou_upload::UploadContext;
use crate::auth::auth_server;

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

    let token = {
        let manager = auth_manager.lock().unwrap().clone();
        match manager.get_access_token().await {
            Ok(t) => t,
            Err(AuthError::RequireReauth(msg)) => {
                let _ = app
                    .notification()
                    .builder()
                    .title("Sign-in Required")
                    .body("Session expired. Please sign in again.")
                    .show();
                let _ = auth_server::open_auth_page();
                return Err(msg);
            }
            Err(AuthError::NoSession) => {
                let msg = "No session found; please sign in.".to_string();
                let _ = app
                    .notification()
                    .builder()
                    .title("Sign-in Required")
                    .body("No session found. Please sign in.")
                    .show();
                let _ = auth_server::open_auth_page();
                return Err(msg);
            }
            Err(e) => {
                let msg = format!("Snapshot sync requires auth but failed to get token: {}", e);
                tracing::error!("{}", msg);
                let _ = app
                    .notification()
                    .builder()
                    .title("Sync Failed")
                    .body(&msg)
                    .show();
                return Err(msg);
            }
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

    let prepare_resp = match prepare_req.send().await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!("Snapshot preparation failed: {}", e);
            let _ = app.notification().builder().title("Sync Failed").body("Network error during preparation").show();
            
            // Save to pending store
            if let Some(store) = app.try_state::<Arc<PendingStore>>() {
                let body_json = serde_json::to_string(&request_body).unwrap_or_default();
                let mut headers = std::collections::HashMap::new();
                headers.insert("Idempotency-Key".to_string(), idempotency_key.clone());
                
                let context = UploadContext::Snapshot { is_snapshot: true };
                let context_json = serde_json::to_string(&context).unwrap_or_default();
                
                if let Err(err) = store.save_pending(&snapshot_url, &headers, body_json.as_bytes(), Some(context_json)) {
                    tracing::error!("Failed to save pending snapshot: {}", err);
                } else {
                    tracing::info!("Saved pending snapshot due to network error");
                }
            }
            
            return Err(e.to_string());
        }
    };

    let prepare_status = prepare_resp.status();
    let prepare_text = prepare_resp.text().await.unwrap_or_default();

    if !prepare_status.is_success() {
        tracing::error!(status = prepare_status.as_u16(), body = %prepare_text, "Snapshot preparation failed");
        let _ = app.notification().builder().title("Sync Failed").body(&format!("Server error during preparation: {}", prepare_status)).show();
        
        if prepare_status.is_server_error() || prepare_status == reqwest::StatusCode::TOO_MANY_REQUESTS {
             if let Some(store) = app.try_state::<Arc<PendingStore>>() {
                let body_json = serde_json::to_string(&request_body).unwrap_or_default();
                let mut headers = std::collections::HashMap::new();
                headers.insert("Idempotency-Key".to_string(), idempotency_key.clone());
                
                let context = UploadContext::Snapshot { is_snapshot: true };
                let context_json = serde_json::to_string(&context).unwrap_or_default();
                
                if let Err(err) = store.save_pending(&snapshot_url, &headers, body_json.as_bytes(), Some(context_json)) {
                    tracing::error!("Failed to save pending snapshot: {}", err);
                } else {
                    tracing::info!("Saved pending snapshot due to server error");
                }
            }
        }
        
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

    let upload_resp = match upload_req.send().await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!("Snapshot upload failed: {}", e);
            let _ = app.notification().builder().title("Sync Failed").body("Network error during upload").show();
            
            // Save to pending store
            if let Some(store) = app.try_state::<Arc<PendingStore>>() {
                let body_json = serde_json::to_string(&request_body).unwrap_or_default();
                let mut headers = std::collections::HashMap::new();
                headers.insert("Idempotency-Key".to_string(), idempotency_key.clone());
                
                let context = UploadContext::Snapshot { is_snapshot: true };
                let context_json = serde_json::to_string(&context).unwrap_or_default();
                
                if let Err(err) = store.save_pending(&snapshot_url, &headers, body_json.as_bytes(), Some(context_json)) {
                    tracing::error!("Failed to save pending snapshot: {}", err);
                } else {
                    tracing::info!("Saved pending snapshot due to upload network error");
                }
            }
            
            return Err(e.to_string());
        }
    };

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
        
        if upload_status.is_server_error() || upload_status == reqwest::StatusCode::TOO_MANY_REQUESTS {
             if let Some(store) = app.try_state::<Arc<PendingStore>>() {
                let body_json = serde_json::to_string(&request_body).unwrap_or_default();
                let mut headers = std::collections::HashMap::new();
                headers.insert("Idempotency-Key".to_string(), idempotency_key.clone());
                
                let context = UploadContext::Snapshot { is_snapshot: true };
                let context_json = serde_json::to_string(&context).unwrap_or_default();
                
                if let Err(err) = store.save_pending(&snapshot_url, &headers, body_json.as_bytes(), Some(context_json)) {
                    tracing::error!("Failed to save pending snapshot: {}", err);
                } else {
                    tracing::info!("Saved pending snapshot due to upload server error");
                }
            }
        }

        Err(format!("Status: {}, Body: {}", upload_status, upload_text))
    }
}
