// Google Drive authentication and client management

use google_drive3::{
    hyper_rustls, hyper_util, yup_oauth2, yup_oauth2::authenticator::Authenticator, DriveHub,
};
use once_cell::sync::Lazy;
use proxy_https::proxy_server_https::setup_default_crypto_provider;
use std::sync::Mutex;
use std::collections::HashMap;
use tokio::sync::OnceCell;
use crate::auth::auth_server;

pub type DriveClient =
    DriveHub<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>;

#[derive(Debug, Clone)]
pub struct UserAccessTokenInfo {
    pub refresh_token: String,
    pub token_type: Option<String>,
}

const SCOPES: &[&str; 1] = &["https://www.googleapis.com/auth/drive.file"];

// Support multiple cloud providers with HashMap
pub static CLOUD_PROVIDER_TOKENS: Lazy<Mutex<HashMap<String, UserAccessTokenInfo>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub static USER_GOOGLE_AUTH: OnceCell<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> = OnceCell::const_new();

/// Set refresh token for a specific provider (google, dropbox, icloud, etc.)
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
            proxy_https::proxy_server_https::setup_default_crypto_provider();
            let hub = create_client().await;
            if hub.is_none() {
                let _ = auth_server::open_auth_page();
            }
        });
    }
    
    Ok(())
}

/// Get refresh token for a specific provider
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

pub async fn create_auth() -> Option<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> {
    setup_default_crypto_provider();
    let token = get_refresh_token("google")?;
    
    let provider_refresh_token = token.refresh_token;
    let token_type = token.token_type.unwrap_or("Bearer".to_string());
    let secret = yup_oauth2::authorized_user::AuthorizedUserSecret {
        client_id: match std::option_env!("GOOGLE_CLIENT_ID") {
            Some(id) => id.to_string(),
            None => {
                tracing::error!("failed to get google client id");
                return None;
            }
        },
        client_secret: match std::option_env!("GOOGLE_CLIENT_SECRET") {
            Some(secret) => secret.to_string(),
            None => {
                tracing::error!("failed to get google client secret");
                return None;
            }
        },
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
        let _ = auth_server::open_auth_page();
        return None;
    }

    return Some(auth);
}

pub async fn create_client() -> Option<DriveClient> {
    let auth = USER_GOOGLE_AUTH
        .get_or_init(|| async {
            match create_auth().await {
                Some(auth) => auth,
                None => {
                    tracing::error!("failed to create auth. retrying...");
                    let _ = auth_server::open_auth_page();
                    panic!("failed to create auth");
                }
            }
        })
        .await
        .clone();

    if let Err(e) = auth.force_refreshed_token(SCOPES).await {
        tracing::error!("Google refresh_token invalid/expired: {e:?}; opening auth page");
        let _ = auth_server::open_auth_page();
        return None;
    }

    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build(
            hyper_rustls::HttpsConnectorBuilder::new()
                .with_native_roots()
                .unwrap()
                .https_or_http()
                .enable_http1()
                .build(),
        );
    let hub = DriveHub::new(client, auth);

    return Some(hub);
}
