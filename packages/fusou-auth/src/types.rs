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

/// セッションの種類を表す列挙型
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum SessionType {
    /// ソーシャル認証（Google等）
    Social,
    /// 匿名認証（バックグラウンド認証）
    Anonymous,
}

/// 複数のセッションを管理する構造体
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MultiSession {
    /// ソーシャル認証セッション
    pub social_session: Option<Session>,
    /// 匿名認証セッション
    pub anonymous_session: Option<Session>,
    /// データセット投稿用トークン
    pub dataset_token: Option<DatasetToken>,
}

/// データセット投稿用のトークン
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DatasetToken {
    /// JWT形式のトークン
    pub token: String,
    /// トークンの有効期限
    pub expires_at: DateTime<Utc>,
}

impl MultiSession {
    pub fn new() -> Self {
        Self {
            social_session: None,
            anonymous_session: None,
            dataset_token: None,
        }
    }

    /// 有効なセッションを優先順位に従って返す
    /// 優先順位: ソーシャル > 匿名
    pub fn get_active_session(&self) -> Option<(&Session, SessionType)> {
        if let Some(ref social) = self.social_session {
            if Self::is_session_valid(social) {
                return Some((social, SessionType::Social));
            }
        }
        
        if let Some(ref anonymous) = self.anonymous_session {
            if Self::is_session_valid(anonymous) {
                return Some((anonymous, SessionType::Anonymous));
            }
        }
        
        None
    }

    /// セッションが有効かどうかを判定
    fn is_session_valid(session: &Session) -> bool {
        if let Some(expires_at) = session.expires_at {
            expires_at > Utc::now()
        } else {
            // 有効期限がない場合は有効とみなす
            true
        }
    }

    /// dataset_tokenが有効かどうかを判定（期限1日前を基準）
    pub fn is_dataset_token_valid(&self) -> bool {
        if let Some(ref token) = self.dataset_token {
            let one_day = chrono::Duration::days(1);
            token.expires_at > Utc::now() + one_day
        } else {
            false
        }
    }
}

impl Default for MultiSession {
    fn default() -> Self {
        Self::new()
    }
}
