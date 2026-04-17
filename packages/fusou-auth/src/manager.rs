use crate::error::AuthError;
use crate::storage::Storage;
use tracing;
use crate::types::{DatasetToken, DatasetTokenStore, Session};
use chrono::{DateTime, Duration, Utc};
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::Deserialize;

const SUPABASE_URL_EMBED: Option<&str> = option_env!("PUBLIC_SUPABASE_URL");
const SUPABASE_PUBLISHABLE_KEY_EMBED: Option<&str> = option_env!("PUBLIC_SUPABASE_PUBLISHABLE_KEY");
// Fallback TTL when Supabase response omits expires_in (seconds)
const DEFAULT_ACCESS_TOKEN_TTL_SECS: i64 = 55 * 60; // 55 minutes to refresh before typical 60m expiry

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

    async fn persist_dataset_token_store(&self, store: &DatasetTokenStore) -> Result<(), AuthError> {
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
            std::env::var("PUBLIC_SUPABASE_PUBLISHABLE_KEY")
                .map_err(|_| AuthError::Other("PUBLIC_SUPABASE_PUBLISHABLE_KEY not set".to_string()))?
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
            tracing::info!("get_access_token: checking token validity, expires_at={}, now={}, seconds_until_expiry={}, refresh_margin={}", 
                exp, now, seconds_until_expiry, self.config.refresh_margin_secs);
            if now + Duration::seconds(self.config.refresh_margin_secs) < exp {
                tracing::info!("get_access_token: using cached token (valid for {} more seconds)", seconds_until_expiry);
                return Ok(session.access_token);
            } else {
                tracing::info!("get_access_token: token expiring soon (within {} seconds), will refresh", self.config.refresh_margin_secs);
            }
        } else {
            tracing::warn!("get_access_token: no expires_at in session, will refresh");
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
                tracing::info!("get_access_token: another task refreshed while waiting, using that token (valid for {} seconds)", seconds_until_expiry);
                return Ok(session2.access_token);
            }
        }

        tracing::info!("get_access_token: calling force_refresh");
        let refreshed = self.force_refresh(&session2).await?;
        let token_preview = if refreshed.access_token.len() > 20 {
            format!("{}...{}", &refreshed.access_token[..10], &refreshed.access_token[refreshed.access_token.len()-10..])
        } else {
            "<short-token>".to_string()
        };
        tracing::info!("get_access_token: refresh completed, new token preview: {}", token_preview);
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
            let text_preview = if text.len() > 200 { format!("{}...", &text[..200]) } else { text.clone() };
            tracing::warn!(status = %status, url = %url, body = %text_preview, "supabase refresh request failed");

            // If the refresh token is invalid/expired/already used, clear and signal re-auth.
            if status == reqwest::StatusCode::BAD_REQUEST || status == reqwest::StatusCode::UNAUTHORIZED {
                tracing::warn!("refresh token invalid/expired; clearing session and requesting re-login");
                let _ = self.storage.clear().await;
                return Err(AuthError::RequireReauth("refresh token invalid or already used; please sign in again".to_string()));
            }

            return Err(AuthError::RefreshFailed(format!("status {}: {}", status, text_preview)));
        }

        let body: serde_json::Value = resp.json().await?;

        // extract tokens and expiry
        let access_token = body["access_token"].as_str().unwrap_or_default().to_string();
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
        let expires_at: Option<DateTime<Utc>> = Some(Utc::now()
            + Duration::seconds(
                expires_in.unwrap_or(DEFAULT_ACCESS_TOKEN_TTL_SECS),
            ));

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
    pub async fn attach_bearer(&self, mut req: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder, AuthError> {
        let token = self.get_access_token().await?;
        req = req.bearer_auth(token);
        Ok(req)
    }

    /// Perform request with automatic refresh-on-401 and one retry.
    ///
    /// `make_request` is a closure that receives a `&reqwest::Client` and returns a `RequestBuilder`.
    /// This allows the function to rebuild the request for a retry after refresh.
    pub async fn request_with_refresh<F>(&self, make_request: F) -> Result<reqwest::Response, AuthError>
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
    /// 匿名認証セッションとdataset_tokenを取得・更新する
    /// member_id_hash: ユーザー識別用のハッシュ（Set::Basicで取得）
    ///
    /// Multi-device注意：既存のセッションがある場合は、新しい anonymous user_id を生成するのではなく
    /// 既存セッションを再利用します。これにより、複数端末で同じ user_id が維持され、
    /// dataset_token の帰属（user_id）が一貫性を保ちます。
    pub async fn get_or_refresh_anonymous_session(
        &self,
        member_id_hash: &str,
    ) -> Result<(Option<Session>, String), AuthError> {
        // Load existing dataset_token if available (multi-device consistency check)
        let existing_store = self.read_dataset_token_store_from_disk().await.ok();
        let has_existing_mapping = existing_store
            .as_ref()
            .map(|store| !store.tokens.is_empty())
            .unwrap_or(false);

        // configs.toml から anonymous_sync_endpoint を取得
        let url = configs::get_user_configs_for_app()
            .auth
            .get_anonymous_sync_endpoint()
            .ok_or_else(|| AuthError::Other("anonymous_sync_endpoint not configured".to_string()))?;
        
        let body = serde_json::json!({
            "member_id_hash": member_id_hash
        });

        let resp = self
            .client
            .post(&url)
            .header("apikey", &self.config.api_key);

        let resp = match self.get_access_token().await {
            Ok(access_token) => {
                resp
                    .bearer_auth(access_token)
                    .json(&body)
                    .send()
                    .await?
            }
            Err(_) => {
                // If no existing session but we have a previous mapping on disk, use that
                // to retrieve dataset_token without generating a new anonymous user_id
                if has_existing_mapping {
                    tracing::info!("no local access token, but existing mapping found on disk for this device (multi-device scenario)");
                }
                resp
                    .json(&body)
                    .send()
                    .await?
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let text_preview = if text.len() > 200 { format!("{}...", &text[..200]) } else { text.clone() };
            tracing::warn!(
                status = %status,
                url = %url,
                body = %text_preview,
                "anonymous-sync request failed"
            );
            return Err(AuthError::RefreshFailed(format!(
                "anonymous-sync failed: status {}: {}",
                status, text_preview
            )));
        }

        #[derive(Deserialize)]
        struct AnonymousSyncResponse {
            access_token: Option<String>,
            refresh_token: Option<String>,
            dataset_token: String,
        }

        let response_data: AnonymousSyncResponse = resp.json().await?;

        // セッションの決定
        let session = if let (Some(at), Some(rt)) = (response_data.access_token.clone(), response_data.refresh_token.clone()) {
            // 新しい匿名セッションが取得できた場合
            let expires_at = Utc::now() + Duration::seconds(DEFAULT_ACCESS_TOKEN_TTL_SECS);
            Some(Session {
                access_token: at,
                refresh_token: rt,
                expires_at: Some(expires_at),
                token_type: Some("bearer".to_string()),
            })
        } else {
            // Fallback: 既存セッションを再利用（既存デバイスで dataset_token のみ更新した場合など）
            match self.storage.load_session().await? {
                Some(current) => Some(current),
                None => {
                    tracing::info!(
                        "anonymous-sync returned dataset_token without session tokens and no local session exists"
                    );
                    None
                }
            }
        };

        Ok((session, response_data.dataset_token))
    }

    /// dataset_tokenの有効期限をチェックし、必要なら更新
    /// 有効期限が1日以内の場合、自動更新する
    ///
    /// 新しいセッションが返された場合は自動的にストレージに保存する。
    pub async fn ensure_dataset_token_valid(
        &self,
        member_id_hash: &str,
        current_token: Option<&crate::types::DatasetToken>,
    ) -> Result<crate::types::DatasetToken, AuthError> {
        // 現在のトークンが有効かチェック（期限1日前を基準）
        let needs_refresh = if let Some(token) = current_token {
            let one_day = Duration::days(1);
            token.expires_at <= Utc::now() + one_day
        } else {
            true
        };

        if needs_refresh {
            let (session_opt, dataset_token_str) = self.get_or_refresh_anonymous_session(member_id_hash).await?;

            // 新しいセッションが返された場合はストレージに保存（マルチデバイスで
            // セッションが無い端末でもアップロード時にセッションを自動取得できるようにする）
            if let Some(session) = session_opt {
                if let Err(e) = self.storage.save_session(&session).await {
                    tracing::warn!("ensure_dataset_token_valid: failed to save session: {}", e);
                }
            }
            
            // 7日後に有効期限切れ
            let expires_at = Utc::now() + Duration::days(7);
            
            Ok(crate::types::DatasetToken {
                token: dataset_token_str,
                expires_at,
                dataset_id: Some(member_id_hash.to_string()),
            })
        } else {
            // 既存のトークンを返す
            Ok(current_token.unwrap().clone())
        }
    }

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
