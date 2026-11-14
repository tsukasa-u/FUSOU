use crate::senders::local_jsonl::LocalJsonlSink;
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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;
use uuid::Uuid;

static REMODEL_SENDER: OnceCell<Arc<RemodelSender>> = OnceCell::new();
const REMODEL_INGEST_SCHEMA_VERSION: i32 = 1;

enum RemodelPacket {
    SlotList(RemodelSlotList),
    Detail(RemodelDetail),
}

pub struct RemodelSender {
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

impl RemodelSender {
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
                crate::storage::common::remodel_jsonl_relative_path(),
                "remodel",
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
                // remodel data is cross-period; use a long TTL so the same payload is not
                // re-sent every 10 minutes within the same session.
                let cache = Arc::new(LocalRequestSuppressionCache::new(Duration::from_secs(
                    7 * 24 * 60 * 60,
                )));
                if let Err(e) = cache.enable_persistence(cache_file) {
                    tracing::warn!(
                        error = %e,
                        "failed to enable persistent remodel suppression cache"
                    );
                }
                cache
            },
            local_sink,
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
        packet: &RemodelPacket,
        p_hash: &str,
        evt: &str,
        timestamp_ms: i64,
        period_tag: Option<&str>,
    ) -> serde_json::Value {
        match packet {
            RemodelPacket::SlotList(v) => {
                let upload = RemodelSlotListUpload::from(v.clone());
                serde_json::json!({
                    "payload_hash": p_hash,
                    "event_type": evt,
                    "schema_version": REMODEL_INGEST_SCHEMA_VERSION,
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
                    "payload_hash": p_hash,
                    "event_type": evt,
                    "schema_version": REMODEL_INGEST_SCHEMA_VERSION,
                    "timestamp_ms": timestamp_ms,
                    "period_tag": period_tag,
                    "table_version": kc_api::database::DATABASE_TABLE_VERSION,
                    "slotitem_master_id": upload.slotitem_master_id,
                    "remodel_id": upload.remodel_id,
                    "remodel_step_id": upload.remodel_step_id,
                    "remodel_level": upload.remodel_level,
                    "certain_buildkit": upload.certain_buildkit,
                    "certain_remodelkit": upload.certain_remodelkit,
                    "req_slot_id": upload.req_slot_id,
                    "req_slot_num": upload.req_slot_num,
                    "change_flag": upload.change_flag,
                    "req_useitem_id": upload.req_useitem_id,
                    "req_useitem_id2": upload.req_useitem_id2,
                    "req_useitem_num": upload.req_useitem_num,
                    "req_useitem_num2": upload.req_useitem_num2,
                })
            }
        }
    }

    async fn save_locally_if_new(
        &self,
        packet: &RemodelPacket,
        p_key: &str,
        p_hash: &str,
        evt: &str,
        timestamp_ms: i64,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let Some(sink) = &self.local_sink else {
            return Ok(false);
        };
        let period_tag = crate::auth::supabase::get_cached_period_tag().await;
        let payload = Self::build_payload_value(
            packet,
            p_hash,
            evt,
            timestamp_ms,
            period_tag.as_deref(),
        );
        sink.write_if_new(
            Some(kc_api::database::DATABASE_TABLE_VERSION),
            p_key,
            p_hash,
            &payload,
        )
        .await
    }

    async fn send_remote_if_new(
        &self,
        packet: &RemodelPacket,
        p_key: &str,
        p_hash: &str,
        evt: &str,
        timestamp_ms: i64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let Some(ingest_endpoint) = &self.ingest_endpoint else {
            return Ok(());
        };

        let Some(period_tag) = crate::auth::supabase::get_period_tag().await else {
            tracing::warn!("remodel_sender: kc-period tag is unavailable; skipping upload to protect data integrity");
            return Err("kc-period tag is unavailable".into());
        };
        // remodel data is cross-period: only invalidate on table version change
        self.request_cache
            .rotate_scope(Some(kc_api::database::DATABASE_TABLE_VERSION));

        if self.request_cache.should_skip(p_key, p_hash) {
            return Ok(());
        }

        let Some(dataset_id) = self.resolve_dataset_id().await else {
            return Err("dataset_id is empty".into());
        };

        let request_id = format!("remodel:{}:{}:{}", dataset_id, evt, Uuid::new_v4());
        let mut payload =
            Self::build_payload_value(packet, p_hash, evt, timestamp_ms, Some(&period_tag));
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
                h.insert("content-hash".to_string(), content_hash.clone());
                h
            },
            context: UploadContext::Custom(serde_json::json!({
                "operation": "remodel_data_ingest",
                "endpoint": ingest_endpoint,
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
                self.request_cache.mark_processed(p_key, p_hash.to_string());
                Ok(())
            }
            Err(e) => {
                self.retry_service.trigger_retry().await;
                Err(std::io::Error::other(e).into())
            }
        }
    }

    async fn process_packet(&self, packet: &RemodelPacket) {
        let p_key = Self::payload_key(packet);
        let p_hash = Self::payload_hash(packet);
        let evt = Self::event_type(packet);
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        if self.local_sink.is_some() {
            match self
                .save_locally_if_new(packet, &p_key, &p_hash, evt, timestamp_ms)
                .await
            {
                Ok(true) => tracing::info!(event_type = evt, "remodel_sender saved packet to local jsonl"),
                Ok(false) => {}
                Err(e) => {
                    tracing::warn!(error = %e, event_type = evt, "failed to save remodel packet locally");
                }
            }
        }

        if let Err(e) = self
            .send_remote_if_new(packet, &p_key, &p_hash, evt, timestamp_ms)
            .await
        {
            tracing::warn!(error = %e, "failed to send remodel data");
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

        self.process_packet(&packet).await;

        self.next_to_send.fetch_add(1, Ordering::Release);
        self.send_notify.notify_waiters();
    }
}

fn cache_file_path(cache_root_dir: &std::path::Path) -> PathBuf {
    cache_root_dir.join("remodel_request_suppression_cache.json")
}

fn local_cache_file_path(cache_root_dir: &std::path::Path) -> PathBuf {
    cache_root_dir.join("remodel_local_suppression_cache.json")
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

    if REMODEL_SENDER.get().is_some() {
        tracing::info!("remodel sender already started");
        return;
    }

    let sender = Arc::new(RemodelSender::new(
        ingest_endpoint,
        allow_data_to_local,
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

#[cfg(test)]
mod tests {
    use super::*;
    use fusou_auth::manager::AuthConfig;
    use kc_api::interface::remodel::RemodelSlotListEntry;

    fn make_test_sender(
        temp_dir: &std::path::Path,
        allow_data_to_local: bool,
    ) -> Arc<RemodelSender> {
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

        Arc::new(RemodelSender::new_with_local_root(
            None,
            allow_data_to_local,
            Some(temp_dir.join("local_storage")),
            auth_manager,
            pending_store,
            retry_service,
            temp_dir.join("cache"),
        ))
    }

    fn sample_slotlist(weekday_jst: i64, remodel_id: i64) -> RemodelSlotList {
        RemodelSlotList {
            secretary_ship_master_id: 1,
            weekday_jst,
            entries: vec![RemodelSlotListEntry {
                remodel_id,
                remodel_step_id: 1,
                remodel_level: Some(0),
                slotitem_master_id: 2,
                sp_type: 0,
                req_fuel: 10,
                req_bull: 20,
                req_steel: 30,
                req_bauxite: 0,
                req_buildkit: 1,
                req_remodelkit: 2,
                req_slot_id: 0,
                req_slot_num: 0,
            }],
        }
    }

    fn sample_detail(remodel_level: Option<i64>) -> RemodelDetail {
        RemodelDetail {
            slotitem_master_id: 2,
            remodel_id: 101,
            remodel_step_id: 1,
            remodel_level,
            certain_buildkit: 2,
            certain_remodelkit: 3,
            req_slot_id: 0,
            req_slot_num: 0,
            change_flag: 0,
            req_useitem_id: None,
            req_useitem_id2: None,
            req_useitem_num: None,
            req_useitem_num2: None,
        }
    }

    #[tokio::test]
    async fn local_save_records_slotlist_and_detail_and_deduplicates() {
        let temp_dir =
            std::env::temp_dir().join(format!("fusou-remodel-local-test-{}", Uuid::new_v4()));
        let sender = make_test_sender(&temp_dir, true);

        let slot1 = sample_slotlist(1, 101);
        sender
            .clone()
            .submit(0, RemodelPacket::SlotList(slot1.clone()))
            .await;
        sender.clone().submit(1, RemodelPacket::SlotList(slot1)).await;

        let detail1 = sample_detail(Some(0));
        sender
            .clone()
            .submit(2, RemodelPacket::Detail(detail1.clone()))
            .await;
        sender.clone().submit(3, RemodelPacket::Detail(detail1)).await;
        sender
            .clone()
            .submit(4, RemodelPacket::Detail(sample_detail(Some(6))))
            .await;

        let jsonl_path = temp_dir
            .join("local_storage")
            .join(crate::storage::common::remodel_jsonl_relative_path());
        let content =
            std::fs::read_to_string(&jsonl_path).expect("remodel.jsonl should exist");
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);

        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["event_type"], "slotlist");
        assert_eq!(first["schema_version"], REMODEL_INGEST_SCHEMA_VERSION);
        assert_eq!(first["secretary_ship_master_id"], 1);
        assert_eq!(first["entries"][0]["remodel_id"], 101);

        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["event_type"], "detail");
        assert_eq!(second["remodel_level"], 0);
        assert_eq!(second["certain_remodelkit"], 3);

        let third: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
        assert_eq!(third["event_type"], "detail");
        assert_eq!(third["remodel_level"], 6);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn local_save_disabled_writes_no_files() {
        let temp_dir =
            std::env::temp_dir().join(format!("fusou-remodel-disabled-test-{}", Uuid::new_v4()));
        let sender = make_test_sender(&temp_dir, false);
        sender
            .clone()
            .submit(0, RemodelPacket::SlotList(sample_slotlist(1, 101)))
            .await;

        assert!(!temp_dir
            .join("local_storage")
            .join(crate::storage::common::remodel_jsonl_relative_path())
            .exists());
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
