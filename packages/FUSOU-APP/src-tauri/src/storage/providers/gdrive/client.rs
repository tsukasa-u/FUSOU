// Google Drive authentication and client management

use google_drive3::{
    hyper_rustls, hyper_util, yup_oauth2, yup_oauth2::authenticator::Authenticator, DriveHub,
};
use once_cell::sync::Lazy;
use proxy_https::proxy_server_https::setup_default_crypto_provider;
use std::sync::Mutex;
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

pub static USER_ACCESS_TOKEN: Lazy<Mutex<Option<UserAccessTokenInfo>>> =
    Lazy::new(|| Mutex::new(None));
pub static USER_GOOGLE_AUTH: OnceCell<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> = OnceCell::const_new();

pub fn set_refresh_token(refresh_token: String, token_type: String) -> Result<(), ()> {
    if refresh_token.is_empty() || token_type.is_empty() {
        return Err(());
    }

    tracing::info!("set refresh token: {refresh_token}");
    let mut local_access_token = match USER_ACCESS_TOKEN.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::warn!("USER_ACCESS_TOKEN mutex poisoned, recovering");
            poisoned.into_inner()
        }
    };
    let info = UserAccessTokenInfo {
        refresh_token: refresh_token.to_owned(),
        token_type: if token_type == "bearer" {
            Some(token_type.to_owned())
        } else {
            Some("bearer".to_owned())
        },
    };
    *local_access_token = Some(info);
    tokio::task::spawn(async move {
        proxy_https::proxy_server_https::setup_default_crypto_provider();
        let hub = create_client().await;
        if hub.is_none() {
            let _ = auth_server::open_auth_page();
        }
    });
    Ok(())
}

pub async fn create_auth() -> Option<
    Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>,
> {
    setup_default_crypto_provider();
    let token = {
        let token_guard = match USER_ACCESS_TOKEN.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                tracing::warn!("USER_ACCESS_TOKEN mutex poisoned, recovering");
                poisoned.into_inner()
            }
        };
        match token_guard.clone() {
            Some(token) => token,
            None => {
                tracing::error!("USER_ACCESS_TOKEN is not set");
                return None;
            }
        }
    };
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
        tracing::error!("error: {e:?}")
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
        tracing::error!("error: {e:?}");
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
