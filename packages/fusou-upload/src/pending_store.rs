use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingMeta {
    pub id: String,
    pub target_url: String,
    pub headers: HashMap<String, String>,
    pub created_at: u64,
    pub attempt_count: u32,
    pub file_path: PathBuf,
    pub context: Option<String>,
}

impl PendingMeta {
    pub fn new(id: String, target_url: String, headers: HashMap<String, String>, file_path: PathBuf, context: Option<String>) -> Self {
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
            file_path,
            context,
        }
    }

    pub fn increment_attempt(&mut self) {
        self.attempt_count += 1;
    }
}

#[derive(Clone)]
pub struct PendingStore {
    base_dir: PathBuf,
}

impl PendingStore {
    pub fn new(base_dir: PathBuf) -> Self {
        if !base_dir.exists() {
            if let Err(e) = fs::create_dir_all(&base_dir) {
                tracing::error!("Failed to create pending store directory: {}", e);
            }
        }
        Self { base_dir }
    }

    pub fn save_pending(&self, target_url: &str, headers: &HashMap<String, String>, data: &[u8], context: Option<String>) -> Result<PendingMeta, io::Error> {
        let id = Uuid::new_v4().to_string();
        let file_name = format!("{}.bin", id);
        let file_path = self.base_dir.join(&file_name);

        // Write data to file
        let mut file = fs::File::create(&file_path)?;
        if let Err(e) = file.write_all(data) {
            let _ = fs::remove_file(&file_path);
            return Err(e);
        }

        // Create metadata
        let meta = PendingMeta::new(id, target_url.to_string(), headers.clone(), file_path.clone(), context);
        
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

        Ok(meta)
    }

    pub fn list_pending(&self) -> Vec<PendingMeta> {
        let mut pending_items = Vec::new();
        
        if let Ok(entries) = fs::read_dir(&self.base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(meta) = serde_json::from_str::<PendingMeta>(&content) {
                            // Verify if binary file exists
                            if meta.file_path.exists() {
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
}
