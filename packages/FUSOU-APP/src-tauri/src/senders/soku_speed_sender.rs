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
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache: Arc<LocalRequestSuppressionCache>,
    client: reqwest::Client,
    next_seq: AtomicU64,
    next_to_send: AtomicU64,
    send_notify: Notify,
}

impl SokuSpeedSender {
    pub fn new(
        ingest_endpoint: String,
        auth_manager: Arc<AuthManager<FileStorage>>,
        pending_store: Arc<PendingStore>,
        retry_service: Arc<UploadRetryService>,
        cache_root_dir: PathBuf,
    ) -> Self {
        let cache_file = cache_root_dir.join("soku_speed_suppression_cache.json");
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
                    .map(|s| {
                        serde_json::json!([
                            s.slotitem_id,
                            s.locked,
                            s.level,
                            s.alv,
                        ])
                    })
                    .collect();
                // Keep deterministic order even if upstream slot ordering changes.
                slots.sort_unstable_by_key(|v| v.to_string());

                let exslot = e
                    .exslot
                    .as_ref()
                    .map(|s| serde_json::json!([s.slotitem_id, s.locked, s.level, s.alv]));

                serde_json::json!([
                    e.master_id,
                    e.lv,
                    e.soku_observed,
                    slots,
                    exslot,
                ])
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
            let dataset_id = crate::util::get_user_member_id().await;
            if !dataset_id.trim().is_empty() {
                return Some(dataset_id);
            }
            attempts += 1;
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        tracing::warn!("soku_speed_sender: resolve_dataset_id exhausted all 15 attempts");
        None
    }

    async fn send_if_new(
        &self,
        snapshot: &SokuSpeedObservedSnapshot,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let payload_hash = Self::payload_hash(snapshot);

        let period_tag = crate::auth::supabase::get_period_tag().await;
        self.cache.rotate_scope(Some(&format!(
            "{}:{}",
            period_tag,
            kc_api::database::DATABASE_TABLE_VERSION
        )));

        if self
            .cache
            .should_skip(Self::payload_key(), &payload_hash)
        {
            tracing::debug!("soku_speed_sender: suppression cache hit, skipping upload");
            return Ok(false);
        }

        let Some(dataset_id) = self.resolve_dataset_id().await else {
            return Err("dataset_id is empty".into());
        };

        let request_id = format!("soku-speed:{}:{}", dataset_id, Uuid::new_v4());
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let upload_snapshot = UploadSnapshot::from(snapshot.clone());

        let payload = serde_json::json!({
            "dataset_id": dataset_id,
            "request_id": request_id,
            "payload_hash": payload_hash,
            "event_type": "snapshot",
            "timestamp_ms": timestamp_ms,
            "period_tag": period_tag,
            "table_version": kc_api::database::DATABASE_TABLE_VERSION,
            "ships": upload_snapshot.entries,
        });

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
            endpoint: &self.ingest_endpoint,
            handshake_body,
            data,
            headers: {
                let mut h = std::collections::HashMap::new();
                h.insert("content-hash".to_string(), content_hash);
                h
            },
            context: UploadContext::Custom(serde_json::json!({
                "operation": "soku_speed_ingest",
                "endpoint": self.ingest_endpoint,
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
                    .mark_processed(Self::payload_key(), payload_hash);
                Ok(true)
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::other(e).into())
            }
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
        match self.send_if_new(&snapshot).await {
            Ok(true) => tracing::info!(seq, "soku_speed_sender event completed (sent)"),
            Ok(false) => tracing::info!(seq, "soku_speed_sender event completed (suppressed)"),
            Err(e) => tracing::warn!(error = %e, seq, "failed to send soku_speed snapshot"),
        }

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

pub fn start(
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache_root_dir: PathBuf,
) {
    if SOKU_SPEED_SENDER.get().is_some() {
        tracing::info!("soku_speed sender already started");
        return;
    }

    let sender = Arc::new(SokuSpeedSender::new(
        ingest_endpoint,
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
