use crate::error::AuthError;
use crate::storage::Storage;
use tracing;
use crate::types::Session;
use chrono::{DateTime, Duration, Utc};
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::Mutex;

const SUPABASE_URL_EMBED: Option<&str> = option_env!("SUPABASE_URL");
const SUPABASE_ANON_KEY_EMBED: Option<&str> = option_env!("SUPABASE_ANON_KEY");
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
}

impl<S: Storage> Clone for AuthManager<S> {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            storage: self.storage.clone(),
            client: self.client.clone(),
            refresh_lock: self.refresh_lock.clone(),
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
        }
    }

    /// Create an AuthManager by reading `SUPABASE_URL` and `SUPABASE_ANON_KEY` from env.
    pub fn from_env(storage: Arc<S>) -> Result<Self, AuthError> {
        // Prefer compile-time optional embedded values (via `option_env!`).
        // If not present at compile time, fall back to runtime lookup.
        let supabase_url = if let Some(v) = SUPABASE_URL_EMBED {
            v.to_string()
        } else {
            std::env::var("SUPABASE_URL")
                .map_err(|_| AuthError::Other("SUPABASE_URL not set".to_string()))?
        };

        let api_key = if let Some(v) = SUPABASE_ANON_KEY_EMBED {
            v.to_string()
        } else {
            std::env::var("SUPABASE_ANON_KEY")
                .map_err(|_| AuthError::Other("SUPABASE_ANON_KEY not set".to_string()))?
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
            if now + Duration::seconds(self.config.refresh_margin_secs) < exp {
                return Ok(session.access_token);
            }
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
            if now + Duration::seconds(self.config.refresh_margin_secs) < exp {
                return Ok(session2.access_token);
            }
        }

        let refreshed = self.force_refresh(&session2).await?;
        Ok(refreshed.access_token)
    }

    pub async fn is_authenticated(&self) -> bool {
        match self.storage.load_session().await {
            Ok(Some(session)) => !session.refresh_token.is_empty(),
            _ => false,
        }
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
            tracing::warn!(status = %status, url = %url, body = %text, "supabase refresh request failed");

            // If the refresh token is invalid/expired/already used, clear and signal re-auth.
            if status == reqwest::StatusCode::BAD_REQUEST || status == reqwest::StatusCode::UNAUTHORIZED {
                tracing::warn!("refresh token invalid/expired; clearing session and requesting re-login");
                let _ = self.storage.clear().await;
                return Err(AuthError::RequireReauth("refresh token invalid or already used; please sign in again".to_string()));
            }

            return Err(AuthError::RefreshFailed(format!("status {}: {}", status, text)));
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
                expires_in.unwrap_or(DEFAULT_ACCESS_TOKEN_TTL_SECS).max(60), // at least 60s
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
}
