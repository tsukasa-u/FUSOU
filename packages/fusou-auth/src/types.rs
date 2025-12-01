use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// optional expiration time for the access token
    pub expires_at: Option<DateTime<Utc>>,
    pub token_type: Option<String>,
}
