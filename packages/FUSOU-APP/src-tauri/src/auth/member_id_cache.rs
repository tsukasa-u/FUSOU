use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Local cache for member_id_hash to avoid requiring game launch every time
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemberIdCache {
    /// The cached member_id_hash value
    pub member_id_hash: String,
    /// Timestamp when this was last updated (milliseconds since epoch)
    pub last_updated_ms: u64,
}

impl MemberIdCache {
    /// Get the cache file path (using app data directory)
    fn get_cache_path() -> PathBuf {
        let app_data_dir = dirs::data_local_dir()
            .expect("Failed to get local data directory")
            .join("FUSOU");
        
        // Ensure directory exists
        if !app_data_dir.exists() {
            let _ = fs::create_dir_all(&app_data_dir);
        }
        
        app_data_dir.join(".member_id_cache.json")
    }

    /// Load cached member_id_hash from disk
    pub fn load() -> Option<Self> {
        let cache_path = Self::get_cache_path();
        
        if !cache_path.exists() {
            tracing::debug!("No member_id_hash cache found");
            return None;
        }

        match fs::read_to_string(&cache_path) {
            Ok(content) => match serde_json::from_str::<Self>(&content) {
                Ok(cache) => {
                    tracing::info!(
                        "Loaded member_id_hash cache (updated {} ms ago)",
                        Self::current_time_ms() - cache.last_updated_ms
                    );
                    Some(cache)
                }
                Err(e) => {
                    tracing::warn!("Failed to parse member_id_hash cache: {}", e);
                    None
                }
            },
            Err(e) => {
                tracing::warn!("Failed to read member_id_hash cache: {}", e);
                None
            }
        }
    }

    /// Save member_id_hash to cache
    pub fn save(member_id_hash: &str) -> Result<(), String> {
        let cache = Self {
            member_id_hash: member_id_hash.to_string(),
            last_updated_ms: Self::current_time_ms(),
        };

        let cache_path = Self::get_cache_path();
        
        match serde_json::to_string_pretty(&cache) {
            Ok(json) => {
                if let Err(e) = fs::write(&cache_path, json) {
                    tracing::error!("Failed to write member_id_hash cache: {}", e);
                    return Err(format!("Failed to write cache: {}", e));
                }
                tracing::info!("Saved member_id_hash to cache: {}...", &member_id_hash[..member_id_hash.len().min(10)]);
                Ok(())
            }
            Err(e) => {
                tracing::error!("Failed to serialize member_id_hash cache: {}", e);
                Err(format!("Failed to serialize cache: {}", e))
            }
        }
    }

    /// Clear the cache file
    #[allow(dead_code)]
    pub fn clear() -> Result<(), String> {
        let cache_path = Self::get_cache_path();
        
        if cache_path.exists() {
            if let Err(e) = fs::remove_file(&cache_path) {
                tracing::error!("Failed to delete member_id_hash cache: {}", e);
                return Err(format!("Failed to delete cache: {}", e));
            }
            tracing::info!("Cleared member_id_hash cache");
        }
        
        Ok(())
    }

    /// Get current timestamp in milliseconds
    fn current_time_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("System time before UNIX epoch")
            .as_millis() as u64
    }
}
