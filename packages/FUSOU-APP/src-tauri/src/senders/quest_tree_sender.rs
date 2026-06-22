use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{
    LocalRequestSuppressionCache, PendingStore, SuppressionCacheEntryStatus,
    SuppressionCacheStatus, UploadContext, UploadRequest, UploadRetryService, Uploader,
};
use kc_api::database::models::quest::{QuestIngestEvent, QuestIngestSnapshot};
use kc_api::interface::quest::{QuestEvent, Quests};
use once_cell::sync::OnceCell;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::Notify;
use uuid::Uuid;

#[derive(Debug, Clone)]
enum QuestPacket {
    Event(QuestEvent),
    Snapshot(Quests),
}

static QUEST_TREE_SENDER: OnceCell<Arc<QuestTreeSender>> = OnceCell::new();

pub struct QuestTreeSender {
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

impl QuestTreeSender {
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
                // quest tree data is cross-period; use a long TTL so the same payload is not
                // re-sent every 10 minutes within the same session.
                let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(7 * 24 * 60 * 60)));
                if let Err(e) = cache.enable_persistence(cache_file) {
                    tracing::warn!(error = %e, "failed to enable persistent quest suppression cache");
                }
                cache
            },
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build quest_tree_sender reqwest client"),
            next_seq: AtomicU64::new(0),
            next_to_send: AtomicU64::new(0),
            send_notify: Notify::new(),
        }
    }

    fn allocate_seq(&self) -> u64 {
        self.next_seq.fetch_add(1, Ordering::Relaxed)
    }

    fn packet_event_type(packet: &QuestPacket) -> &str {
        match packet {
            QuestPacket::Event(event) => event.event_type.as_str(),
            QuestPacket::Snapshot(_) => "snapshot",
        }
    }

    fn payload_key(packet: &QuestPacket) -> String {
        match packet {
            QuestPacket::Event(event) => {
                let converted = QuestIngestEvent::from(event.clone());
                format!(
                    "{}:{}",
                    converted.event_type,
                    converted.quest_id.map(|x| x.to_string()).unwrap_or_default()
                )
            }
            QuestPacket::Snapshot(snapshot) => {
                let converted = QuestIngestSnapshot::from(snapshot.clone());
                format!("snapshot:{}", converted.page_no)
            }
        }
    }

    fn payload_hash(packet: &QuestPacket) -> String {
        let payload = match packet {
            QuestPacket::Event(event) => {
                serde_json::to_vec(&QuestIngestEvent::from(event.clone())).unwrap_or_else(|e| {
                    tracing::error!(error = %e, "failed to serialize quest event for suppression hash");
                    Vec::new()
                })
            }
            QuestPacket::Snapshot(snapshot) => {
                let mut converted = QuestIngestSnapshot::from(snapshot.clone());
                // Ignore volatile timestamp for suppression hash.
                converted.timestamp_ms = 0;
                serde_json::to_vec(&converted).unwrap_or_else(|e| {
                    tracing::error!(error = %e, "failed to serialize quest snapshot for suppression hash");
                    Vec::new()
                })
            }
        };
        let mut hasher = Sha256::new();
        hasher.update(payload);
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

    async fn send_if_new(&self, packet: &QuestPacket) -> Result<(), Box<dyn std::error::Error>> {
        let key = Self::payload_key(packet);
        let payload_hash = Self::payload_hash(packet);
        let event_type = Self::packet_event_type(packet).to_string();

        let period_tag = crate::auth::supabase::get_period_tag().await;
        // quest tree data is cross-period: only invalidate on table version change
        self.request_cache.rotate_scope(Some(kc_api::database::DATABASE_TABLE_VERSION));

        if self.request_cache.should_skip(&key, &payload_hash) {
            return Ok(());
        }

        let Some(dataset_id) = self.resolve_dataset_id().await else {
            return Err("dataset_id is empty".into());
        };

        let request_id = format!("quest:{}:{}:{}", dataset_id, event_type, Uuid::new_v4());

        let payload = match packet {
            QuestPacket::Event(event) => {
                let converted = QuestIngestEvent::from(event.clone());
                serde_json::json!({
                "dataset_id": dataset_id,
                "request_id": request_id,
                "payload_hash": payload_hash,
                "event_type": converted.event_type,
                "timestamp_ms": converted.timestamp_ms,
                "period_tag": period_tag,
                "table_version": kc_api::database::DATABASE_TABLE_VERSION,
                "quest_id": converted.quest_id,
                })
            }
            QuestPacket::Snapshot(snapshot) => {
                let converted = QuestIngestSnapshot::from(snapshot.clone());
                let quests = converted
                    .quests
                    .iter()
                    .map(|q| {
                        serde_json::json!({
                            "quest_id": q.quest_id,
                            "type": q.quest_type,
                            "category": q.category,
                            "label_type": q.label_type,
                            "title": q.title,
                            "detail": q.detail,
                        })
                    })
                    .collect::<Vec<_>>();
                serde_json::json!({
                    "dataset_id": dataset_id,
                    "request_id": request_id,
                    "payload_hash": payload_hash,
                    "event_type": "snapshot",
                    "timestamp_ms": converted.timestamp_ms,
                    "period_tag": period_tag,
                    "table_version": kc_api::database::DATABASE_TABLE_VERSION,
                    "page_no": converted.page_no,
                    "quests": quests,
                })
            }
        };

        let data = serde_json::to_vec(&payload)?;
        let mut handshake_body = payload.clone();
        if let Some(obj) = handshake_body.as_object_mut() {
            obj.insert(
                "file_size".to_string(),
                serde_json::Value::Number(serde_json::Number::from(data.len() as u64)),
            );
        }

        let request = UploadRequest {
            endpoint: &self.ingest_endpoint,
            handshake_body,
            data,
            headers: {
                let mut h = std::collections::HashMap::new();
                // Reuse retry-service duplicate suppression by content-hash key.
                h.insert("content-hash".to_string(), payload_hash.clone());
                h
            },
            context: UploadContext::Custom(serde_json::json!({
                "operation": "quest_ingest",
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
                self.request_cache.mark_processed(key, payload_hash);
                Ok(())
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::new(std::io::ErrorKind::Other, e).into())
            }
        }
    }

    async fn submit(self: Arc<Self>, seq: u64, packet: QuestPacket) {
        // Enforce strict in-order submission without relying on task scheduling order.
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
            tracing::warn!(error = %e, event_type = %Self::packet_event_type(&packet), "failed to send quest packet");
        }

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

fn cache_file_path(cache_root_dir: PathBuf) -> PathBuf {
    cache_root_dir.join("quest_request_suppression_cache.json")
}

pub fn start(
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache_root_dir: PathBuf,
) {
    if QUEST_TREE_SENDER.get().is_some() {
        tracing::info!("quest tree sender already started");
        return;
    }

    let sender = Arc::new(QuestTreeSender::new(
        ingest_endpoint,
        auth_manager,
        pending_store,
        retry_service,
        cache_root_dir,
    ));

    if QUEST_TREE_SENDER.set(sender).is_err() {
        tracing::warn!("failed to initialize quest tree sender channel");
    }
}

pub fn enqueue(event: QuestEvent) {
    if let Some(sender) = QUEST_TREE_SENDER.get() {
        let sender = sender.clone();
        let seq = sender.allocate_seq();
        tokio::spawn(async move {
            sender.submit(seq, QuestPacket::Event(event)).await;
        });
    }
}

pub fn enqueue_snapshot(snapshot: Quests) {
    if let Some(sender) = QUEST_TREE_SENDER.get() {
        let sender = sender.clone();
        let seq = sender.allocate_seq();
        tokio::spawn(async move {
            sender.submit(seq, QuestPacket::Snapshot(snapshot)).await;
        });
    }
}

#[derive(Clone)]
pub struct QuestTreeSuppressionStatus {
    pub scope: Option<String>,
    pub entries: Vec<SuppressionCacheEntryStatus>,
}

pub fn get_suppression_status() -> Option<QuestTreeSuppressionStatus> {
    QUEST_TREE_SENDER.get().map(|sender| {
        let SuppressionCacheStatus { scope, entries } = sender.request_cache.snapshot_status();
        QuestTreeSuppressionStatus { scope, entries }
    })
}
