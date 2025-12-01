use thiserror::Error;

#[derive(Error, Debug)]
pub enum AuthError {
    #[error("no session available")]
    NoSession,

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("refresh failed: {0}")]
    RefreshFailed(String),

    #[error("other: {0}")]
    Other(String),
}
