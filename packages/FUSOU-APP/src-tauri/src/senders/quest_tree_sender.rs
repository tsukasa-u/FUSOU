use crate::senders::local_jsonl::LocalJsonlSink;
use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{
    LocalRequestSuppressionCache, PendingStore, SuppressionCacheEntryStatus,
    SuppressionCacheStatus, UploadContext, UploadRequest, UploadRetryService, Uploader,
};
use kc_api::database::models::quest::{QuestIngestEvent, QuestIngestSnapshot};
use kc_api::interface::quest::{QuestEvent, Quests};
use once_cell::sync::OnceCell;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
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
    ingest_endpoint: Option<String>,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    request_cache: Arc<LocalRequestSuppressionCache>,
    local_sink: Option<LocalJsonlSink>,
    client: reqwest::Client,
    next_seq: AtomicU64,
    next_to_send: AtomicU64,
    send_notify: Notify,
}

impl QuestTreeSender {
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
        let cache_file = cache_file_path(&cache_root_dir);
        let local_sink = if allow_data_to_local {
            Some(LocalJsonlSink::new(
                custom_local_root,
                local_cache_file_path(&cache_root_dir),
                crate::storage::common::quest_tree_jsonl_relative_path(),
                "quest_tree",
            ))
        } else {
            None
        };
        Self {
            ingest_endpoint,
            auth_manager,
            pending_store,
            retry_service,
            request_cache: {
                // quest tree data is cross-period; use a long TTL so the same payload is not
                // re-sent every 10 minutes within the same session.
                let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(
                    7 * 24 * 60 * 60,
                )));
                if let Err(e) = cache.enable_persistence(cache_file) {
                    tracing::warn!(error = %e, "failed to enable persistent quest suppression cache");
                }
                cache
            },
            local_sink,
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
                    converted
                        .quest_id
                        .map(|x| x.to_string())
                        .unwrap_or_default()
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
        None
    }

    fn build_payload_value(
        packet: &QuestPacket,
        payload_hash: &str,
        period_tag: Option<&str>,
    ) -> serde_json::Value {
        match packet {
            QuestPacket::Event(event) => {
                let converted = QuestIngestEvent::from(event.clone());
                serde_json::json!({
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
                    "payload_hash": payload_hash,
                    "event_type": "snapshot",
                    "timestamp_ms": converted.timestamp_ms,
                    "period_tag": period_tag,
                    "table_version": kc_api::database::DATABASE_TABLE_VERSION,
                    "page_no": converted.page_no,
                    "quests": quests,
                })
            }
        }
    }

    async fn save_locally_if_new(
        &self,
        packet: &QuestPacket,
        key: &str,
        payload_hash: &str,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let Some(sink) = &self.local_sink else {
            return Ok(false);
        };
        let period_tag = crate::auth::supabase::get_cached_period_tag().await;
        let payload = Self::build_payload_value(packet, payload_hash, period_tag.as_deref());
        sink.write_if_new(
            Some(kc_api::database::DATABASE_TABLE_VERSION),
            key,
            payload_hash,
            &payload,
        )
        .await
    }

    async fn send_remote_if_new(
        &self,
        packet: &QuestPacket,
        key: &str,
        payload_hash: &str,
        event_type: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let Some(ingest_endpoint) = &self.ingest_endpoint else {
            return Ok(());
        };

        let Some(period_tag) = crate::auth::supabase::get_period_tag().await else {
            tracing::warn!("quest_tree_sender: kc-period tag is unavailable; skipping upload to protect data integrity");
            return Err("kc-period tag is unavailable".into());
        };
        // quest tree data is cross-period: only invalidate on table version change
        self.request_cache
            .rotate_scope(Some(kc_api::database::DATABASE_TABLE_VERSION));

        if self.request_cache.should_skip(key, payload_hash) {
            return Ok(());
        }

        let Some(dataset_id) = self.resolve_dataset_id().await else {
            return Err("dataset_id is empty".into());
        };

        let request_id = format!("quest:{}:{}:{}", dataset_id, event_type, Uuid::new_v4());
        let mut payload = Self::build_payload_value(packet, payload_hash, Some(&period_tag));
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("dataset_id".to_string(), serde_json::Value::String(dataset_id));
            obj.insert("request_id".to_string(), serde_json::Value::String(request_id));
        }

        let data = serde_json::to_vec(&payload)?;
        let mut handshake_body = payload.clone();
        if let Some(obj) = handshake_body.as_object_mut() {
            obj.insert(
                "file_size".to_string(),
                serde_json::Value::Number(serde_json::Number::from(data.len() as u64)),
            );
        }

        let request = UploadRequest {
            endpoint: ingest_endpoint,
            handshake_body,
            data,
            headers: {
                let mut h = std::collections::HashMap::new();
                // Reuse retry-service duplicate suppression by content-hash key.
                h.insert("content-hash".to_string(), payload_hash.to_string());
                h
            },
            context: UploadContext::Custom(serde_json::json!({
                "operation": "quest_ingest",
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
                self.request_cache
                    .mark_processed(key.to_string(), payload_hash.to_string());
                Ok(())
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::other(e).into())
            }
        }
    }

    async fn process_packet(&self, packet: &QuestPacket) {
        if let QuestPacket::Snapshot(snapshot) = packet {
            if snapshot.page_no.max(0) != 0 {
                tracing::debug!(
                    page_no = snapshot.page_no,
                    "quest_tree_sender: skipping non-All quest tab snapshot"
                );
                return;
            }
        }

        let key = Self::payload_key(packet);
        let payload_hash = Self::payload_hash(packet);
        let event_type = Self::packet_event_type(packet);

        match self.save_locally_if_new(packet, &key, &payload_hash).await {
            Ok(true) => tracing::debug!(event_type, "quest packet saved to local jsonl"),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(error = %e, event_type, "failed to save quest packet locally");
            }
        }

        if let Err(e) = self
            .send_remote_if_new(packet, &key, &payload_hash, event_type)
            .await
        {
            tracing::warn!(error = %e, event_type, "failed to send quest packet");
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

        self.process_packet(&packet).await;

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

fn cache_file_path(cache_root_dir: &std::path::Path) -> PathBuf {
    cache_root_dir.join("quest_request_suppression_cache.json")
}

fn local_cache_file_path(cache_root_dir: &std::path::Path) -> PathBuf {
    cache_root_dir.join("quest_local_suppression_cache.json")
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

    if QUEST_TREE_SENDER.get().is_some() {
        tracing::info!("quest tree sender already started");
        return;
    }

    let sender = Arc::new(QuestTreeSender::new(
        ingest_endpoint,
        allow_data_to_local,
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
    if snapshot.page_no.max(0) != 0 {
        tracing::debug!(
            page_no = snapshot.page_no,
            "quest_tree_sender: skipping non-All quest tab snapshot"
        );
        return;
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use fusou_auth::manager::AuthConfig;
    use kc_api::interface::quest::Quest;
    use std::collections::HashMap;

    fn make_test_sender(
        temp_dir: &std::path::Path,
        allow_data_to_local: bool,
    ) -> Arc<QuestTreeSender> {
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

        Arc::new(QuestTreeSender::new_with_local_root(
            None,
            allow_data_to_local,
            Some(temp_dir.join("local_storage")),
            auth_manager,
            pending_store,
            retry_service,
            temp_dir.join("cache"),
        ))
    }

    fn sample_quest(no: i64, title: &str) -> Quest {
        Quest {
            no,
            category: 1,
            quest_type: 1,
            label_type: 1,
            state: 2,
            title: title.to_string(),
            detail: "detail".to_string(),
            voice_id: 0,
            get_material: vec![10, 20, 30, 40],
            bonus_flag: 0,
            progress_flag: 0,
            invalid_flag: 0,
            lost_badges: None,
        }
    }

    fn sample_snapshot(page_no: i64, quest_no: i64, title: &str) -> Quests {
        let mut quests = HashMap::new();
        quests.insert(quest_no, sample_quest(quest_no, title));
        Quests {
            timestamp: Some(1_790_000_000_000),
            page_no,
            count: 1,
            completed_kind: 0,
            exec_count: 0,
            exec_type: 0,
            quests,
            completed: HashMap::new(),
        }
    }

    #[tokio::test]
    async fn local_save_works_when_remote_disabled_and_deduplicates_snapshots() {
        let temp_dir = std::env::temp_dir().join(format!("fusou-quest-local-test-{}", Uuid::new_v4()));
        let sender = make_test_sender(&temp_dir, true);

        sender
            .clone()
            .submit(
                0,
                QuestPacket::Event(QuestEvent {
                    timestamp: 1_790_000_000_100,
                    event_type: "start".to_string(),
                    quest_id: Some(201),
                }),
            )
            .await;

        let snap_v1 = sample_snapshot(0, 201, "Quest A");
        sender.clone().submit(1, QuestPacket::Snapshot(snap_v1.clone())).await;
        // Identical tab-0 snapshot should be deduplicated by local suppression cache.
        sender.clone().submit(2, QuestPacket::Snapshot(snap_v1)).await;
        // Non-All tab snapshot should be skipped cleanly.
        sender
            .clone()
            .submit(3, QuestPacket::Snapshot(sample_snapshot(1, 202, "Tab 1")))
            .await;
        // Changed tab-0 snapshot should be appended.
        sender
            .clone()
            .submit(4, QuestPacket::Snapshot(sample_snapshot(0, 202, "Quest B")))
            .await;

        let jsonl_path = temp_dir
            .join("local_storage")
            .join(crate::storage::common::quest_tree_jsonl_relative_path());
        let content = std::fs::read_to_string(&jsonl_path).expect("quest_tree.jsonl should exist");
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);

        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["event_type"], "start");
        assert_eq!(first["quest_id"], 201);
        assert_eq!(
            first["table_version"],
            kc_api::database::DATABASE_TABLE_VERSION
        );

        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["event_type"], "snapshot");
        assert_eq!(second["page_no"], 0);
        assert_eq!(second["quests"][0]["quest_id"], 201);

        let third: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
        assert_eq!(third["event_type"], "snapshot");
        assert_eq!(third["quests"][0]["quest_id"], 202);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn local_save_disabled_writes_no_files() {
        let temp_dir =
            std::env::temp_dir().join(format!("fusou-quest-disabled-test-{}", Uuid::new_v4()));
        let sender = make_test_sender(&temp_dir, false);

        sender
            .clone()
            .submit(
                0,
                QuestPacket::Event(QuestEvent {
                    timestamp: 1_790_000_000_100,
                    event_type: "complete".to_string(),
                    quest_id: Some(301),
                }),
            )
            .await;

        let jsonl_path = temp_dir
            .join("local_storage")
            .join(crate::storage::common::quest_tree_jsonl_relative_path());
        assert!(!jsonl_path.exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
