use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
struct CacheEntry {
    hash: String,
    expires_at: Instant,
}

#[derive(Debug, Clone)]
pub struct SuppressionCacheEntryStatus {
    pub key: String,
    pub hash: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone)]
pub struct SuppressionCacheStatus {
    pub scope: Option<String>,
    pub entries: Vec<SuppressionCacheEntryStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedEntry {
    key: String,
    hash: String,
    expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PersistedState {
    scope: Option<String>,
    entries: Vec<PersistedEntry>,
}

#[derive(Debug)]
pub struct LocalRequestSuppressionCache {
    ttl: Duration,
    entries: DashMap<String, CacheEntry>,
    scope: RwLock<Option<String>>,
    persistence_file: RwLock<Option<PathBuf>>,
}

impl LocalRequestSuppressionCache {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: DashMap::new(),
            scope: RwLock::new(None),
            persistence_file: RwLock::new(None),
        }
    }

    pub fn enable_persistence(&self, file_path: impl Into<PathBuf>) -> Result<(), String> {
        let file_path = file_path.into();
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create cache parent directory: {}", e))?;
        }

        {
            let mut guard = self
                .persistence_file
                .write()
                .unwrap_or_else(|e| e.into_inner());
            *guard = Some(file_path.clone());
        }

        self.load_from_file(&file_path)?;
        self.flush_to_disk()?;
        Ok(())
    }

    pub fn rotate_scope(&self, new_scope: Option<&str>) -> bool {
        let mut guard = self.scope.write().unwrap_or_else(|e| e.into_inner());
        let next = new_scope.map(str::to_string);
        let changed = *guard != next;
        if changed {
            self.entries.clear();
            *guard = next;
            let _ = self.flush_to_disk();
        }
        changed
    }

    pub fn should_skip(&self, key: &str, hash: &str) -> bool {
        let now = Instant::now();
        if let Some(entry) = self.entries.get(key) {
            if entry.expires_at > now && entry.hash == hash {
                return true;
            }
        }
        if self.entries.remove(key).is_some() {
            let _ = self.flush_to_disk();
        }
        false
    }

    pub fn mark_processed(&self, key: impl Into<String>, hash: impl Into<String>) {
        self.entries.insert(
            key.into(),
            CacheEntry {
                hash: hash.into(),
                expires_at: Instant::now() + self.ttl,
            },
        );
        let _ = self.flush_to_disk();
    }

    pub fn clear(&self) {
        self.entries.clear();
        let _ = self.flush_to_disk();
    }

    pub fn snapshot_status(&self) -> SuppressionCacheStatus {
        let now = Instant::now();
        let now_ms = Self::now_epoch_millis();
        let mut entries = Vec::new();

        for item in self.entries.iter() {
            if item.expires_at <= now {
                continue;
            }
            let remain = item.expires_at.duration_since(now).as_millis() as u64;
            entries.push(SuppressionCacheEntryStatus {
                key: item.key().clone(),
                hash: item.hash.clone(),
                expires_at_ms: now_ms + remain,
            });
        }

        entries.sort_by(|a, b| a.key.cmp(&b.key));

        SuppressionCacheStatus {
            scope: self
                .scope
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            entries,
        }
    }

    fn now_epoch_millis() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    fn read_persistence_path(&self) -> Option<PathBuf> {
        self.persistence_file
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn load_from_file(&self, file_path: &Path) -> Result<(), String> {
        if !file_path.exists() {
            return Ok(());
        }

        let content = fs::read_to_string(file_path)
            .map_err(|e| format!("failed to read suppression cache file: {}", e))?;
        let parsed: PersistedState = serde_json::from_str(&content)
            .map_err(|e| format!("failed to parse suppression cache file: {}", e))?;

        {
            let mut scope_guard = self.scope.write().unwrap_or_else(|e| e.into_inner());
            *scope_guard = parsed.scope;
        }

        self.entries.clear();
        let now_ms = Self::now_epoch_millis();
        for entry in parsed.entries {
            if entry.expires_at_ms <= now_ms {
                continue;
            }
            let remaining = entry.expires_at_ms - now_ms;
            self.entries.insert(
                entry.key,
                CacheEntry {
                    hash: entry.hash,
                    expires_at: Instant::now() + Duration::from_millis(remaining),
                },
            );
        }

        Ok(())
    }

    fn flush_to_disk(&self) -> Result<(), String> {
        let Some(path) = self.read_persistence_path() else {
            return Ok(());
        };

        let now = Instant::now();
        let now_ms = Self::now_epoch_millis();
        let mut entries = Vec::new();

        for item in self.entries.iter() {
            if item.expires_at <= now {
                continue;
            }
            let remain = item.expires_at.duration_since(now).as_millis() as u64;
            entries.push(PersistedEntry {
                key: item.key().clone(),
                hash: item.hash.clone(),
                expires_at_ms: now_ms + remain,
            });
        }

        let scope = self
            .scope
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let payload = PersistedState { scope, entries };
        let json = serde_json::to_string_pretty(&payload)
            .map_err(|e| format!("failed to serialize suppression cache: {}", e))?;
        fs::write(path, json)
            .map_err(|e| format!("failed to write suppression cache file: {}", e))?;
        Ok(())
    }
}
