use crate::senders::local_jsonl::LocalJsonlSink;
use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{
    LocalRequestSuppressionCache, PendingStore, UploadContext, UploadRequest, UploadRetryService,
    Uploader,
};
use kc_api::database::models::soku_speed_observed::SokuSpeedObservedSnapshot as UploadSnapshot;
use kc_api::interface::soku_speed_observed::SokuSpeedObservedSnapshot;
use once_cell::sync::OnceCell;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;
use uuid::Uuid;

static SOKU_SPEED_SENDER: OnceCell<Arc<SokuSpeedSender>> = OnceCell::new();

pub struct SokuSpeedSender {
    ingest_endpoint: Option<String>,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache: Arc<LocalRequestSuppressionCache>,
    local_sink: Option<LocalJsonlSink>,
    client: reqwest::Client,
    next_seq: AtomicU64,
    next_to_send: AtomicU64,
    send_notify: Notify,
}

impl SokuSpeedSender {
    pub fn new(
        ingest_endpoint: Option<String>,
        allow_data_to_local: bool,
        auth_manager: Arc<AuthManager<FileStorage>>,
        pending_store: Arc<PendingStore>,
        retry_service: Arc<UploadRetryService>,
        cache_root_dir: PathBuf,
    ) -> Self {
        Self::new_with_local_root(
            ingest_endpoint,
            allow_data_to_local,
            None,
            auth_manager,
            pending_store,
            retry_service,
            cache_root_dir,
        )
    }

    fn new_with_local_root(
        ingest_endpoint: Option<String>,
        allow_data_to_local: bool,
        custom_local_root: Option<PathBuf>,
        auth_manager: Arc<AuthManager<FileStorage>>,
        pending_store: Arc<PendingStore>,
        retry_service: Arc<UploadRetryService>,
        cache_root_dir: PathBuf,
    ) -> Self {
        let (cache_file, local_cache_file) = cache_file_paths(&cache_root_dir);
        let local_sink = if allow_data_to_local {
            Some(LocalJsonlSink::new(
                custom_local_root,
                local_cache_file,
                crate::storage::common::soku_speed_jsonl_relative_path(),
                "soku_speed",
            ))
        } else {
            None
        };
        let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(
            7 * 24 * 60 * 60,
        )));
        if let Err(e) = cache.enable_persistence(cache_file) {
            tracing::warn!(error = %e, "failed to enable persistent soku_speed suppression cache");
        }
        Self {
            ingest_endpoint,
            auth_manager,
            pending_store,
            retry_service,
            cache,
            local_sink,
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build soku_speed_sender reqwest client"),
            next_seq: AtomicU64::new(0),
            next_to_send: AtomicU64::new(0),
            send_notify: Notify::new(),
        }
    }

    fn allocate_seq(&self) -> u64 {
        self.next_seq.fetch_add(1, Ordering::Relaxed)
    }

    fn payload_key() -> &'static str {
        "snapshot:soku_speed"
    }

    fn payload_hash(snapshot: &SokuSpeedObservedSnapshot) -> String {
        let mut canonical_entries: Vec<serde_json::Value> = snapshot
            .entries
            .iter()
            .map(|e| {
                let mut slots: Vec<serde_json::Value> = e
                    .slots
                    .iter()
                    .map(|s| serde_json::json!([s.slotitem_id, s.locked, s.level, s.alv,]))
                    .collect();
                // Keep deterministic order even if upstream slot ordering changes.
                slots.sort_unstable_by_key(|v| v.to_string());

                let exslot = e
                    .exslot
                    .as_ref()
                    .map(|s| serde_json::json!([s.slotitem_id, s.locked, s.level, s.alv]));

                serde_json::json!([e.master_id, e.lv, e.soku_observed, slots, exslot,])
            })
            .collect();
        canonical_entries.sort_unstable_by_key(|v| v.to_string());

        let payload = serde_json::to_vec(&canonical_entries).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(payload);
        format!("{:x}", hasher.finalize())
    }

    fn bytes_hash(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    async fn resolve_dataset_id(&self) -> Option<String> {
        let mut attempts = 0;
        while attempts < 15 {
            if let Some(dataset_id) =
                crate::util::resolve_dataset_id_for_current_member(&self.auth_manager).await
            {
                if !dataset_id.trim().is_empty() {
                    return Some(dataset_id);
                }
            }
            attempts += 1;
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        tracing::warn!("soku_speed_sender: resolve_dataset_id exhausted all 15 attempts");
        None
    }

    fn build_payload_value(
        upload_snapshot: &UploadSnapshot,
        payload_hash: &str,
        timestamp_ms: i64,
        period_tag: Option<&str>,
    ) -> serde_json::Value {
        serde_json::json!({
            "payload_hash": payload_hash,
            "event_type": "snapshot",
            "timestamp_ms": timestamp_ms,
            "period_tag": period_tag,
            "table_version": kc_api::database::DATABASE_TABLE_VERSION,
            "ships": &upload_snapshot.entries,
        })
    }

    async fn save_locally_if_new(
        &self,
        upload_snapshot: &UploadSnapshot,
        payload_hash: &str,
        timestamp_ms: i64,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let Some(sink) = &self.local_sink else {
            return Ok(false);
        };
        let period_tag = crate::auth::supabase::get_cached_period_tag().await;
        let payload = Self::build_payload_value(
            upload_snapshot,
            payload_hash,
            timestamp_ms,
            period_tag.as_deref(),
        );
        sink.write_if_new(
            Some(kc_api::database::DATABASE_TABLE_VERSION),
            Self::payload_key(),
            payload_hash,
            &payload,
        )
        .await
    }

    async fn send_remote_if_new(
        &self,
        upload_snapshot: &UploadSnapshot,
        payload_hash: &str,
        timestamp_ms: i64,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let Some(ingest_endpoint) = &self.ingest_endpoint else {
            return Ok(false);
        };

        let Some(period_tag) = crate::auth::supabase::get_period_tag().await else {
            tracing::warn!("soku_speed_sender: kc-period tag is unavailable; skipping upload to protect data integrity");
            return Err("kc-period tag is unavailable".into());
        };
        self.cache.rotate_scope(Some(&format!(
            "{}:{}",
            period_tag,
            kc_api::database::DATABASE_TABLE_VERSION
        )));

        if self.cache.should_skip(Self::payload_key(), payload_hash) {
            tracing::debug!("soku_speed_sender: suppression cache hit, skipping upload");
            return Ok(false);
        }

        let Some(dataset_id) = self.resolve_dataset_id().await else {
            return Err("dataset_id is empty".into());
        };

        let request_id = format!("soku-speed:{}:{}", dataset_id, Uuid::new_v4());
        let mut payload = Self::build_payload_value(
            upload_snapshot,
            payload_hash,
            timestamp_ms,
            Some(&period_tag),
        );
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "dataset_id".to_string(),
                serde_json::Value::String(dataset_id),
            );
            obj.insert(
                "request_id".to_string(),
                serde_json::Value::String(request_id),
            );
        }

        let data = serde_json::to_vec(&payload)?;
        let content_hash = Self::bytes_hash(&data);
        let mut handshake_body = payload.clone();
        if let Some(obj) = handshake_body.as_object_mut() {
            obj.insert(
                "file_size".to_string(),
                serde_json::Value::Number(serde_json::Number::from(data.len() as u64)),
            );
            obj.insert(
                "content_hash".to_string(),
                serde_json::Value::String(content_hash.clone()),
            );
        }

        let request = UploadRequest {
            endpoint: ingest_endpoint,
            handshake_body,
            data,
            headers: {
                let mut h = std::collections::HashMap::new();
                h.insert("content-hash".to_string(), content_hash);
                h
            },
            context: UploadContext::Custom(serde_json::json!({
                "operation": "soku_speed_ingest",
                "endpoint": ingest_endpoint,
                "payload_hash": payload_hash,
            })),
        };

        match Uploader::upload(
            &self.client,
            &self.auth_manager,
            request,
            Some(self.pending_store.as_ref()),
        )
        .await
        {
            Ok(_) => {
                self.cache
                    .mark_processed(Self::payload_key(), payload_hash.to_string());
                Ok(true)
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::other(e).into())
            }
        }
    }

    async fn process_snapshot(&self, snapshot: &SokuSpeedObservedSnapshot) -> Result<bool, Box<dyn std::error::Error>> {
        let payload_hash = Self::payload_hash(snapshot);
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let upload_snapshot = UploadSnapshot::from(snapshot.clone());

        if self.local_sink.is_some() {
            match self
                .save_locally_if_new(&upload_snapshot, &payload_hash, timestamp_ms)
                .await
            {
                Ok(true) => tracing::info!("soku_speed_sender saved snapshot to local jsonl"),
                Ok(false) => tracing::debug!("soku_speed_sender local jsonl save suppressed"),
                Err(e) => tracing::warn!(error = %e, "failed to save soku_speed snapshot locally"),
            }
        }

        if self.ingest_endpoint.is_some() {
            self.send_remote_if_new(&upload_snapshot, &payload_hash, timestamp_ms)
                .await
        } else {
            Ok(false)
        }
    }

    async fn submit(self: Arc<Self>, seq: u64, snapshot: SokuSpeedObservedSnapshot) {
        loop {
            let notified = self.send_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let turn = self.next_to_send.load(Ordering::Acquire);
            if turn == seq {
                break;
            }
            notified.await;
        }

        tracing::info!(
            seq,
            entries = snapshot.entries.len(),
            "soku_speed_sender event started"
        );
        match self.process_snapshot(&snapshot).await {
            Ok(true) => tracing::info!(seq, "soku_speed_sender event completed (sent)"),
            Ok(false) => tracing::info!(seq, "soku_speed_sender event completed (suppressed)"),
            Err(e) => tracing::warn!(error = %e, seq, "failed to send soku_speed snapshot"),
        }

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

fn cache_file_paths(cache_root_dir: &std::path::Path) -> (PathBuf, PathBuf) {
    (
        cache_root_dir.join("soku_speed_suppression_cache.json"),
        cache_root_dir.join("soku_speed_local_suppression_cache.json"),
    )
}

pub fn start(
    ingest_endpoint: Option<String>,
    allow_data_to_local: bool,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache_root_dir: PathBuf,
) {
    if ingest_endpoint.is_none() && !allow_data_to_local {
        return;
    }

    if SOKU_SPEED_SENDER.get().is_some() {
        tracing::info!("soku_speed sender already started");
        return;
    }

    let sender = Arc::new(SokuSpeedSender::new(
        ingest_endpoint,
        allow_data_to_local,
        auth_manager,
        pending_store,
        retry_service,
        cache_root_dir,
    ));

    if SOKU_SPEED_SENDER.set(sender).is_err() {
        tracing::warn!("failed to initialize soku_speed sender");
    }
}

pub fn enqueue_snapshot(snapshot: SokuSpeedObservedSnapshot) {
    if let Some(sender) = SOKU_SPEED_SENDER.get() {
        tracing::debug!(
            entries = snapshot.entries.len(),
            "soku_speed_sender: enqueue_snapshot called"
        );
        let sender = sender.clone();
        let seq = sender.allocate_seq();
        tokio::spawn(async move {
            sender.submit(seq, snapshot).await;
        });
    } else {
        tracing::warn!("soku_speed_sender: enqueue_snapshot called but sender is not initialized");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fusou_auth::manager::AuthConfig;
    use kc_api::interface::soku_speed_observed::{SlotComposition, SokuSpeedObservedEntry};

    fn make_test_sender(
        temp_dir: &std::path::Path,
        allow_data_to_local: bool,
    ) -> Arc<SokuSpeedSender> {
        let pending_store = Arc::new(PendingStore::new(temp_dir.join("pending")));
        let auth_manager = Arc::new(AuthManager::new(
            AuthConfig {
                supabase_url: "http://127.0.0.1:9".to_string(),
                api_key: "test-key".to_string(),
                refresh_path: "/auth/v1/token".to_string(),
                refresh_margin_secs: 30,
            },
            Arc::new(FileStorage::new(temp_dir.join("session.json"))),
        ));
        let retry_service = Arc::new(UploadRetryService::new(
            pending_store.clone(),
            auth_manager.clone(),
            None,
        ));

        Arc::new(SokuSpeedSender::new_with_local_root(
            None,
            allow_data_to_local,
            Some(temp_dir.join("local_storage")),
            auth_manager,
            pending_store,
            retry_service,
            temp_dir.join("cache"),
        ))
    }

    fn sample_snapshot(soku_observed: i64, slotitem_id: i64) -> SokuSpeedObservedSnapshot {
        SokuSpeedObservedSnapshot {
            entries: vec![SokuSpeedObservedEntry {
                master_id: 101,
                lv: 80,
                soku_observed,
                slots: vec![SlotComposition {
                    slotitem_id,
                    locked: true,
                    level: 0,
                    alv: 0,
                }],
                exslot: None,
            }],
        }
    }

    #[tokio::test]
    async fn local_save_writes_and_deduplicates_snapshots() {
        let temp_dir =
            std::env::temp_dir().join(format!("fusou-soku-speed-local-test-{}", Uuid::new_v4()));
        let sender = make_test_sender(&temp_dir, true);

        let snap1 = sample_snapshot(10, 33);
        sender.clone().submit(0, snap1.clone()).await;
        sender.clone().submit(1, snap1).await;
        sender.clone().submit(2, sample_snapshot(15, 34)).await;

        let jsonl_path = temp_dir
            .join("local_storage")
            .join(crate::storage::common::soku_speed_jsonl_relative_path());
        let content =
            std::fs::read_to_string(&jsonl_path).expect("soku_speed snapshots.jsonl should exist");
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);

        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["event_type"], "snapshot");
        assert_eq!(first["ships"][0]["soku_observed"], 10);
        assert_eq!(
            first["table_version"],
            kc_api::database::DATABASE_TABLE_VERSION
        );

        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["ships"][0]["soku_observed"], 15);
        assert_eq!(second["ships"][0]["slots"][0]["slotitem_id"], 34);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn local_save_disabled_writes_no_files() {
        let temp_dir = std::env::temp_dir().join(format!(
            "fusou-soku-speed-disabled-test-{}",
            Uuid::new_v4()
        ));
        let sender = make_test_sender(&temp_dir, false);
        sender.clone().submit(0, sample_snapshot(10, 33)).await;

        assert!(!temp_dir
            .join("local_storage")
            .join(crate::storage::common::soku_speed_jsonl_relative_path())
            .exists());
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
