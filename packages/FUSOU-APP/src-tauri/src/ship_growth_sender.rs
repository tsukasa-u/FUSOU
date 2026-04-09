use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{
    LocalRequestSuppressionCache, PendingStore, SuppressionCacheEntryStatus,
    SuppressionCacheStatus, UploadContext, UploadRequest, UploadRetryService, Uploader,
};
use kc_api::database::models::ship_growth::ShipGrowthSnapshot as UploadShipGrowthSnapshot;
use kc_api::interface::ship_growth::ShipGrowthSnapshot;
use once_cell::sync::OnceCell;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use std::time::Duration;
use tokio::sync::Notify;
use uuid::Uuid;

static SHIP_GROWTH_SENDER: OnceCell<Arc<ShipGrowthSender>> = OnceCell::new();

pub struct ShipGrowthSender {
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    request_cache: Arc<LocalRequestSuppressionCache>,
    next_seq: AtomicU64,
    next_to_send: AtomicU64,
    send_notify: Notify,
}

impl ShipGrowthSender {
    pub fn new(
        ingest_endpoint: String,
        auth_manager: Arc<AuthManager<FileStorage>>,
        pending_store: Arc<PendingStore>,
        retry_service: Arc<UploadRetryService>,
        cache_root_dir: PathBuf,
    ) -> Self {
        let cache_file = cache_file_path(cache_root_dir);
        Self {
            ingest_endpoint,
            auth_manager,
            pending_store,
            retry_service,
            request_cache: {
                let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(10 * 60)));
                if let Err(e) = cache.enable_persistence(cache_file) {
                    tracing::warn!(error = %e, "failed to enable persistent ship growth suppression cache");
                }
                cache
            },
            next_seq: AtomicU64::new(0),
            next_to_send: AtomicU64::new(0),
            send_notify: Notify::new(),
        }
    }

    fn allocate_seq(&self) -> u64 {
        self.next_seq.fetch_add(1, Ordering::Relaxed)
    }

    fn exp_payload_key() -> &'static str {
        "snapshot:exp"
    }

    fn bounds_payload_key() -> &'static str {
        "snapshot:bounds"
    }

    fn caps_payload_key() -> &'static str {
        "snapshot:caps"
    }

    fn bounds_suppression_hash(snapshot: &ShipGrowthSnapshot) -> String {
        // Parameter bounds are determined by master_id + lv within a period.
        // Suppression key: set of (master_id, lv) pairs observed (period via cache scope).
        let mut boundaries: Vec<(i64, i64)> = snapshot
            .entries
            .iter()
            .map(|entry| (entry.master_id, entry.lv))
            .collect();
        boundaries.sort_unstable();
        boundaries.dedup();

        let payload = serde_json::to_vec(&boundaries).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(payload);
        format!("{:x}", hasher.finalize())
    }

    fn exp_suppression_hash(snapshot: &ShipGrowthSnapshot) -> String {
        // EXP boundaries are global (not per ship type), keyed by boundary_lv (= current_lv + 1).
        // Suppression key: set of observed boundary_lvs (period via cache scope).
        // validate_exp_entries guarantees exp_to_next is present and non-negative before this is called.
        let mut boundary_lvs: Vec<i64> = snapshot
            .entries
            .iter()
            .map(|entry| entry.lv.saturating_add(1))
            .collect();
        boundary_lvs.sort_unstable();
        boundary_lvs.dedup();

        let payload = serde_json::to_vec(&boundary_lvs).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(payload);
        format!("{:x}", hasher.finalize())
    }

    fn caps_suppression_hash(snapshot: &ShipGrowthSnapshot) -> String {
        // Caps are fixed per master_id within a period.
        // Suppression key: set of observed master_ids (period via cache scope).
        let mut master_ids: Vec<i64> = snapshot
            .entries
            .iter()
            .map(|entry| entry.master_id)
            .collect();
        master_ids.sort_unstable();
        master_ids.dedup();

        let payload = serde_json::to_vec(&master_ids).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(payload);
        format!("{:x}", hasher.finalize())
    }

    fn payload_hash(snapshot: &ShipGrowthSnapshot) -> String {
        // Upload the database-model snapshot so Cloudflare can reconstruct observed values,
        // kyouka, and slot improvement data even when normalization rules evolve later.
        let upload_snapshot = UploadShipGrowthSnapshot::from(snapshot.clone());
        let mut normalized = upload_snapshot.entries;
        normalized.sort_by(|a, b| {
            a.master_id
                .cmp(&b.master_id)
                .then(a.lv.cmp(&b.lv))
                .then(a.exp_current.cmp(&b.exp_current))
                .then(a.exp_to_next.cmp(&b.exp_to_next))
                .then(a.kaihi_observed.cmp(&b.kaihi_observed))
                .then(a.taisen_observed.cmp(&b.taisen_observed))
                .then(a.sakuteki_observed.cmp(&b.sakuteki_observed))
                .then(a.kaihi_naked.cmp(&b.kaihi_naked))
                .then(a.taisen_naked.cmp(&b.taisen_naked))
                .then(a.sakuteki_naked.cmp(&b.sakuteki_naked))
                .then(a.kaihi_max.cmp(&b.kaihi_max))
                .then(a.taisen_max.cmp(&b.taisen_max))
                .then(a.sakuteki_max.cmp(&b.sakuteki_max))
        });
        let payload = serde_json::to_vec(&normalized).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(payload);
        format!("{:x}", hasher.finalize())
    }

    fn bytes_hash(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    fn validate_exp_entries(snapshot: &ShipGrowthSnapshot) -> Result<(), Box<dyn std::error::Error>> {
        let mut boundary_by_lv = std::collections::BTreeMap::<i64, i64>::new();
        for (index, entry) in snapshot.entries.iter().enumerate() {
            if entry.lv <= 0 {
                return Err(format!(
                    "invalid ship growth exp entry at index {}: master_id={}, lv={} (lv must be > 0)",
                    index, entry.master_id, entry.lv
                )
                .into());
            }
            if entry.exp_current < 0 {
                return Err(format!(
                    "invalid ship growth exp entry at index {}: master_id={}, lv={}, exp_current={} (must be >= 0)",
                    index, entry.master_id, entry.lv, entry.exp_current
                )
                .into());
            }
            let Some(exp_to_next) = entry.exp_to_next else {
                return Err(format!(
                    "invalid ship growth exp entry at index {}: master_id={}, lv={} missing exp_to_next",
                    index, entry.master_id, entry.lv
                )
                .into());
            };
            if exp_to_next < 0 {
                return Err(format!(
                    "invalid ship growth exp entry at index {}: master_id={}, lv={}, exp_to_next={} (must be >= 0)",
                    index, entry.master_id, entry.lv, exp_to_next
                )
                .into());
            }

            let boundary_lv = entry.lv.saturating_add(1);
            let boundary = entry.exp_current.saturating_add(exp_to_next);
            if let Some(existing) = boundary_by_lv.get(&boundary_lv) {
                if *existing != boundary {
                    return Err(format!(
                        "inconsistent exp boundary for boundary_lv={}: expected={}, actual={} (index={}, master_id={}, current_lv={})",
                        boundary_lv, *existing, boundary, index, entry.master_id, entry.lv
                    )
                    .into());
                }
            } else {
                boundary_by_lv.insert(boundary_lv, boundary);
            }
        }
        Ok(())
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
        None
    }

    async fn send_if_new(
        &self,
        snapshot: &ShipGrowthSnapshot,
    ) -> Result<(), Box<dyn std::error::Error>> {
        Self::validate_exp_entries(snapshot)?;

        let payload_hash = Self::payload_hash(snapshot);
        let exp_hash = Self::exp_suppression_hash(snapshot);
        let bounds_hash = Self::bounds_suppression_hash(snapshot);
        let caps_hash = Self::caps_suppression_hash(snapshot);

        let period_tag = crate::auth::supabase::get_period_tag().await;
        self.request_cache.rotate_scope(Some(&format!(
            "{}:{}",
            period_tag,
            kc_api::database::DATABASE_TABLE_VERSION
        )));

        let skip_exp = self
            .request_cache
            .should_skip(Self::exp_payload_key(), &exp_hash);
        let skip_bounds = self
            .request_cache
            .should_skip(Self::bounds_payload_key(), &bounds_hash);
        let skip_caps = self
            .request_cache
            .should_skip(Self::caps_payload_key(), &caps_hash);

        if skip_exp && skip_bounds && skip_caps {
            return Ok(());
        }

        let Some(dataset_id) = self.resolve_dataset_id().await else {
            return Err("dataset_id is empty".into());
        };

        let request_id = format!("ship-growth:{}:{}", dataset_id, Uuid::new_v4());
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let upload_snapshot = UploadShipGrowthSnapshot::from(snapshot.clone());

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
                h.insert("content-hash".to_string(), content_hash.clone());
                h
            },
            context: UploadContext::Custom(serde_json::json!({
                "operation": "ship_growth_ingest",
                "endpoint": self.ingest_endpoint,
                "payload_hash": payload_hash,
            })),
        };

        let client = reqwest::Client::new();
        match Uploader::upload(
            &client,
            &self.auth_manager,
            request,
            Some(self.pending_store.as_ref()),
        )
        .await
        {
            Ok(_) => {
                self.request_cache
                    .mark_processed(Self::exp_payload_key(), exp_hash);
                self.request_cache
                    .mark_processed(Self::bounds_payload_key(), bounds_hash);
                self.request_cache
                    .mark_processed(Self::caps_payload_key(), caps_hash);
                Ok(())
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::new(std::io::ErrorKind::Other, e).into())
            }
        }
    }

    async fn submit(self: Arc<Self>, seq: u64, snapshot: ShipGrowthSnapshot) {
        loop {
            let turn = self.next_to_send.load(Ordering::Acquire);
            if turn == seq {
                break;
            }
            self.send_notify.notified().await;
        }

        if let Err(e) = self.send_if_new(&snapshot).await {
            tracing::warn!(error = %e, "failed to send ship growth snapshot");
        }

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

fn cache_file_path(cache_root_dir: PathBuf) -> PathBuf {
    cache_root_dir.join("ship_growth_request_suppression_cache.json")
}

pub fn start(
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache_root_dir: PathBuf,
) {
    if SHIP_GROWTH_SENDER.get().is_some() {
        tracing::info!("ship growth sender already started");
        return;
    }

    let sender = Arc::new(ShipGrowthSender::new(
        ingest_endpoint,
        auth_manager,
        pending_store,
        retry_service,
        cache_root_dir,
    ));

    if SHIP_GROWTH_SENDER.set(sender).is_err() {
        tracing::warn!("failed to initialize ship growth sender");
    }
}

pub fn enqueue_snapshot(snapshot: ShipGrowthSnapshot) {
    if let Some(sender) = SHIP_GROWTH_SENDER.get() {
        let sender = sender.clone();
        let seq = sender.allocate_seq();
        tokio::spawn(async move {
            sender.submit(seq, snapshot).await;
        });
    }
}

#[derive(Clone)]
pub struct ShipGrowthSuppressionStatus {
    pub scope: Option<String>,
    pub entries: Vec<SuppressionCacheEntryStatus>,
}

pub fn get_suppression_status() -> Option<ShipGrowthSuppressionStatus> {
    SHIP_GROWTH_SENDER.get().map(|sender| {
        let SuppressionCacheStatus { scope, entries } = sender.request_cache.snapshot_status();
        ShipGrowthSuppressionStatus { scope, entries }
    })
}
