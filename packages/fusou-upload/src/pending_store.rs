use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingMeta {
    pub id: String,
    pub target_url: String,
    pub headers: HashMap<String, String>,
    pub created_at: u64,
    pub attempt_count: u32,
    #[serde(default)]
    pub last_attempt_at: Option<u64>,
    pub file_path: PathBuf,
    pub context: Option<String>,
}

impl PendingMeta {
    pub fn new(
        id: String,
        target_url: String,
        headers: HashMap<String, String>,
        file_path: PathBuf,
        context: Option<String>,
    ) -> Self {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            id,
            target_url,
            headers,
            created_at,
            attempt_count: 0,
            last_attempt_at: None,
            file_path,
            context,
        }
    }

    pub fn increment_attempt(&mut self, attempted_at: u64) {
        self.attempt_count += 1;
        self.last_attempt_at = Some(attempted_at);
    }
}

#[derive(Debug, Clone)]
pub enum PendingSaveOutcome {
    Created(PendingMeta),
    Existing(PendingMeta),
}

impl PendingSaveOutcome {
    pub fn meta(&self) -> &PendingMeta {
        match self {
            PendingSaveOutcome::Created(meta) | PendingSaveOutcome::Existing(meta) => meta,
        }
    }

    pub fn was_created(&self) -> bool {
        matches!(self, PendingSaveOutcome::Created(_))
    }
}

#[derive(Clone)]
pub struct PendingStore {
    base_dir: PathBuf,
    save_lock: Arc<Mutex<()>>,
}

impl PendingStore {
    pub fn new(base_dir: PathBuf) -> Self {
        if !base_dir.exists() {
            if let Err(e) = fs::create_dir_all(&base_dir) {
                tracing::error!("Failed to create pending store directory: {}", e);
            }
        }
        Self {
            base_dir,
            save_lock: Arc::new(Mutex::new(())),
        }
    }

    fn compute_content_hash(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    fn find_existing_pending(
        &self,
        target_url: &str,
        content_hash: &str,
        remote_path: Option<&str>,
        context: Option<&str>,
    ) -> Option<PendingMeta> {
        self.list_pending().into_iter().find(|meta| {
            let existing_hash = meta.headers.get("content-hash").map(String::as_str);
            let existing_remote_path = meta.headers.get("remote-path").map(String::as_str);
            let existing_context = meta.context.as_deref();
            meta.target_url == target_url
                && existing_hash == Some(content_hash)
                && existing_remote_path == remote_path
                && existing_context == context
        })
    }

    fn is_expected_pending_file_path(&self, meta: &PendingMeta) -> bool {
        let expected = self.base_dir.join(format!("{}.bin", meta.id));
        if meta.file_path != expected {
            return false;
        }

        match (
            fs::canonicalize(&self.base_dir),
            fs::canonicalize(&meta.file_path),
        ) {
            (Ok(base_canonical), Ok(file_canonical)) => file_canonical.starts_with(base_canonical),
            _ => false,
        }
    }

    pub fn save_pending(
        &self,
        target_url: &str,
        headers: &HashMap<String, String>,
        data: &[u8],
        context: Option<String>,
    ) -> Result<PendingSaveOutcome, io::Error> {
        // Prevent duplicate-file races when multiple tasks fail the same upload simultaneously.
        let _guard = self
            .save_lock
            .lock()
            .map_err(|_| io::Error::other("pending save lock poisoned"))?;

        let mut normalized_headers = headers.clone();
        let content_hash = normalized_headers
            .entry("content-hash".to_string())
            .or_insert_with(|| Self::compute_content_hash(data))
            .clone();
        let remote_path = normalized_headers.get("remote-path").map(String::as_str);
        let context_ref = context.as_deref();

        if let Some(existing) =
            self.find_existing_pending(target_url, &content_hash, remote_path, context_ref)
        {
            tracing::info!(
                pending_id = %existing.id,
                target_url,
                content_hash,
                remote_path,
                "matching pending upload already exists; skipping duplicate save"
            );
            return Ok(PendingSaveOutcome::Existing(existing));
        }

        let id = Uuid::new_v4().to_string();
        let file_name = format!("{}.bin", id);
        let file_path = self.base_dir.join(&file_name);

        // Write data to file
        let mut file = fs::File::create(&file_path)?;
        if let Err(e) = file.write_all(data) {
            let _ = fs::remove_file(&file_path);
            return Err(e);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&file_path, fs::Permissions::from_mode(0o600));
        }

        // Create metadata
        let meta = PendingMeta::new(
            id,
            target_url.to_string(),
            normalized_headers,
            file_path.clone(),
            context,
        );

        // Save metadata
        let meta_file_name = format!("{}.json", meta.id);
        let meta_path = self.base_dir.join(&meta_file_name);
        let meta_json = match serde_json::to_string_pretty(&meta) {
            Ok(json) => json,
            Err(e) => {
                let _ = fs::remove_file(&file_path);
                return Err(io::Error::new(io::ErrorKind::InvalidData, e));
            }
        };

        if let Err(e) = fs::write(&meta_path, meta_json) {
            let _ = fs::remove_file(&file_path);
            return Err(e);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&meta_path, fs::Permissions::from_mode(0o600));
        }

        Ok(PendingSaveOutcome::Created(meta))
    }

    pub fn list_pending(&self) -> Vec<PendingMeta> {
        let mut pending_items = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(meta) = serde_json::from_str::<PendingMeta>(&content) {
                            // Only load metadata that points to the expected id.bin file under base_dir.
                            if self.is_expected_pending_file_path(&meta) && meta.file_path.exists()
                            {
                                pending_items.push(meta);
                            } else {
                                // Cleanup orphaned metadata
                                let _ = fs::remove_file(path);
                            }
                        }
                    }
                }
            }
        }

        // Sort by created_at (oldest first)
        pending_items.sort_by_key(|k| k.created_at);
        pending_items
    }

    pub fn delete_pending(&self, id: &str) -> Result<(), io::Error> {
        let meta_path = self.base_dir.join(format!("{}.json", id));
        let bin_path = self.base_dir.join(format!("{}.bin", id));

        if meta_path.exists() {
            fs::remove_file(meta_path)?;
        }
        if bin_path.exists() {
            fs::remove_file(bin_path)?;
        }
        Ok(())
    }

    pub fn update_meta(&self, meta: &PendingMeta) -> Result<(), io::Error> {
        let meta_path = self.base_dir.join(format!("{}.json", meta.id));
        let meta_json = serde_json::to_string_pretty(meta)?;
        fs::write(meta_path, meta_json)?;
        Ok(())
    }

    pub fn cleanup_expired(&self, ttl_seconds: u64) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let pending = self.list_pending();
        for meta in pending {
            if now > meta.created_at + ttl_seconds {
                tracing::info!("Removing expired pending upload: {}", meta.id);
                let _ = self.delete_pending(&meta.id);
            }
        }
    }

    pub fn read_data(&self, meta: &PendingMeta) -> Result<Vec<u8>, io::Error> {
        fs::read(&meta.file_path)
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}
