use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{
    LocalRequestSuppressionCache, PendingStore, SuppressionCacheEntryStatus,
    SuppressionCacheStatus, UploadContext, UploadRequest, UploadRetryService, Uploader,
};
use kc_api::database::models::remodel::{RemodelDetailUpload, RemodelSlotListUpload};
use kc_api::interface::remodel::{RemodelDetail, RemodelSlotList};
use once_cell::sync::OnceCell;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;
use uuid::Uuid;

static REMODEL_SENDER: OnceCell<Arc<RemodelSender>> = OnceCell::new();

enum RemodelPacket {
    SlotList(RemodelSlotList),
    Detail(RemodelDetail),
}

pub struct RemodelSender {
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    request_cache: Arc<LocalRequestSuppressionCache>,
    client: reqwest::Client,
    next_seq: AtomicU64,
    next_to_send: AtomicU64,
    send_notify: Notify,
}

impl RemodelSender {
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
                // remodel data is cross-period; use a long TTL so the same payload is not
                // re-sent every 10 minutes within the same session.
                let cache =
                    Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(7 * 24 * 60 * 60)));
                if let Err(e) = cache.enable_persistence(cache_file) {
                    tracing::warn!(
                        error = %e,
                        "failed to enable persistent remodel suppression cache"
                    );
                }
                cache
            },
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build remodel_sender reqwest client"),
            next_seq: AtomicU64::new(0),
            next_to_send: AtomicU64::new(0),
            send_notify: Notify::new(),
        }
    }

    fn allocate_seq(&self) -> u64 {
        self.next_seq.fetch_add(1, Ordering::Relaxed)
    }

    fn payload_key(packet: &RemodelPacket) -> String {
        match packet {
            RemodelPacket::SlotList(v) => {
                format!("slotlist:{}:{}", v.secretary_ship_master_id, v.weekday_jst)
            }
            RemodelPacket::Detail(d) => {
                format!("detail:{}:{}", d.slotitem_master_id, d.remodel_id)
            }
        }
    }

    fn event_type(packet: &RemodelPacket) -> &'static str {
        match packet {
            RemodelPacket::SlotList(_) => "slotlist",
            RemodelPacket::Detail(_) => "detail",
        }
    }

    fn payload_hash(packet: &RemodelPacket) -> String {
        let json = match packet {
            RemodelPacket::SlotList(v) => serde_json::to_string(v).unwrap_or_default(),
            RemodelPacket::Detail(d) => serde_json::to_string(d).unwrap_or_default(),
        };
        let digest = Sha256::digest(json.as_bytes());
        hex::encode(digest)
    }

    fn bytes_hash(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    async fn resolve_dataset_id(&self) -> Option<String> {
        let mut attempts = 0;
        while attempts < 15 {
            if let Some(dataset_id) = self.auth_manager.resolve_dataset_id_for_upload(None).await {
                if !dataset_id.trim().is_empty() {
                    return Some(dataset_id);
                }
            }
            attempts += 1;
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        None
    }

    async fn send_if_new(
        &self,
        packet: &RemodelPacket,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let p_key = Self::payload_key(packet);
        let p_hash = Self::payload_hash(packet);
        let evt = Self::event_type(packet);

        let period_tag = crate::auth::supabase::get_period_tag().await;
        // remodel data is cross-period: only invalidate on table version change
        self.request_cache.rotate_scope(Some(kc_api::database::DATABASE_TABLE_VERSION));

        if self.request_cache.should_skip(&p_key, &p_hash) {
            return Ok(());
        }

        let Some(dataset_id) = self.resolve_dataset_id().await else {
            return Err("dataset_id is empty".into());
        };

        let request_id = format!("remodel:{}:{}:{}", dataset_id, evt, Uuid::new_v4());
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let payload = match packet {
            RemodelPacket::SlotList(v) => {
                let upload = RemodelSlotListUpload::from(v.clone());
                serde_json::json!({
                    "dataset_id": dataset_id,
                    "request_id": request_id,
                    "payload_hash": p_hash,
                    "event_type": evt,
                    "timestamp_ms": timestamp_ms,
                    "period_tag": period_tag,
                    "table_version": kc_api::database::DATABASE_TABLE_VERSION,
                    "secretary_ship_master_id": upload.secretary_ship_master_id,
                    "weekday_jst": upload.weekday_jst,
                    "entries": upload.entries,
                })
            }
            RemodelPacket::Detail(d) => {
                let upload = RemodelDetailUpload::from(d.clone());
                serde_json::json!({
                    "dataset_id": dataset_id,
                    "request_id": request_id,
                    "payload_hash": p_hash,
                    "event_type": evt,
                    "timestamp_ms": timestamp_ms,
                    "period_tag": period_tag,
                    "table_version": kc_api::database::DATABASE_TABLE_VERSION,
                    "slotitem_master_id": upload.slotitem_master_id,
                    "remodel_id": upload.remodel_id,
                    "certain_buildkit": upload.certain_buildkit,
                    "certain_remodelkit": upload.certain_remodelkit,
                    "change_flag": upload.change_flag,
                    "req_useitem_id": upload.req_useitem_id,
                    "req_useitem_id2": upload.req_useitem_id2,
                    "req_useitem_num": upload.req_useitem_num,
                    "req_useitem_num2": upload.req_useitem_num2,
                })
            }
        };

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
                "operation": "remodel_data_ingest",
                "endpoint": self.ingest_endpoint,
                "payload_hash": p_hash,
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
                self.request_cache.mark_processed(&p_key, p_hash);
                Ok(())
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::new(std::io::ErrorKind::Other, e).into())
            }
        }
    }

    async fn submit(self: Arc<Self>, seq: u64, packet: RemodelPacket) {
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

        if let Err(e) = self.send_if_new(&packet).await {
            tracing::warn!(error = %e, "failed to send remodel data");
        }

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

fn cache_file_path(cache_root_dir: PathBuf) -> PathBuf {
    cache_root_dir.join("remodel_request_suppression_cache.json")
}

pub fn start(
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache_root_dir: PathBuf,
) {
    if REMODEL_SENDER.get().is_some() {
        tracing::info!("remodel sender already started");
        return;
    }

    let sender = Arc::new(RemodelSender::new(
        ingest_endpoint,
        auth_manager,
        pending_store,
        retry_service,
        cache_root_dir,
    ));

    if REMODEL_SENDER.set(sender).is_err() {
        tracing::warn!("failed to initialize remodel sender");
    }
}

pub fn enqueue_slotlist(data: RemodelSlotList) {
    if let Some(sender) = REMODEL_SENDER.get() {
        let sender = sender.clone();
        let seq = sender.allocate_seq();
        tokio::spawn(async move {
            sender.submit(seq, RemodelPacket::SlotList(data)).await;
        });
    }
}

pub fn enqueue_detail(data: RemodelDetail) {
    if let Some(sender) = REMODEL_SENDER.get() {
        let sender = sender.clone();
        let seq = sender.allocate_seq();
        tokio::spawn(async move {
            sender.submit(seq, RemodelPacket::Detail(data)).await;
        });
    }
}

#[derive(Clone)]
pub struct RemodelSuppressionStatus {
    pub scope: Option<String>,
    pub entries: Vec<SuppressionCacheEntryStatus>,
}

pub fn get_suppression_status() -> Option<RemodelSuppressionStatus> {
    REMODEL_SENDER.get().map(|sender| {
        let SuppressionCacheStatus { scope, entries } = sender.request_cache.snapshot_status();
        RemodelSuppressionStatus { scope, entries }
    })
}
