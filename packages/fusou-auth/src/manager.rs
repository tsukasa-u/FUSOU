use crate::error::AuthError;
use crate::storage::Storage;
use crate::types::{DatasetToken, DatasetTokenStore, Session};
use chrono::{DateTime, Duration, Utc};
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing;

const SUPABASE_URL_EMBED: Option<&str> = option_env!("PUBLIC_SUPABASE_URL");
const SUPABASE_PUBLISHABLE_KEY_EMBED: Option<&str> = option_env!("PUBLIC_SUPABASE_PUBLISHABLE_KEY");
// Fallback TTL when Supabase response omits expires_in (seconds)
const DEFAULT_ACCESS_TOKEN_TTL_SECS: i64 = 55 * 60; // 55 minutes to refresh before typical 60m expiry

fn masked_error_payload(input: &str) -> String {
    if cfg!(debug_assertions) {
        return input.to_string();
    }
    if input.trim().is_empty() {
        "".to_string()
    } else {
        "********".to_string()
    }
}

#[derive(Clone)]
pub struct AuthConfig {
    pub supabase_url: String,
    pub api_key: String,
    /// path for token requests (default: "/auth/v1/token")
    pub refresh_path: String,
    /// when token is expiring within this many seconds, proactively refresh
    pub refresh_margin_secs: i64,
}

pub struct AuthManager<S: Storage + 'static> {
    config: AuthConfig,
    storage: Arc<S>,
    client: Client,
    // mutex to ensure single-flight refresh
    refresh_lock: Arc<Mutex<()>>,
    // dataset_token cache shared across all clones of this manager
    dataset_token_cache: Arc<Mutex<DatasetTokenStore>>,
    // file path for persistent dataset_token storage (optional)
    dataset_token_path: Arc<std::sync::Mutex<Option<std::path::PathBuf>>>,
}

impl<S: Storage> Clone for AuthManager<S> {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            storage: self.storage.clone(),
            client: self.client.clone(),
            refresh_lock: self.refresh_lock.clone(),
            dataset_token_cache: self.dataset_token_cache.clone(),
            dataset_token_path: self.dataset_token_path.clone(),
        }
    }
}

impl<S: Storage> AuthManager<S> {
    pub fn new(config: AuthConfig, storage: Arc<S>) -> Self {
        Self {
            config,
            storage,
            client: Client::new(),
            refresh_lock: Arc::new(Mutex::new(())),
            dataset_token_cache: Arc::new(Mutex::new(DatasetTokenStore::default())),
            dataset_token_path: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// Create with optional persistent dataset_token storage path.
    pub fn new_with_dataset_token_path(
        config: AuthConfig,
        storage: Arc<S>,
        dataset_token_path: Option<std::path::PathBuf>,
    ) -> Self {
        Self {
            config,
            storage,
            client: Client::new(),
            refresh_lock: Arc::new(Mutex::new(())),
            dataset_token_cache: Arc::new(Mutex::new(DatasetTokenStore::default())),
            dataset_token_path: Arc::new(std::sync::Mutex::new(dataset_token_path)),
        }
    }

    /// Set or update the dataset_token persistent storage path.
    pub fn set_dataset_token_path(&mut self, path: Option<std::path::PathBuf>) {
        if let Ok(mut guard) = self.dataset_token_path.lock() {
            *guard = path;
        }
    }

    async fn read_dataset_token_store_from_disk(&self) -> Result<DatasetTokenStore, AuthError> {
        let path = self
            .dataset_token_path
            .lock()
            .ok()
            .and_then(|guard| guard.clone());

        let Some(path) = path else {
            return Ok(DatasetTokenStore::default());
        };

        match tokio::fs::read_to_string(&path).await {
            Ok(s) => {
                if let Ok(store) = serde_json::from_str::<DatasetTokenStore>(&s) {
                    return Ok(store);
                }

                if let Ok(single) = serde_json::from_str::<DatasetToken>(&s) {
                    let mut store = DatasetTokenStore::default();
                    if let Some(dataset_id) = single.dataset_id.clone() {
                        store.tokens.insert(dataset_id, single);
                    }
                    return Ok(store);
                }

                Ok(DatasetTokenStore::default())
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    Ok(DatasetTokenStore::default())
                } else {
                    Err(AuthError::Other(e.to_string()))
                }
            }
        }
    }

    async fn persist_dataset_token_store(
        &self,
        store: &DatasetTokenStore,
    ) -> Result<(), AuthError> {
        let path = self
            .dataset_token_path
            .lock()
            .ok()
            .and_then(|guard| guard.clone());

        let Some(path) = path else {
            return Ok(());
        };

        let s = serde_json::to_string(store)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AuthError::Other(e.to_string()))?;
        }
        tokio::fs::write(&path, &s)
            .await
            .map_err(|e| AuthError::Other(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    /// Create an AuthManager by reading `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` from env.
    pub fn from_env(storage: Arc<S>) -> Result<Self, AuthError> {
        // Prefer compile-time optional embedded values (via `option_env!`).
        // If not present at compile time, fall back to runtime lookup.
        let supabase_url = if let Some(v) = SUPABASE_URL_EMBED {
            v.to_string()
        } else {
            std::env::var("PUBLIC_SUPABASE_URL")
                .map_err(|_| AuthError::Other("PUBLIC_SUPABASE_URL not set".to_string()))?
        };

        let api_key = if let Some(v) = SUPABASE_PUBLISHABLE_KEY_EMBED {
            v.to_string()
        } else {
            std::env::var("PUBLIC_SUPABASE_PUBLISHABLE_KEY").map_err(|_| {
                AuthError::Other("PUBLIC_SUPABASE_PUBLISHABLE_KEY not set".to_string())
            })?
        };

        let config = AuthConfig {
            supabase_url,
            api_key,
            refresh_path: "/auth/v1/token".to_string(),
            refresh_margin_secs: 30,
        };

        Ok(Self::new(config, storage))
    }

    /// Return a valid access token, refreshing if needed.
    pub async fn get_access_token(&self) -> Result<String, AuthError> {
        // load session
        let s = self.storage.load_session().await?;
        let session = match s {
            Some(s) => s,
            None => return Err(AuthError::NoSession),
        };

        // if expires_at is present and token is still valid -> return
        if let Some(exp) = session.expires_at {
            let now = Utc::now();
            let seconds_until_expiry = (exp - now).num_seconds();
            tracing::debug!("get_access_token: checking token validity, expires_at={}, now={}, seconds_until_expiry={}, refresh_margin={}", 
                exp, now, seconds_until_expiry, self.config.refresh_margin_secs);
            if now + Duration::seconds(self.config.refresh_margin_secs) < exp {
                tracing::debug!(
                    "get_access_token: using cached token (valid for {} more seconds)",
                    seconds_until_expiry
                );
                return Ok(session.access_token);
            } else {
                tracing::debug!(
                    "get_access_token: token expiring soon (within {} seconds), will refresh",
                    self.config.refresh_margin_secs
                );
            }
        } else {
            tracing::debug!("get_access_token: no expires_at in session, will refresh");
        }

        // otherwise refresh
        let _guard = self.refresh_lock.lock().await;
        // double-check after acquiring lock
        let s2 = self.storage.load_session().await?;
        let session2 = match s2 {
            Some(s) => s,
            None => return Err(AuthError::NoSession),
        };

        // if another task refreshed while we were waiting
        if let Some(exp) = session2.expires_at {
            let now = Utc::now();
            let seconds_until_expiry = (exp - now).num_seconds();
            if now + Duration::seconds(self.config.refresh_margin_secs) < exp {
                tracing::debug!("get_access_token: another task refreshed while waiting, using that token (valid for {} seconds)", seconds_until_expiry);
                return Ok(session2.access_token);
            }
        }

        tracing::debug!("get_access_token: calling force_refresh");
        let refreshed = self.force_refresh(&session2).await?;
        tracing::info!("get_access_token: refresh completed");
        Ok(refreshed.access_token)
    }

    pub async fn is_authenticated(&self) -> bool {
        self.get_access_token().await.is_ok()
    }

    pub async fn save_session(&self, session: &Session) -> Result<(), AuthError> {
        self.storage.save_session(session).await
    }

    /// Load the stored session without mutating it (for health checks/diagnostics).
    pub async fn peek_session(&self) -> Result<Option<Session>, AuthError> {
        self.storage.load_session().await
    }

    pub async fn clear(&self) -> Result<(), AuthError> {
        self.storage.clear().await
    }

    /// Force refresh using the stored refresh_token. Returns saved session on success.
    pub async fn force_refresh(&self, current: &Session) -> Result<Session, AuthError> {
        tracing::info!("supabase refresh started");
        if current.refresh_token.trim().is_empty() {
            return Err(AuthError::RefreshFailed("empty refresh token".to_string()));
        }

        // Supabase refresh endpoint requires the grant_type in the query string.
        // See: POST /auth/v1/token?grant_type=refresh_token
        let url = format!(
            "{}{}?grant_type=refresh_token",
            self.config.supabase_url, self.config.refresh_path
        );

        // Send refresh_token as JSON body; some GoTrue deployments expect JSON.
        let body = serde_json::json!({
            "refresh_token": current.refresh_token
        });

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.api_key)
            .header("Authorization", format!("Bearer {}", &self.config.api_key))
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let masked_body = masked_error_payload(&text);
            tracing::warn!(status = %status, body = %masked_body, "supabase refresh request failed");

            // If the refresh token is invalid/expired/already used, clear and signal re-auth.
            if status == reqwest::StatusCode::BAD_REQUEST
                || status == reqwest::StatusCode::UNAUTHORIZED
            {
                tracing::warn!(
                    "refresh token invalid/expired; clearing session and requesting re-login"
                );
                let _ = self.storage.clear().await;
                return Err(AuthError::RequireReauth(
                    "refresh token invalid or already used; please sign in again".to_string(),
                ));
            }

            return Err(AuthError::RefreshFailed(format!("status {}", status)));
        }

        let body: serde_json::Value = resp.json().await?;

        // extract tokens and expiry
        let access_token = body["access_token"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let refresh_token = body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Supabase should always return a new refresh token on refresh. If missing, stop to avoid
        // reusing the old one (which may already be invalid) and force re-auth.
        let refresh_token = match refresh_token {
            Some(t) if !t.trim().is_empty() => t,
            _ => {
                tracing::warn!("refresh response missing refresh_token; clearing session and requiring re-login");
                let _ = self.storage.clear().await;
                return Err(AuthError::RequireReauth(
                    "refresh_token missing in response; please sign in again".to_string(),
                ));
            }
        };

        let expires_in = body.get("expires_in").and_then(|v| v.as_i64());

        // If expires_in is missing, fall back to a conservative default to avoid hammering refresh.
        let expires_at: Option<DateTime<Utc>> = Some(
            Utc::now() + Duration::seconds(expires_in.unwrap_or(DEFAULT_ACCESS_TOKEN_TTL_SECS)),
        );

        let session = Session {
            access_token: access_token.clone(),
            refresh_token: refresh_token.clone(),
            expires_at,
            token_type: body["token_type"].as_str().map(|s| s.to_string()),
        };

        // persist
        self.storage.save_session(&session).await?;
        tracing::info!("supabase session refreshed successfully");

        Ok(session)
    }

    /// Attach bearer to the request builder after ensuring a valid token.
    pub async fn attach_bearer(
        &self,
        mut req: reqwest::RequestBuilder,
    ) -> Result<reqwest::RequestBuilder, AuthError> {
        let token = self.get_access_token().await?;
        req = req.bearer_auth(token);
        Ok(req)
    }

    /// Perform request with automatic refresh-on-401 and one retry.
    ///
    /// `make_request` is a closure that receives a `&reqwest::Client` and returns a `RequestBuilder`.
    /// This allows the function to rebuild the request for a retry after refresh.
    pub async fn request_with_refresh<F>(
        &self,
        make_request: F,
    ) -> Result<reqwest::Response, AuthError>
    where
        F: Fn(&Client) -> reqwest::RequestBuilder,
    {
        // build initial request
        let builder = make_request(&self.client);
        let req = self.attach_bearer(builder).await?;
        let resp = req.send().await?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            // attempt refresh once
            let _guard = self.refresh_lock.lock().await;
            // force refresh using stored session
            let s = self.storage.load_session().await?;
            let session = s.ok_or(AuthError::NoSession)?;
            let _ = self.force_refresh(&session).await?;
            // retry request by rebuilding it
            let builder2 = make_request(&self.client);
            let req2 = self.attach_bearer(builder2).await?;
            let resp2 = req2.send().await?;
            return Ok(resp2);
        }
        Ok(resp)
    }

    /// Fetch a provider's refresh token from Supabase provider_tokens table.
    /// Uses RLS (Row Level Security) via Authorization header for user identification.
    pub async fn fetch_provider_token(
        &self,
        provider_name: &str,
    ) -> Result<Option<String>, AuthError> {
        let access_token = self.get_access_token().await?;

        let url = format!("{}/rest/v1/provider_tokens", self.config.supabase_url);

        #[derive(Deserialize)]
        struct ProviderTokenRow {
            refresh_token: Option<String>,
        }

        let response = self
            .client
            .get(&url)
            .header("apikey", &self.config.api_key)
            .header("Authorization", format!("Bearer {}", access_token))
            .query(&[
                // PostgREST requires the "eq." operator for filtering
                ("provider_name", format!("eq.{}", provider_name)),
                ("select", "refresh_token".to_string()),
                ("limit", "1".to_string()),
            ])
            .send()
            .await
            .map_err(|e| AuthError::Other(format!("Failed to query provider tokens: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AuthError::Other(format!(
                "Supabase query failed {}: {}",
                status, body
            )));
        }

        let rows: Vec<ProviderTokenRow> = response
            .json()
            .await
            .map_err(|e| AuthError::Other(format!("Failed to parse provider tokens: {}", e)))?;

        if let Some(row) = rows.into_iter().find_map(|r| r.refresh_token) {
            if row.trim().is_empty() {
                tracing::debug!("{} refresh token empty", provider_name);
                return Ok(None);
            }
            tracing::debug!("Successfully fetched {} refresh token", provider_name);
            return Ok(Some(row));
        }

        tracing::debug!("No {} tokens found for user", provider_name);
        Ok(None)
    }
}

// MultiSession管理のための拡張メソッド
impl<S: Storage> AuthManager<S> {
    /// dataset_tokenを dataset_id 単位で保存する。
    pub async fn save_dataset_token(&self, token: &DatasetToken) -> Result<(), AuthError> {
        let Some(dataset_id) = token.dataset_id.clone() else {
            tracing::warn!("Skipping dataset_token persistence because dataset_id is missing");
            return Ok(());
        };

        let mut cache = self.dataset_token_cache.lock().await;
        cache.tokens.insert(dataset_id, token.clone());

        if let Err(e) = self.persist_dataset_token_store(&cache).await {
            tracing::warn!("Failed to persist dataset_token store: {}", e);
        }

        Ok(())
    }

    /// dataset_token ストアを全削除する。
    ///
    /// member_id 切替時など、旧 dataset_id のトークンを再利用したくない場面で使う。
    pub async fn clear_dataset_tokens(&self) -> Result<(), AuthError> {
        let mut cache = self.dataset_token_cache.lock().await;
        cache.tokens.clear();

        if let Err(e) = self.persist_dataset_token_store(&cache).await {
            tracing::warn!("Failed to persist cleared dataset_token store: {}", e);
        }

        Ok(())
    }

    /// 指定 dataset_id に紐づく dataset_token を読み込む。
    pub async fn load_dataset_token_for_dataset(
        &self,
        dataset_id: &str,
    ) -> Result<Option<DatasetToken>, AuthError> {
        {
            let cache = self.dataset_token_cache.lock().await;
            if let Some(token) = cache.tokens.get(dataset_id) {
                return Ok(Some(token.clone()));
            }
        }

        let store = self.read_dataset_token_store_from_disk().await?;
        if let Some(token) = store.tokens.get(dataset_id).cloned() {
            let mut cache = self.dataset_token_cache.lock().await;
            *cache = store;
            return Ok(Some(token));
        }

        let mut cache = self.dataset_token_cache.lock().await;
        *cache = store;
        Ok(None)
    }

    /// Resolve the dataset_id to use for uploads.
    ///
    /// Priority:
    /// 1. `preferred_dataset_id` when explicitly provided (used by retry paths to keep original ownership).
    /// 2. The non-expired dataset_id with the latest expiry in cache/disk store.
    pub async fn resolve_dataset_id_for_upload(
        &self,
        preferred_dataset_id: Option<&str>,
    ) -> Option<String> {
        if let Some(preferred) = preferred_dataset_id
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            return Some(preferred.to_string());
        }

        let now = Utc::now();

        {
            let cache = self.dataset_token_cache.lock().await;
            let mut best: Option<(String, DateTime<Utc>)> = None;
            for (dataset_id, token) in cache.tokens.iter() {
                if dataset_id.trim().is_empty() || token.expires_at <= now {
                    continue;
                }
                let replace = match &best {
                    Some((_, exp)) => token.expires_at > *exp,
                    None => true,
                };
                if replace {
                    best = Some((dataset_id.clone(), token.expires_at));
                }
            }
            if let Some((dataset_id, _)) = best {
                return Some(dataset_id);
            }
        }

        if let Ok(store) = self.read_dataset_token_store_from_disk().await {
            let mut best: Option<(String, DateTime<Utc>)> = None;
            for (dataset_id, token) in store.tokens.iter() {
                if dataset_id.trim().is_empty() || token.expires_at <= now {
                    continue;
                }
                let replace = match &best {
                    Some((_, exp)) => token.expires_at > *exp,
                    None => true,
                };
                if replace {
                    best = Some((dataset_id.clone(), token.expires_at));
                }
            }

            if let Some((dataset_id, _)) = best {
                let mut cache = self.dataset_token_cache.lock().await;
                *cache = store;
                return Some(dataset_id);
            }
        }

        None
    }
}

// ============================================================
// v2 anonymous-sync (pepper + Ed25519 device key)
// ============================================================
//
// 旧 /anonymous-sync (v1) は salt をクライアントに埋め込んで member_id_hash を
// 計算する設計だったが、salt 流出で任意の api_member_id から dataset_token を
// 取得できる弱点があった。v2 では以下のように責務を再配置する:
//   - サーバーは pepper (Wrangler secret) を保持し pid = HMAC(pepper, api_member_id) を
//     内部で計算する。クライアントは生 api_member_id だけを TLS で送る。
//   - クライアントは Ed25519 keypair を端末で生成・保管し、その公開鍵を register で
//     登録する。以降の refresh/revoke は challenge nonce への署名で本人性を担保する。
//
// 現在は v2 固定運用。クライアント側は `ensure_dataset_token_v2` を利用する。

use crate::device_key::DeviceKey;

/// /v2/register のレスポンス
#[derive(Debug, Deserialize)]
struct RegisterV2Response {
    device_id: String,
    pid: String,
    dataset_token: String,
}

/// /v2/challenge のレスポンス
#[derive(Debug, Deserialize)]
struct ChallengeV2Response {
    nonce: String,
    #[serde(default)]
    #[allow(dead_code)]
    expires_at: Option<i64>,
}

/// /v2/refresh のレスポンス
#[derive(Debug, Deserialize)]
struct RefreshV2Response {
    dataset_token: String,
    pid: String,
    /// 現行 pepper のバージョンタグ ("v1", "v2" ...)。
    /// 直前の refresh と比較してローテーション検知に使う想定だが、
    /// クライアントは旧値を保持していないので情報用ログ出力のみ。
    #[serde(default)]
    #[allow(dead_code)]
    salt_version: Option<String>,
}

impl<S: Storage> AuthManager<S> {
    /// /v2/register を呼んで device_id を取得し、dataset_token を返す。
    /// 成功時は device_key.set_device_id() で確定値を書き戻す。
    ///
    /// 失敗時は device_key 側に値を書き込まないので、再試行できる。
    pub async fn register_device_v2(
        &self,
        api_member_id: &str,
        device_key: &mut DeviceKey,
    ) -> Result<DatasetToken, AuthError> {
        let api_member_id = api_member_id.trim();
        validate_api_member_id(api_member_id)?;

        // attestation = Ed25519(secret, "register|" + api_member_id)
        // サーバーは受け取った device_pub で同じメッセージを検証し、
        // 公開鍵が秘密鍵と整合していることを確認する。
        let attestation_message = format!("register|{}", api_member_id);
        let attestation_b64 = device_key.sign_b64(attestation_message.as_bytes());

        let url = configs::get_user_configs_for_app()
            .auth
            .get_anonymous_sync_v2_register_endpoint()
            .ok_or_else(|| {
                AuthError::Other("anonymous_sync_v2_register_endpoint not configured".to_string())
            })?;

        let body = serde_json::json!({
            "api_member_id": api_member_id,
            "device_pub": device_key.public_key_b64(),
            "attestation": attestation_b64,
        });

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.api_key)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            tracing::warn!(
                status = %status,
                body = %masked_error_payload(&text),
                "anonymous-sync v2 register failed"
            );
            return Err(AuthError::RefreshFailed(format!(
                "anonymous-sync v2 register failed: status {}",
                status
            )));
        }

        let parsed: RegisterV2Response = resp.json().await?;

        // device_id を端末に確定書き込み。これ以降の refresh はこの値を使う。
        device_key.set_device_id(parsed.device_id.clone()).await?;

        tracing::info!(
            device_id = %parsed.device_id,
            "anonymous-sync v2 register completed"
        );

        Ok(DatasetToken {
            token: parsed.dataset_token,
            // サーバー側 TTL (7 日) に合わせる。サーバーが返す exp と乖離しても
            // クライアント側は 1 日前に refresh するので大きな問題にはならない。
            expires_at: Utc::now() + Duration::days(7),
            dataset_id: Some(parsed.pid),
        })
    }

    /// /v2/challenge を呼んで nonce を取得する。
    /// nonce はサーバー側 HMAC で 5 分単位のバケットに紐づき、refresh / revoke の
    /// メッセージ署名にそのまま使う。
    async fn fetch_challenge_v2(&self, device_id: &str) -> Result<ChallengeV2Response, AuthError> {
        let base = configs::get_user_configs_for_app()
            .auth
            .get_anonymous_sync_v2_challenge_endpoint()
            .ok_or_else(|| {
                AuthError::Other("anonymous_sync_v2_challenge_endpoint not configured".to_string())
            })?;

        let resp = self
            .client
            .get(&base)
            .query(&[("device_id", device_id)])
            .header("apikey", &self.config.api_key)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            tracing::warn!(
                status = %status,
                body = %masked_error_payload(&text),
                "anonymous-sync v2 challenge failed"
            );
            return Err(AuthError::RefreshFailed(format!(
                "anonymous-sync v2 challenge failed: status {}",
                status
            )));
        }

        let parsed: ChallengeV2Response = resp.json().await?;
        Ok(parsed)
    }

    /// /v2/refresh を呼んで dataset_token を再発行する。
    /// device_key.device_id() が確定済みであることが前提。未登録なら
    /// 呼び出し元で先に register_device_v2 を呼ぶ。
    pub async fn refresh_dataset_token_v2(
        &self,
        api_member_id: &str,
        device_key: &DeviceKey,
    ) -> Result<DatasetToken, AuthError> {
        let api_member_id = api_member_id.trim();
        validate_api_member_id(api_member_id)?;

        let device_id = device_key.device_id().ok_or_else(|| {
            AuthError::Other(
                "refresh_dataset_token_v2 called before device is registered".to_string(),
            )
        })?;

        let challenge = self.fetch_challenge_v2(device_id).await?;
        // refresh メッセージ = nonce そのもの。サーバーは保存済み公開鍵で署名を検証する。
        let sig_b64 = device_key.sign_b64(challenge.nonce.as_bytes());

        let url = configs::get_user_configs_for_app()
            .auth
            .get_anonymous_sync_v2_refresh_endpoint()
            .ok_or_else(|| {
                AuthError::Other("anonymous_sync_v2_refresh_endpoint not configured".to_string())
            })?;

        let body = serde_json::json!({
            "device_id": device_id,
            "api_member_id": api_member_id,
            "nonce": challenge.nonce,
            "sig": sig_b64,
        });

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.api_key)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            tracing::warn!(
                status = %status,
                body = %masked_error_payload(&text),
                "anonymous-sync v2 refresh failed"
            );
            return Err(AuthError::RefreshFailed(format!(
                "anonymous-sync v2 refresh failed: status {}",
                status
            )));
        }

        let parsed: RefreshV2Response = resp.json().await?;

        if let Some(version) = parsed.salt_version.as_deref() {
            tracing::debug!(
                device_id = %device_id,
                salt_version = %version,
                "anonymous-sync v2 refresh: dataset_token issued"
            );
        }

        Ok(DatasetToken {
            token: parsed.dataset_token,
            expires_at: Utc::now() + Duration::days(7),
            dataset_id: Some(parsed.pid),
        })
    }

    /// 別の自端末から target_device_id を失効させる。
    /// 端末紛失時の自己復旧用エンドポイント。サーバーは「同じ canonical_user_id 配下に
    /// 属する別の有効な device からの操作」だけを受理する。
    pub async fn revoke_device_v2(
        &self,
        target_device_id: &str,
        device_key: &DeviceKey,
        reason: Option<&str>,
    ) -> Result<(), AuthError> {
        let device_id = device_key.device_id().ok_or_else(|| {
            AuthError::Other("revoke_device_v2 called before device is registered".to_string())
        })?;
        if target_device_id.trim().is_empty() {
            return Err(AuthError::Other(
                "revoke_device_v2: target_device_id must be non-empty".to_string(),
            ));
        }

        let challenge = self.fetch_challenge_v2(device_id).await?;
        // revoke メッセージ = "revoke|" + from_device_id + "|" + target_device_id + "|" + nonce
        let message = format!(
            "revoke|{}|{}|{}",
            device_id, target_device_id, challenge.nonce
        );
        let sig_b64 = device_key.sign_b64(message.as_bytes());

        let url = configs::get_user_configs_for_app()
            .auth
            .get_anonymous_sync_v2_revoke_endpoint()
            .ok_or_else(|| {
                AuthError::Other("anonymous_sync_v2_revoke_endpoint not configured".to_string())
            })?;

        let body = serde_json::json!({
            "device_id": device_id,
            "target_device_id": target_device_id,
            "nonce": challenge.nonce,
            "sig": sig_b64,
            "reason": reason,
        });

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.api_key)
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            tracing::warn!(
                status = %status,
                body = %masked_error_payload(&text),
                "anonymous-sync v2 revoke failed"
            );
            return Err(AuthError::RefreshFailed(format!(
                "anonymous-sync v2 revoke failed: status {}",
                status
            )));
        }

        Ok(())
    }

    /// v2 のメイン入口。
    /// - device_key.device_id() が未確定なら register、確定済みなら challenge + refresh。
    /// - 既存 dataset_token が有効期限 1 日以上残っていればそのまま返す (v1 と同方針)。
    pub async fn ensure_dataset_token_v2(
        &self,
        api_member_id: &str,
        device_key: &mut DeviceKey,
        current_token: Option<&DatasetToken>,
    ) -> Result<DatasetToken, AuthError> {
        let api_member_id = api_member_id.trim();
        validate_api_member_id(api_member_id)?;

        let needs_refresh = match current_token {
            Some(token) => token.expires_at <= Utc::now() + Duration::days(1),
            None => true,
        };
        if !needs_refresh {
            return Ok(current_token
                .expect("current_token is Some when needs_refresh is false")
                .clone());
        }

        if device_key.device_id().is_none() {
            tracing::info!("anonymous-sync v2: device not registered, calling /v2/register");
            self.register_device_v2(api_member_id, device_key).await
        } else {
            tracing::info!("anonymous-sync v2: device already registered, calling /v2/refresh");
            self.refresh_dataset_token_v2(api_member_id, device_key)
                .await
        }
    }
}

/// api_member_id を厳格検証する。KC は 10 桁前後の整数を返すため、
/// サーバー側バリデーション (`/^[0-9]{1,16}$/`) と同じ条件をクライアントでも適用する。
fn validate_api_member_id(value: &str) -> Result<(), AuthError> {
    if value.is_empty() {
        return Err(AuthError::Other(
            "api_member_id must be non-empty".to_string(),
        ));
    }
    if value.len() > 16 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AuthError::Other(
            "api_member_id must be 1..=16 ASCII digits".to_string(),
        ));
    }
    Ok(())
}
