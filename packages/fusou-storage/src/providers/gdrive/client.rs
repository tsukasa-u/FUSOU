// Google Drive authentication and client management
// DEPRECATED: Google Drive support is deprecated since 0.4.0. Use anonymous authentication instead.

use crate::runtime_hooks;
use google_drive3::{
    hyper_rustls, hyper_util, yup_oauth2, yup_oauth2::authenticator::Authenticator, DriveHub,
};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;
use tokio::sync::OnceCell;

pub type DriveClient =
    DriveHub<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>;

#[deprecated(
    since = "0.4.0",
    note = "Google Drive support is deprecated. Use anonymous authentication instead."
)]
#[derive(Debug, Clone)]
pub struct UserAccessTokenInfo {
    pub refresh_token: String,
    pub token_type: Option<String>,
}

const SCOPES: &[&str; 1] = &["https://www.googleapis.com/auth/drive.file"];

// Support multiple cloud providers with HashMap
#[deprecated(
    since = "0.4.0",
    note = "Google Drive support is deprecated. Use anonymous authentication instead."
)]
pub static CLOUD_PROVIDER_TOKENS: Lazy<Mutex<HashMap<String, UserAccessTokenInfo>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub static USER_GOOGLE_AUTH: OnceCell<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> = OnceCell::const_new();

static CRYPTO_PROVIDER_LOCK: OnceLock<()> = OnceLock::new();

fn setup_default_crypto_provider() {
    CRYPTO_PROVIDER_LOCK.get_or_init(|| {
        // Another crate in the same process may initialize rustls first.
        // Treat that case as success to keep initialization order-independent.
        if let Err(err) = rustls::crypto::ring::default_provider().install_default() {
            tracing::debug!(error = ?err, "rustls crypto provider already initialized");
        }
    });
}

/// Set refresh token for a specific provider (google, dropbox, icloud, etc.)
#[deprecated(
    since = "0.4.0",
    note = "Google Drive support is deprecated. Use anonymous authentication instead."
)]
pub fn set_refresh_token(refresh_token: String, provider_name: String) -> Result<(), ()> {
    if refresh_token.is_empty() || provider_name.is_empty() {
        return Err(());
    }

    tracing::info!("Setting refresh token for provider: {}", provider_name);

    let mut tokens = match CLOUD_PROVIDER_TOKENS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::warn!("CLOUD_PROVIDER_TOKENS mutex poisoned, recovering");
            poisoned.into_inner()
        }
    };

    let info = UserAccessTokenInfo {
        refresh_token: refresh_token.clone(),
        token_type: Some("bearer".to_owned()),
    };

    tokens.insert(provider_name.clone(), info);

    // Only initialize Google Drive client if provider is google
    if provider_name.to_lowercase() == "google" {
        tokio::task::spawn(async move {
            setup_default_crypto_provider();
            let hub = create_client().await;
            if hub.is_none() {
                let _ = runtime_hooks::launch_auth_page();
            }
        });
    }

    Ok(())
}

/// Get refresh token for a specific provider
#[deprecated(
    since = "0.4.0",
    note = "Google Drive support is deprecated. Use anonymous authentication instead."
)]
pub fn get_refresh_token(provider_name: &str) -> Option<UserAccessTokenInfo> {
    let tokens = match CLOUD_PROVIDER_TOKENS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::warn!("CLOUD_PROVIDER_TOKENS mutex poisoned, recovering");
            poisoned.into_inner()
        }
    };

    tokens.get(provider_name).cloned()
}

#[deprecated(
    since = "0.4.0",
    note = "Google Drive support is deprecated. Use anonymous authentication instead."
)]
pub async fn create_auth() -> Option<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> {
    setup_default_crypto_provider();
    let token = get_refresh_token("google")?;

    let provider_refresh_token = token.refresh_token;
    let token_type = token.token_type.unwrap_or("Bearer".to_string());

    // Build-time embedding only: values must be provided via build env or cargo:rustc-env
    let client_id = match std::option_env!("GOOGLE_CLIENT_ID") {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            tracing::error!(
                "google client id missing; ensure build-time env is set via cargo:rustc-env"
            );
            return None;
        }
    };

    let client_secret = match std::option_env!("GOOGLE_CLIENT_SECRET") {
        Some(secret) if !secret.is_empty() => secret.to_string(),
        _ => {
            tracing::error!(
                "google client secret missing; ensure build-time env is set via cargo:rustc-env"
            );
            return None;
        }
    };

    let secret = yup_oauth2::authorized_user::AuthorizedUserSecret {
        client_id,
        client_secret,
        refresh_token: provider_refresh_token,
        key_type: token_type,
    };

    let auth: Authenticator<
        hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>,
    > = match yup_oauth2::AuthorizedUserAuthenticator::builder(secret)
        .build()
        .await
    {
        Ok(auth) => auth,
        Err(e) => {
            tracing::error!("failed to create authenticator: {e:?}");
            return None;
        }
    };

    if let Err(e) = auth.token(SCOPES).await {
        tracing::error!("initial Google token fetch failed: {e:?}");
        let _ = runtime_hooks::launch_auth_page();
        return None;
    }

    return Some(auth);
}

#[deprecated(
    since = "0.4.0",
    note = "Google Drive support is deprecated. Use anonymous authentication instead."
)]
pub async fn create_client() -> Option<DriveClient> {
    let auth = if let Some(cached) = USER_GOOGLE_AUTH.get() {
        cached.clone()
    } else {
        let Some(created) = create_auth().await else {
            tracing::error!("failed to create auth");
            let _ = runtime_hooks::launch_auth_page();
            return None;
        };
        let _ = USER_GOOGLE_AUTH.set(created.clone());
        USER_GOOGLE_AUTH.get().cloned().unwrap_or(created)
    };

    if let Err(e) = auth.force_refreshed_token(SCOPES).await {
        tracing::error!("Google refresh_token invalid/expired: {e:?}; opening auth page");
        let _ = runtime_hooks::launch_auth_page();
        return None;
    }

    let https_builder = match hyper_rustls::HttpsConnectorBuilder::new().with_native_roots() {
        Ok(builder) => builder,
        Err(e) => {
            tracing::error!("failed to load native root certificates: {e}");
            return None;
        }
    };

    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build(https_builder.https_or_http().enable_http1().build());
    let hub = DriveHub::new(client, auth);

    return Some(hub);
}
