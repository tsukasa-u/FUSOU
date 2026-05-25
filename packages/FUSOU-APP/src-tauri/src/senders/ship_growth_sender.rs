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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;
use uuid::Uuid;

static SHIP_GROWTH_SENDER: OnceCell<Arc<ShipGrowthSender>> = OnceCell::new();

enum ShipGrowthSendOutcome {
    Sent,
    Suppressed,
}

pub struct ShipGrowthSender {
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    /// Period-scoped cache for bounds data (level-by-level ASW/evasion/LoS per ship).
    /// Cleared when period_tag or table version changes.
    bounds_cache: Arc<LocalRequestSuppressionCache>,
    /// Version-scoped cache for exp and caps (global level↔exp table and per-ship max params).
    /// Cleared only on table version change.
    version_cache: Arc<LocalRequestSuppressionCache>,
    client: reqwest::Client,
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
        let (bounds_cache_file, version_cache_file) = cache_file_paths(cache_root_dir);
        Self {
            ingest_endpoint,
            auth_manager,
            pending_store,
            retry_service,
            bounds_cache: {
                // bounds data (lv-by-lv ASW/evasion/LoS per ship) is game-static within a period.
                // Use a long TTL and rely entirely on rotate_scope(period_tag:version) for cross-period
                // invalidation rather than expiring mid-session.
                let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(
                    7 * 24 * 60 * 60,
                )));
                if let Err(e) = cache.enable_persistence(bounds_cache_file) {
                    tracing::warn!(error = %e, "failed to enable persistent ship growth bounds suppression cache");
                }
                cache
            },
            version_cache: {
                // exp (level↔exp table) and caps (per-ship max params) are stable across periods;
                // only invalidate when table version changes.
                let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(
                    7 * 24 * 60 * 60,
                )));
                if let Err(e) = cache.enable_persistence(version_cache_file) {
                    tracing::warn!(error = %e, "failed to enable persistent ship growth version suppression cache");
                }
                cache
            },
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build ship_growth_sender reqwest client"),
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

    fn snapshot_payload_key() -> &'static str {
        "snapshot:payload"
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

        let payload = serde_json::to_vec(&boundaries).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to serialize boundaries for suppression hash");
            Vec::new()
        });
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

        let payload = serde_json::to_vec(&boundary_lvs).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to serialize boundary_lvs for suppression hash");
            Vec::new()
        });
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

        let payload = serde_json::to_vec(&master_ids).unwrap_or_else(|e| {
            tracing::error!(error = %e, "failed to serialize master_ids for suppression hash");
            Vec::new()
        });
        let mut hasher = Sha256::new();
        hasher.update(payload);
        format!("{:x}", hasher.finalize())
    }

    fn payload_hash(snapshot: &ShipGrowthSnapshot) -> String {
        // Suppression is based on master_id + level only.
        // Keep multiplicity (do not dedup) so level-up of one ship is observable
        // even when another ship already has the same target level.
        // Period is handled by cache scope rotation (period_tag:table_version).
        let upload_snapshot = UploadShipGrowthSnapshot::from(snapshot.clone());
        let mut normalized: Vec<(i64, i64)> = upload_snapshot
            .entries
            .into_iter()
            .map(|entry| (entry.master_id, entry.lv))
            .collect();
        normalized.sort_unstable();
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

    fn validate_exp_entries(
        snapshot: &ShipGrowthSnapshot,
    ) -> Result<(), Box<dyn std::error::Error>> {
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

            // exp_to_next is None or negative for some ships (e.g. missing data): skip
            // those entries rather than rejecting the entire snapshot.
            let exp_to_next = match entry.exp_to_next {
                Some(v) if v >= 0 => v,
                Some(v) => {
                    tracing::debug!(
                        index,
                        master_id = entry.master_id,
                        lv = entry.lv,
                        exp_to_next = v,
                        "skipping exp boundary check: negative exp_to_next"
                    );
                    continue;
                }
                None => {
                    tracing::debug!(
                        index,
                        master_id = entry.master_id,
                        lv = entry.lv,
                        "skipping exp boundary check: exp_to_next missing"
                    );
                    continue;
                }
            };

            // At max level exp_to_next == 0. The "boundary" (exp_current + 0) then equals
            // the ship's own accumulated EXP and is unique per ship, so there is no shared
            // next-level boundary to check consistency against. Skip max-level ships.
            if exp_to_next == 0 {
                continue;
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
            let dataset_id = self
                .auth_manager
                .resolve_dataset_id_for_upload(None)
                .await
                .unwrap_or_default();
            tracing::debug!(
                attempts,
                empty = dataset_id.trim().is_empty(),
                "ship_growth_sender: resolve_dataset_id poll"
            );
            if !dataset_id.trim().is_empty() {
                return Some(dataset_id);
            }
            attempts += 1;
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        tracing::warn!("ship_growth_sender: resolve_dataset_id exhausted all 15 attempts");
        None
    }

    async fn send_if_new(
        &self,
        snapshot: &ShipGrowthSnapshot,
    ) -> Result<ShipGrowthSendOutcome, Box<dyn std::error::Error>> {
        tracing::debug!(
            entries = snapshot.entries.len(),
            "ship_growth_sender: validating exp entries"
        );
        Self::validate_exp_entries(snapshot)?;

        tracing::debug!("ship_growth_sender: computing hashes");
        let payload_hash = Self::payload_hash(snapshot);
        let exp_hash = Self::exp_suppression_hash(snapshot);
        let bounds_hash = Self::bounds_suppression_hash(snapshot);
        let caps_hash = Self::caps_suppression_hash(snapshot);

        tracing::debug!("ship_growth_sender: fetching period tag");
        let period_tag = crate::auth::supabase::get_period_tag().await;
        tracing::debug!(period_tag = %period_tag, "ship_growth_sender: period tag resolved");
        // bounds are period-scoped: clear on period_tag OR table version change
        self.bounds_cache.rotate_scope(Some(&format!(
            "{}:{}",
            period_tag,
            kc_api::database::DATABASE_TABLE_VERSION
        )));
        // exp and caps are version-scoped: clear only on table version change
        self.version_cache
            .rotate_scope(Some(kc_api::database::DATABASE_TABLE_VERSION));

        let skip_exp = self
            .version_cache
            .should_skip(Self::exp_payload_key(), &exp_hash);
        let skip_bounds = self
            .bounds_cache
            .should_skip(Self::bounds_payload_key(), &bounds_hash);
        let skip_caps = self
            .version_cache
            .should_skip(Self::caps_payload_key(), &caps_hash);
        let skip_payload = self
            .bounds_cache
            .should_skip(Self::snapshot_payload_key(), &payload_hash);

        if skip_exp && skip_bounds && skip_caps && skip_payload {
            tracing::debug!(
                skip_exp,
                skip_bounds,
                skip_caps,
                skip_payload,
                scope = %format!("{}:{}", period_tag, kc_api::database::DATABASE_TABLE_VERSION),
                "ship_growth_sender: suppression cache hit, skipping upload"
            );
            return Ok(ShipGrowthSendOutcome::Suppressed);
        }
        tracing::debug!(
            skip_exp,
            skip_bounds,
            skip_caps,
            skip_payload,
            scope = %format!("{}:{}", period_tag, kc_api::database::DATABASE_TABLE_VERSION),
            "ship_growth_sender: suppression cache miss, proceeding with upload"
        );

        tracing::debug!("ship_growth_sender: resolving dataset_id");
        let Some(dataset_id) = self.resolve_dataset_id().await else {
            tracing::warn!("ship_growth_sender: dataset_id empty after retries");
            return Err("dataset_id is empty".into());
        };
        tracing::debug!("ship_growth_sender: dataset_id resolved, building upload request");

        let request_id = format!("ship-growth:{}:{}", dataset_id, Uuid::new_v4());
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let mut upload_snapshot = UploadShipGrowthSnapshot::from(snapshot.clone());
        // The server validates exp_to_next as a non-null integer.
        // Normalize None → 0 (semantically: max-level ship has 0 exp until next boundary).
        for entry in &mut upload_snapshot.entries {
            if entry.exp_to_next.is_none() {
                entry.exp_to_next = Some(0);
            }
        }

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

        match Uploader::upload(
            &self.client,
            &self.auth_manager,
            request,
            Some(self.pending_store.as_ref()),
        )
        .await
        {
            Ok(_) => {
                tracing::debug!("ship_growth_sender: upload succeeded, marking cache");
                self.version_cache
                    .mark_processed(Self::exp_payload_key(), exp_hash);
                self.bounds_cache
                    .mark_processed(Self::bounds_payload_key(), bounds_hash);
                self.version_cache
                    .mark_processed(Self::caps_payload_key(), caps_hash);
                self.bounds_cache
                    .mark_processed(Self::snapshot_payload_key(), payload_hash);
                Ok(ShipGrowthSendOutcome::Sent)
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::new(std::io::ErrorKind::Other, e).into())
            }
        }
    }

    async fn submit(self: Arc<Self>, seq: u64, snapshot: ShipGrowthSnapshot) {
        loop {
            // Subscribe BEFORE checking the condition to prevent a missed-wakeup race:
            // if notify_waiters() fires between the load() and notified().await, the
            // notification would be lost and this task would hang forever.
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
            "ship_growth_sender event started"
        );
        match self.send_if_new(&snapshot).await {
            Ok(ShipGrowthSendOutcome::Sent) => {
                tracing::info!(seq, "ship_growth_sender event completed (sent)");
            }
            Ok(ShipGrowthSendOutcome::Suppressed) => {
                tracing::info!(seq, "ship_growth_sender event completed (suppressed)");
            }
            Err(e) => {
                tracing::warn!(error = %e, seq, "failed to send ship growth snapshot");
                tracing::info!(seq, "ship_growth_sender event completed (failed)");
            }
        }

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

fn cache_file_paths(cache_root_dir: PathBuf) -> (PathBuf, PathBuf) {
    (
        cache_root_dir.join("ship_growth_bounds_suppression_cache.json"),
        cache_root_dir.join("ship_growth_version_suppression_cache.json"),
    )
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
        tracing::debug!(
            entries = snapshot.entries.len(),
            "ship_growth_sender: enqueue_snapshot called"
        );
        let sender = sender.clone();
        let seq = sender.allocate_seq();
        tokio::spawn(async move {
            sender.submit(seq, snapshot).await;
        });
    } else {
        tracing::warn!("ship_growth_sender: enqueue_snapshot called but sender is not initialized");
    }
}

#[derive(Clone)]
pub struct ShipGrowthSuppressionStatus {
    pub scope: Option<String>,
    pub entries: Vec<SuppressionCacheEntryStatus>,
}

pub fn get_suppression_status() -> Option<ShipGrowthSuppressionStatus> {
    SHIP_GROWTH_SENDER.get().map(|sender| {
        let SuppressionCacheStatus { scope, mut entries } = sender.bounds_cache.snapshot_status();
        let SuppressionCacheStatus {
            entries: version_entries,
            ..
        } = sender.version_cache.snapshot_status();
        entries.extend(version_entries);
        ShipGrowthSuppressionStatus { scope, entries }
    })
}
