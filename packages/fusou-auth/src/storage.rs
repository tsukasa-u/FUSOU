use crate::error::AuthError;
use crate::types::Session;
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::path::PathBuf;
use tokio::fs;
use std::io::ErrorKind;

#[async_trait]
pub trait Storage: Send + Sync {
    async fn load_session(&self) -> Result<Option<Session>, AuthError>;
    async fn save_session(&self, session: &Session) -> Result<(), AuthError>;
    async fn clear(&self) -> Result<(), AuthError>;
}

/// Simple in-memory storage for testing and single-process usage.
pub struct InMemoryStorage {
    inner: Arc<Mutex<Option<Session>>>,
}

impl InMemoryStorage {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }
}

#[async_trait]
impl Storage for InMemoryStorage {
    async fn load_session(&self) -> Result<Option<Session>, AuthError> {
        let guard = self.inner.lock().await;
        Ok((*guard).clone())
    }

    async fn save_session(&self, session: &Session) -> Result<(), AuthError> {
        let mut guard = self.inner.lock().await;
        *guard = Some(session.clone());
        Ok(())
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let mut guard = self.inner.lock().await;
        *guard = None;
        Ok(())
    }
}

/// File-based storage: stores a JSON session at the given path.
pub struct FileStorage {
    path: PathBuf,
}

impl FileStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

#[async_trait]
impl Storage for FileStorage {
    async fn load_session(&self) -> Result<Option<Session>, AuthError> {
        match fs::read_to_string(&self.path).await {
            Ok(s) => match serde_json::from_str::<Session>(&s) {
                Ok(session) => Ok(Some(session)),
                Err(e) => Err(AuthError::Serde(e)),
            },
            Err(e) => {
                if e.kind() == ErrorKind::NotFound {
                    Ok(None)
                } else {
                    Err(AuthError::Other(e.to_string()))
                }
            }
        }
    }

    async fn save_session(&self, session: &Session) -> Result<(), AuthError> {
        let s = serde_json::to_string(session)?;
        if let Some(parent) = self.path.parent() {
            if let Err(e) = fs::create_dir_all(parent).await {
                return Err(AuthError::Other(e.to_string()));
            }
        }
        fs::write(&self.path, s).await.map_err(|e| AuthError::Other(e.to_string()))
    }

    async fn clear(&self) -> Result<(), AuthError> {
        match fs::remove_file(&self.path).await {
            Ok(_) => Ok(()),
            Err(e) => {
                if e.kind() == ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(AuthError::Other(e.to_string()))
                }
            }
        }
    }
}

// (KeyringStorage removed for now; can be added later as a separate module.)
