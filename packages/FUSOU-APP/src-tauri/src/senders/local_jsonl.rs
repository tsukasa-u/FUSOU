use crate::storage::root_validator::LocalAppendTarget;
use fusou_upload::LocalRequestSuppressionCache;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// Appends deduplicated JSON Lines records under the configured local storage root.
pub(crate) struct LocalJsonlSink {
    relative_path: String,
    custom_root: Option<PathBuf>,
    target: OnceLock<LocalAppendTarget>,
    cache: Arc<LocalRequestSuppressionCache>,
}

impl LocalJsonlSink {
    pub(crate) fn new(
        custom_root: Option<PathBuf>,
        cache_file: PathBuf,
        relative_path: String,
        label: &'static str,
    ) -> Self {
        let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(
            7 * 24 * 60 * 60,
        )));
        if let Err(e) = cache.enable_persistence(cache_file) {
            tracing::warn!(
                error = %e,
                sink = label,
                "failed to enable persistent local jsonl suppression cache"
            );
        }
        Self {
            relative_path,
            custom_root,
            target: OnceLock::new(),
            cache,
        }
    }

    fn resolve_target(&self) -> Result<&LocalAppendTarget, Box<dyn std::error::Error>> {
        if let Some(target) = self.target.get() {
            return Ok(target);
        }

        let opened = match &self.custom_root {
            Some(root) => LocalAppendTarget::open_from_root(root.clone())?,
            None => LocalAppendTarget::open_from_config()?,
        };
        let _ = self.target.set(opened);
        Ok(self
            .target
            .get()
            .expect("local jsonl target just initialized"))
    }

    /// Serializes `value` as a single JSON line and appends it when `(key, payload_hash)` has not
    /// already been written for `scope`.
    pub(crate) async fn write_if_new(
        &self,
        scope: Option<&str>,
        key: &str,
        payload_hash: &str,
        value: &serde_json::Value,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        self.cache.rotate_scope(scope);
        if self.cache.should_skip(key, payload_hash) {
            return Ok(false);
        }

        let target = self.resolve_target()?;
        let line = serde_json::to_vec(value)?;
        target
            .append_line_async(self.relative_path.clone(), line)
            .await?;
        self.cache
            .mark_processed(key.to_string(), payload_hash.to_string());
        Ok(true)
    }
}
