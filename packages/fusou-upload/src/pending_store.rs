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
        if let Err(e) = file.sync_all() {
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

        if let Err(e) = self.write_meta_atomically(&meta) {
            let _ = fs::remove_file(&file_path);
            return Err(e);
        }

        Ok(PendingSaveOutcome::Created(meta))
    }

    pub fn list_pending(&self) -> Vec<PendingMeta> {
        let mut pending_items = Vec::new();

        let entries = match fs::read_dir(&self.base_dir) {
            Ok(entries) => entries,
            Err(error) => {
                tracing::warn!(%error, path = %self.base_dir.display(), "failed to list pending uploads");
                return pending_items;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    tracing::warn!(%error, "failed to read pending directory entry");
                    continue;
                }
            };
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let content = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(error) => {
                    tracing::warn!(%error, path = %path.display(), "failed to read pending metadata");
                    continue;
                }
            };
            let meta = match serde_json::from_str::<PendingMeta>(&content) {
                Ok(meta) => meta,
                Err(error) => {
                    tracing::warn!(%error, path = %path.display(), "invalid pending metadata; preserve for recovery");
                    continue;
                }
            };
            if self.is_expected_pending_file_path(&meta) && meta.file_path.exists() {
                pending_items.push(meta);
            } else if let Err(error) = fs::remove_file(&path) {
                tracing::warn!(%error, path = %path.display(), "failed to remove orphaned pending metadata");
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
        self.write_meta_atomically(meta)
    }

    fn write_meta_atomically(&self, meta: &PendingMeta) -> Result<(), io::Error> {
        let meta_path = self.base_dir.join(format!("{}.json", meta.id));
        let temporary_path = self
            .base_dir
            .join(format!("{}.json.{}.tmp", meta.id, Uuid::new_v4()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary_path)?;
        let result = (|| {
            serde_json::to_writer_pretty(&mut file, meta).map_err(io::Error::other)?;
            file.sync_all()?;
            drop(file);
            Self::replace_metadata(&temporary_path, &meta_path)
        })();
        if result.is_err() {
            if let Err(error) = fs::remove_file(&temporary_path) {
                if error.kind() != io::ErrorKind::NotFound {
                    tracing::warn!(%error, "failed to remove unpublished pending metadata");
                }
            }
        }
        result
    }

    fn replace_metadata(temporary_path: &Path, meta_path: &Path) -> Result<(), io::Error> {
        #[cfg(windows)]
        for delay_ms in [10, 20, 40, 80, 160] {
            match fs::rename(temporary_path, meta_path) {
                Ok(()) => return Ok(()),
                Err(error) if matches!(error.raw_os_error(), Some(5 | 32 | 33)) => {
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                }
                Err(error) => return Err(error),
            }
        }
        fs::rename(temporary_path, meta_path)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    struct Fixture(PendingStore);

    impl Fixture {
        fn new() -> Self {
            Self(PendingStore::new(
                std::env::temp_dir().join(format!("fusou-pending-audit-{}", Uuid::new_v4())),
            ))
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Ok(entries) = fs::read_dir(self.0.base_dir()) {
                for entry in entries.flatten() {
                    let _ = fs::remove_file(entry.path());
                }
            }
            let _ = fs::remove_dir(self.0.base_dir());
        }
    }

    #[test]
    fn metadata_replacement_preserves_an_already_open_reader() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let mut meta = store
            .save_pending("https://example.com", &HashMap::new(), b"payload", None)
            .unwrap()
            .meta()
            .clone();
        let mut reader =
            fs::File::open(store.base_dir().join(format!("{}.json", meta.id))).unwrap();
        meta.increment_attempt(1);
        store.update_meta(&meta).unwrap();
        let mut previous = String::new();
        reader.read_to_string(&mut previous).unwrap();
        let previous: PendingMeta = serde_json::from_str(&previous).unwrap();
        assert_eq!(previous.attempt_count, 0);
        assert_eq!(store.list_pending()[0].attempt_count, 1);
    }

    #[test]
    fn unpublished_metadata_does_not_replace_the_last_complete_record() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let meta = store
            .save_pending("https://example.com", &HashMap::new(), b"payload", None)
            .unwrap()
            .meta()
            .clone();
        fs::write(
            store.base_dir().join(format!("{}.json.crash.tmp", meta.id)),
            b"{",
        )
        .unwrap();
        assert_eq!(store.list_pending().len(), 1);
        assert_eq!(store.read_data(&meta).unwrap(), b"payload");
    }

    #[cfg(windows)]
    #[test]
    fn metadata_replacement_retries_a_transient_delete_sharing_lock() {
        use std::os::windows::fs::OpenOptionsExt;
        use std::time::Duration;

        let fixture = Fixture::new();
        let store = &fixture.0;
        let mut meta = store
            .save_pending("https://example.com", &HashMap::new(), b"payload", None)
            .unwrap()
            .meta()
            .clone();
        let path = store.base_dir().join(format!("{}.json", meta.id));
        let reader = fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        fs::write(&path, serde_json::to_vec_pretty(&meta).unwrap()).unwrap();
        let temporary = store.base_dir().join("replacement.json.tmp");
        meta.increment_attempt(1);
        fs::write(&temporary, serde_json::to_vec_pretty(&meta).unwrap()).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(40));
            drop(reader);
        });
        let result = PendingStore::replace_metadata(&temporary, &path);
        release.join().unwrap();
        result.unwrap();
        assert_eq!(store.list_pending()[0].attempt_count, 1);
    }

    #[test]
    fn concurrent_metadata_publications_leave_one_complete_record() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let meta = store
            .save_pending("https://example.com", &HashMap::new(), b"payload", None)
            .unwrap()
            .meta()
            .clone();
        let writers: Vec<_> = (1..=12)
            .map(|attempt| {
                let store = store.clone();
                let mut meta = meta.clone();
                std::thread::spawn(move || {
                    meta.attempt_count = attempt;
                    store.update_meta(&meta)
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap().unwrap();
        }
        let pending = store.list_pending();
        assert_eq!(pending.len(), 1);
        assert!((1..=12).contains(&pending[0].attempt_count));
        assert_eq!(store.read_data(&pending[0]).unwrap(), b"payload");
        assert!(fs::read_dir(store.base_dir()).unwrap().all(|entry| {
            entry.unwrap().path().extension().and_then(|s| s.to_str()) != Some("tmp")
        }));
    }

    #[cfg(windows)]
    #[test]
    fn failed_replacement_preserves_metadata_and_removes_temporary_file() {
        use std::os::windows::fs::OpenOptionsExt;

        let fixture = Fixture::new();
        let store = &fixture.0;
        let mut meta = store
            .save_pending("https://example.com", &HashMap::new(), b"payload", None)
            .unwrap()
            .meta()
            .clone();
        let reader = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(store.base_dir().join(format!("{}.json", meta.id)))
            .unwrap();
        meta.increment_attempt(1);
        assert!(store.update_meta(&meta).is_err());
        assert_eq!(store.list_pending()[0].attempt_count, 0);
        assert_eq!(store.read_data(&meta).unwrap(), b"payload");
        assert!(fs::read_dir(store.base_dir()).unwrap().all(|entry| {
            entry.unwrap().path().extension().and_then(|s| s.to_str()) != Some("tmp")
        }));
        drop(reader);
    }
}
