use std::f32::consts::E;

use reqwest::Client;
use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use proxy_https::asset_sync;
use uuid::Uuid;

// ペイロード送信用構造体
#[derive(Serialize)]
struct SnapshotRequest {
    tag: String,
    payload: serde_json::Value, // 任意のJSONペイロード
    title: Option<String>,
    version: Option<u64>,
}

pub async fn perform_snapshot_sync_app(app: &AppHandle) -> Result<serde_json::Value, String> {
    tracing::info!("Starting snapshot sync");

    // 1. 設定の取得
    let app_configs = configs::get_user_configs_for_app();
    
    // 2. エンドポイントの決定
    let snapshot_url = if let Some(explicit) = app_configs.asset_sync.get_snapshot_endpoint() {
        explicit
    } else {
        return Err("Snapshot endpoint not configured".to_string());
    };

    // 3. 認証トークンの取得 (必須とする)
    let token = match asset_sync::get_supabase_access_token() {
        Some(t) if !t.is_empty() => t,
        _ => {
            let msg = "Snapshot sync requires auth but no token available";
            tracing::error!("{}", msg);
            let _ = app.notification().builder().title("Sync Failed").body(msg).show();
            return Err(msg.to_string());
        }
    };

    // 4. ペイロードの準備 (JSON構造体を作成)
    // ここではテスト用に固定値を入れていますが、実際は引数で受け取る想定
    let request_body = SnapshotRequest {
        tag: "latest".to_string(), // ★必須: タグを指定
        payload: json!({ "foo": "bar", "message": "TESTCODE" }), // ★JSONオブジェクトとして送信
        title: Some("Auto Snapshot".to_string()),
        version: None, // サーバー側でtimestampを使うならNoneでOK
    };

    let client = Client::new();
    let idempotency = Uuid::new_v4().to_string();

    tracing::info!(endpoint = %snapshot_url, "uploading snapshot");

    // 5. リクエスト送信 (JSONとして送信)
    let mut req = client
        .post(&snapshot_url)
        .json(&request_body) // ★自動でContent-Type: application/jsonになり、bodyもシリアライズされる
        .header("Idempotency-Key", idempotency);

    if !token.is_empty() {
        req = req.bearer_auth(token);
    }

    let resp = req.send().await.map_err(|e| {
        tracing::error!("Request failed: {}", e);
        let _ = app.notification().builder().title("Sync Failed").body("Network error").show();
        e.to_string()
    })?;

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
        
        // 成功レスポンスのパース
        let json_resp: serde_json::Value = serde_json::from_str(&text).unwrap_or(json!({}));
        Ok(json_resp)
    } else {
        tracing::error!(status = status.as_u16(), body = %text, "snapshot upload failed");
        let _ = app
            .notification()
            .builder()
            .title("Snapshot sync failed")
            .body(&format!("Server error: {}", status.as_u16()))
            .show();
        
        // 失敗詳細を返す
        Err(format!("Status: {}, Body: {}", status, text))
    }
}