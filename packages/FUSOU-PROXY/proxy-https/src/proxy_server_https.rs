use http::{request, response, HeaderName, Uri};
use http_body_util::BodyExt;
use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{CertificateParams, KeyPair},
    rustls::crypto::aws_lc_rs,
    *,
};
use std::{
    collections::HashMap,
    fs,
    future::Future,
    io::Read,
    net::SocketAddr,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex, OnceLock},
};

use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;

// #[cfg(target_os = "linux")]
// use std::os::linux::fs::MetadataExt;
#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;

use crate::capture::{
    CaptureProvenance, CaptureRuntimeMetadata, ExactWireCapture, ExactWireDirection,
    ExactWireMessage, ExactWireMetadata,
};
use crate::capture_io::{CaptureDirection, CaptureRecorder};
pub use crate::experimental_tlsn::{
    ExperimentalForwardFuture, ExperimentalRequireInfoForwarder, ExperimentalTlsnForwarder,
};
use crate::{bidirectional_channel, capture};

#[cfg(feature = "rama-experimental")]
pub mod rama_experimental;

use configs;

use fusou_auth::{AuthManager, FileStorage};
use fusou_storage::asset_sync;
use tracing_unwrap::ResultExt;

pub static CA_CERT_NAME: &str = "fusou_ca_cert";
pub static CA_CERT_NAME_PEM: &str = "fusou_ca_cert.pem";
pub static CA_CERT_NAME_CRT: &str = "fusou_ca_cert.crt";
pub static CA_CERT_NAME_DER: &str = "fusou_ca_cert.der";
static CA_KEY_NAME_PEM: &str = "fusou_ca_key.pem";

static ORGANIZATION_NAME: &str = "FUSOU";
static COUNTRY_NAME: &str = "JP";
const REQUIRE_INFO_TARGET: &str = "/kcsapi/api_get_member/require_info";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExperimentalRequireInfoState {
    Ready,
    Selected,
}

#[derive(Clone)]
struct ExperimentalRequireInfoRoute {
    enabled: bool,
    state: Arc<Mutex<ExperimentalRequireInfoState>>,
    forwarder: Option<Arc<dyn ExperimentalRequireInfoForwarder>>,
}

#[derive(Clone)]
pub struct ExperimentalTlsnDependencies {
    forwarder: Arc<dyn ExperimentalRequireInfoForwarder>,
}

impl ExperimentalTlsnDependencies {
    pub fn new(forwarder: Arc<dyn ExperimentalRequireInfoForwarder>) -> Self {
        Self { forwarder }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExperimentalRequireInfoDecision {
    Forward,
    Selected,
    Blocked,
}

impl ExperimentalRequireInfoRoute {
    fn new(enabled: bool, forwarder: Option<Arc<dyn ExperimentalRequireInfoForwarder>>) -> Self {
        Self {
            enabled,
            state: Arc::new(Mutex::new(ExperimentalRequireInfoState::Ready)),
            forwarder,
        }
    }

    fn decide(&self, parts: &request::Parts) -> ExperimentalRequireInfoDecision {
        if !self.enabled
            || parts.method != http::Method::POST
            || parts.uri.path_and_query().map(|value| value.as_str()) != Some(REQUIRE_INFO_TARGET)
        {
            return ExperimentalRequireInfoDecision::Forward;
        }

        let Ok(mut state) = self.state.lock() else {
            tracing::error!("experimental TLSN route state is poisoned");
            return ExperimentalRequireInfoDecision::Blocked;
        };
        match *state {
            ExperimentalRequireInfoState::Ready => {
                *state = ExperimentalRequireInfoState::Selected;
                tracing::warn!(
                    target = REQUIRE_INFO_TARGET,
                    "selected actual require_info request for Experimental TLSN"
                );
                ExperimentalRequireInfoDecision::Selected
            }
            ExperimentalRequireInfoState::Selected => {
                tracing::warn!(
                    target = REQUIRE_INFO_TARGET,
                    "blocked subsequent require_info request after Experimental TLSN selection"
                );
                ExperimentalRequireInfoDecision::Blocked
            }
        }
    }

    async fn forward_selected(
        &self,
        connection_id: u64,
        part: request::Parts,
        body: hyper::body::Bytes,
    ) -> Result<Response<Body>, String> {
        let Some(forwarder) = &self.forwarder else {
            return Err("Prover-owned origin transport is unavailable".to_owned());
        };
        forwarder
            .forward(connection_id, Request::from_parts(part, body))
            .await
    }
}

fn normalize_content_type(content_type: &str) -> String {
    content_type
        .split(';')
        .next()
        .map(|v| v.trim().to_ascii_lowercase())
        .unwrap_or_default()
}

fn parse_content_encodings(content_encoding: &str) -> Vec<String> {
    content_encoding
        .split(',')
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .collect()
}

fn decode_body_with_encoding(body: &[u8], encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "" | "identity" => Ok(body.to_vec()),
        "gzip" | "x-gzip" => {
            let mut buf = Vec::new();
            flate2::read::MultiGzDecoder::new(body)
                .read_to_end(&mut buf)
                .map_err(|err| format!("gzip decode failed: {err}"))?;
            Ok(buf)
        }
        "deflate" => {
            let mut zlib_buf = Vec::new();
            if flate2::read::ZlibDecoder::new(body)
                .read_to_end(&mut zlib_buf)
                .is_ok()
            {
                return Ok(zlib_buf);
            }

            let mut deflate_buf = Vec::new();
            flate2::read::DeflateDecoder::new(body)
                .read_to_end(&mut deflate_buf)
                .map_err(|err| format!("deflate decode failed: {err}"))?;
            Ok(deflate_buf)
        }
        "br" => {
            let mut buf = Vec::new();
            brotli::Decompressor::new(body, 4096)
                .read_to_end(&mut buf)
                .map_err(|err| format!("brotli decode failed: {err}"))?;
            Ok(buf)
        }
        _ => Err(format!("unsupported content-encoding: {encoding}")),
    }
}

fn decode_response_body(mut body: Vec<u8>, encodings: &[String], try_gzip_sniff: bool) -> Vec<u8> {
    if !encodings.is_empty() {
        for encoding in encodings.iter().rev() {
            match decode_body_with_encoding(&body, encoding) {
                Ok(decoded) => {
                    body = decoded;
                }
                Err(err) => {
                    tracing::warn!(encoding = %encoding, error = %err, "failed to decode response body");
                    return body;
                }
            }
        }
        return body;
    }

    if try_gzip_sniff && body.len() >= 2 && body[0] == 0x1f && body[1] == 0x8b {
        if let Ok(decoded) = decode_body_with_encoding(&body, "gzip") {
            return decoded;
        }
    }

    body
}

fn log_response(
    parts: response::Parts,
    body: Vec<u8>,
    uri: Uri,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    save_path: String,
    file_prefix: String,
    allow_save_api_responses: bool,
    allow_save_resources: bool,
    allow_save_main_js_local: bool,
) {
    let mut raw_content_type = String::new();
    let mut content_type = String::new();
    let mut content_encoding = String::new();
    let mut _content_length: i64 = -1;

    const HEADER_NAME_CONTENT_TYPE: HeaderName = HeaderName::from_static("content-type");
    const HEADER_NAME_CONTENT_ENCODING: HeaderName = HeaderName::from_static("content-encoding");
    const HEADER_NAME_CONTENT_LENGTH: HeaderName = HeaderName::from_static("content-length");
    {
        for (key, value) in parts.headers {
            match key {
                Some(HEADER_NAME_CONTENT_TYPE) => {
                    if let Ok(v) = value.to_str() {
                        raw_content_type = v.to_string();
                        content_type = normalize_content_type(v);
                    }
                }
                Some(HEADER_NAME_CONTENT_ENCODING) => {
                    if let Ok(v) = value.to_str() {
                        content_encoding = v.to_string();
                    }
                }
                Some(HEADER_NAME_CONTENT_LENGTH) => {
                    if let Ok(v) = value.to_str() {
                        if let Ok(parsed) = v.parse::<i64>() {
                            _content_length = parsed;
                        }
                    }
                }
                _ => {}
            };
        }
    }

    let content_encodings = parse_content_encodings(&content_encoding);

    let re_uri = regex::Regex::new(r"https+://.*\.kancolle-server\.com").unwrap();
    let uri_path = re_uri.replace(uri.path(), "").to_string();
    let status = parts.status.to_string();

    let pass: bool = match content_type.as_str() {
        "text/plain" => false,
        "application/json" => true,
        "image/png" => true,
        "video/mp4" => true,
        "audio/mpeg" => true,
        "text/html" => true,
        "text/css" => true,
        "text/javascript" => true,
        _ => true,
    };

    let is_json_by_path = uri_path.ends_with(".json");
    let is_js_by_path = uri_path.ends_with(".js");
    let is_main_js = uri_path.ends_with("/main.js");

    let save: bool = if is_js_by_path {
        // JS is not persisted by default. Only allow main.js when explicitly enabled.
        is_main_js && allow_save_main_js_local
    } else {
        match content_type.as_str() {
            "text/plain" => allow_save_api_responses,
            "application/json" => allow_save_resources,
            "image/png" => allow_save_resources,
            "video/mp4" => allow_save_resources,
            "audio/mpeg" => allow_save_resources,
            "text/html" => false,
            "text/css" => false,
            "text/javascript" | "application/javascript" | "application/x-javascript" => {
                is_main_js && allow_save_main_js_local
            }
            _ => allow_save_resources,
        }
    };

    let utc: chrono::NaiveDateTime = Utc::now().naive_utc();
    let jst: chrono::DateTime<chrono_tz::Tz> = Tokyo.from_utc_datetime(&utc);

    tracing::info!(status = %status, uri = %uri_path, content_type = %content_type);

    if save || !pass {
        if body.is_empty() {
            return;
        }

        tokio::spawn(async move {
            // Phase 4: Decompress CPU-bound operations using spawn_blocking
            let buffer_for_text = if !pass && content_type.eq("text/plain") {
                let body_clone = body.clone();
                let content_encodings_clone = content_encodings.clone();
                match tokio::task::spawn_blocking(move || {
                    decode_response_body(body_clone, &content_encodings_clone, true)
                })
                .await
                {
                    Ok(buf) => buf,
                    Err(e) => {
                        tracing::error!("spawn_blocking decompression failed: {}", e);
                        body.clone()
                    }
                }
            } else {
                Vec::new()
            };

            if !pass && content_type.eq("text/plain") {
                if let Ok(buffer_string) = String::from_utf8(buffer_for_text.clone()) {
                    let mes = bidirectional_channel::StatusInfo::RESPONSE {
                        path: uri_path.clone(),
                        content_type: raw_content_type.clone(),
                        content: buffer_string,
                    };
                    let _ = tx_proxy_log.send(mes).await;
                } else {
                    tracing::warn!("Failed to convert buffer to string");
                }
            }

            if save {
                let path_log = Path::new(save_path.as_str());

                if content_type.eq("text/plain") && uri_path.as_str().starts_with("/kcsapi") {
                    let parent = Path::new("kcsapi");
                    let path_parent = path_log.join(parent);
                    if !path_parent.exists() {
                        // Phase 3: Use async directory creation
                        if let Err(e) = tokio::fs::create_dir_all(&path_parent).await {
                            tracing::error!("Failed to create kcsapi directory: {}", e);
                            return;
                        }
                    }

                    let time_formated = format!(
                        "kcsapi/{}S{}",
                        jst.format("%Y%m%d_%H%M%S%3f"),
                        uri_path.as_str().replace("/kcsapi", "").replace("/", "@")
                    );
                    let metadata_string = format!(
                        "---\nProxyApp: {}\nTimestamp: {}\nEnvId: {}\n---\n",
                        "FUSOU",
                        jst.timestamp(),
                        file_prefix
                    );
                    let metadata_buffer = metadata_string.as_bytes();
                    let combined_buffer = [metadata_buffer, buffer_for_text.as_slice()].concat();
                    // Phase 3: Use async file I/O (non-blocking)
                    if let Err(e) =
                        tokio::fs::write(path_log.join(Path::new(&time_formated)), combined_buffer)
                            .await
                    {
                        tracing::error!("Failed to write kcsapi file: {}", e);
                    }
                } else {
                    let path_removed = uri_path.as_str().replacen("/", "", 1);
                    if let Some(parent) = Path::new(path_removed.as_str()).parent() {
                        let path_parent = path_log.join(parent);
                        if !path_parent.exists() {
                            // Phase 3: Use async directory creation (non-blocking)
                            if let Err(e) = tokio::fs::create_dir_all(path_parent).await {
                                tracing::error!("Failed to create directory: {}", e);
                                return;
                            }
                        }
                    }

                    let file_log_path = path_log.join(Path::new(path_removed.as_str()));
                    let file_log_path_for_sync = file_log_path.clone();

                    if content_type.eq("application/json") || is_json_by_path {
                        // Phase 4: Decompress JSON using spawn_blocking
                        let body_clone = body.clone();
                        let content_encodings_clone = content_encodings.clone();
                        let json_buffer = match tokio::task::spawn_blocking(move || {
                            decode_response_body(body_clone, &content_encodings_clone, true)
                        })
                        .await
                        {
                            Ok(buf) => buf,
                            Err(e) => {
                                tracing::error!("spawn_blocking JSON decompression failed: {}", e);
                                body.clone()
                            }
                        };

                        // Phase 3: Use async file I/O (non-blocking)
                        if let Err(e) = tokio::fs::write(&file_log_path, json_buffer).await {
                            tracing::error!("Failed to write json file: {}", e);
                        }
                    } else if is_main_js && allow_save_main_js_local {
                        let body_clone = body.clone();
                        let content_encodings_clone = content_encodings.clone();
                        let js_buffer = match tokio::task::spawn_blocking(move || {
                            decode_response_body(body_clone, &content_encodings_clone, true)
                        })
                        .await
                        {
                            Ok(buf) => buf,
                            Err(e) => {
                                tracing::error!(
                                    "spawn_blocking main.js decompression failed: {}",
                                    e
                                );
                                body.clone()
                            }
                        };

                        if let Err(e) = tokio::fs::write(&file_log_path, js_buffer).await {
                            tracing::error!("Failed to write main.js file: {}", e);
                        }
                    } else {
                        // Phase 3: Use async file I/O (non-blocking)
                        if let Err(e) = tokio::fs::write(&file_log_path, body.clone()).await {
                            tracing::error!("Failed to write file: {}", e);
                        }
                    }

                    // Phase 2: Non-blocking asset sync notification with backpressure handling
                    asset_sync::notify_new_asset(file_log_path_for_sync);
                }
            }
        });
    }
}

fn log_request(
    parts: request::Parts,
    body: Vec<u8>,
    uri: Uri,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    save_path: String,
    file_prefix: String,
    allow_save_api_requests: bool,
) {
    let mut content_type: String = String::new();
    let mut _content_length: i64 = -1;

    const HEADER_NAME_CONTENT_TYPE: HeaderName = HeaderName::from_static("content-type");
    const HEADER_NAME_CONTENT_LENGTH: HeaderName = HeaderName::from_static("content-length");
    {
        for (key, value) in parts.headers {
            match key {
                Some(HEADER_NAME_CONTENT_TYPE) => {
                    content_type = value.to_str().unwrap_or_default().to_string();
                }
                Some(HEADER_NAME_CONTENT_LENGTH) => {
                    _content_length = value
                        .to_str()
                        .ok()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(-1);
                }
                _ => {}
            };
        }
    }

    let pass: bool = !matches!(content_type.as_str(), "application/x-www-form-urlencoded");

    let save: bool = match content_type.as_str() {
        "application/x-www-form-urlencoded" => allow_save_api_requests,
        _ => false,
    };

    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);

    let re_uri = regex::Regex::new(r"https+://.*\.kancolle-server\.com").unwrap();
    let uri_path = re_uri.replace(uri.path(), "").to_string();

    tracing::info!(method = %parts.method, uri = %uri_path, content_type = %content_type);

    if save || !pass {
        if body.is_empty() {
            return;
        }

        tokio::spawn(async move {
            let mut buffer: Vec<u8> = Vec::new();
            if !pass && content_type.eq("application/x-www-form-urlencoded") {
                //     // this code is for the response not decoded in hudsucker!!
                buffer = body.clone();

                if let Ok(buffer_string) = String::from_utf8(buffer.clone()) {
                    let mes = bidirectional_channel::StatusInfo::REQUEST {
                        path: uri_path.clone(),
                        content_type: content_type.to_string(),
                        content: buffer_string,
                    };
                    let _ = tx_proxy_log.send(mes).await;
                } else {
                    tracing::warn!("Failed to convert buffer to string");
                }
            }
            if save {
                let path_log = Path::new(save_path.as_str());

                if content_type.eq("application/x-www-form-urlencoded")
                    && uri_path.as_str().starts_with("/kcsapi")
                {
                    let parent = Path::new("kcsapi");
                    let path_parent = path_log.join(parent);
                    if !path_parent.exists() {
                        fs::create_dir_all(path_parent).expect_or_log("Failed to create directory");
                    }

                    // let time_stamped = format!(
                    //     "kcsapi/{}_{}Q{}",
                    //     file_prefix,
                    //     jst.timestamp(),
                    //     uri_path.as_str().replace("/kcsapi", "").replace("/", "@")
                    // );

                    let time_formated = format!(
                        "kcsapi/{}Q{}",
                        jst.format("%Y%m%d_%H%M%S%3f"),
                        uri_path.as_str().replace("/kcsapi", "").replace("/", "@")
                    );
                    let metadata_string = format!(
                        "---\nProxyApp: {}\nTimestamp: {}\nEnvId: {}\n---\n",
                        "FUSOU",
                        jst.timestamp(),
                        file_prefix
                    );
                    let metadata_buffer = metadata_string.as_bytes();
                    let combined_buffer = [metadata_buffer, buffer.as_slice()].concat();
                    fs::write(path_log.join(Path::new(&time_formated)), combined_buffer)
                        .expect_or_log("Failed to write file");
                } else {
                    let path_removed = uri_path.as_str().replacen("/", "", 1);
                    if let Some(parent) = Path::new(path_removed.as_str()).parent() {
                        let path_parent = path_log.join(parent);
                        if !path_parent.exists() {
                            fs::create_dir_all(path_parent)
                                .expect_or_log("Failed to create directory");
                        }
                    }

                    let file_log_path = path_log.join(Path::new(path_removed.as_str()));

                    if !file_log_path.exists() {
                        fs::write(file_log_path, body.clone().clone())
                            .expect_or_log("Failed to write file");
                    } else {
                        let file_log_metadata = fs::metadata(file_log_path.clone())
                            .expect_or_log("Failed to get metadata");
                        #[cfg(target_os = "linux")]
                        if file_log_metadata.len() == 0 {
                            fs::write(file_log_path, body.clone().clone())
                                .expect_or_log("Failed to write file");
                        }
                        #[cfg(target_os = "windows")]
                        if file_log_metadata.file_size() == 0 {
                            fs::write(file_log_path, body.clone().clone())
                                .expect_or_log("Failed to write file");
                        }
                    }
                }
            }
        });
    }
}

#[derive(Clone)]
struct RawCaptureHook {
    output_root: PathBuf,
    provenance: CaptureProvenance,
    sessions: Arc<Mutex<HashMap<u64, Arc<Mutex<RawCaptureSession>>>>>,
    persistence_tasks: Arc<Mutex<tokio::task::JoinSet<()>>>,
    #[cfg(test)]
    websocket_outcomes: Arc<Mutex<Vec<(u64, bool)>>>,
}

#[derive(Debug)]
struct RawCaptureSession {
    recorder: CaptureRecorder,
    provenance: CaptureProvenance,
    messages: Vec<RawCaptureMessage>,
    active_request: Option<usize>,
    active_response: Option<usize>,
    next_sequence: u64,
    invalid: bool,
}

#[derive(Debug)]
struct RawCaptureMessage {
    direction: ExactWireDirection,
    sequence: u64,
    stream_start: u64,
    stream_end: Option<u64>,
    metadata: ExactWireMetadata,
}

impl RawCaptureHook {
    fn new(output_root: PathBuf) -> Self {
        Self::with_provenance(output_root, CaptureProvenance::synthetic())
    }

    fn new_natural_candidate(
        output_root: PathBuf,
        runtime_metadata: CaptureRuntimeMetadata,
    ) -> Self {
        Self::with_provenance(
            output_root,
            CaptureProvenance::natural_candidate(&runtime_metadata),
        )
    }

    fn with_provenance(output_root: PathBuf, provenance: CaptureProvenance) -> Self {
        Self {
            output_root,
            provenance,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            persistence_tasks: Arc::new(Mutex::new(tokio::task::JoinSet::new())),
            #[cfg(test)]
            websocket_outcomes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn track_persistence_task(&self, task: impl Future<Output = ()> + Send + 'static) {
        let keep_alive = Arc::clone(&self.persistence_tasks);
        let mut tasks = match self.persistence_tasks.lock() {
            Ok(tasks) => tasks,
            Err(error) => {
                tracing::error!(%error, "raw capture persistence task set lock poisoned");
                error.into_inner()
            }
        };
        while let Some(result) = tasks.try_join_next() {
            if let Err(error) = result {
                tracing::error!(%error, "raw capture persistence task failed");
            }
        }
        tasks.spawn(async move {
            let _keep_alive = keep_alive;
            task.await;
        });
    }

    fn schedule_finish_connection(&self, connection_id: u64, connection_clean: bool) {
        self.track_persistence_task(self.finish_connection(connection_id, connection_clean));
    }

    async fn wait_for_persistence_tasks(persistence_tasks: Arc<Mutex<tokio::task::JoinSet<()>>>) {
        let mut tasks = {
            let tasks = match persistence_tasks.lock() {
                Ok(tasks) => tasks,
                Err(error) => {
                    tracing::error!(%error, "raw capture persistence task set lock poisoned during shutdown");
                    error.into_inner()
                }
            };
            let mut tasks = tasks;
            std::mem::take(&mut *tasks)
        };
        while let Some(result) = tasks.join_next().await {
            if let Err(error) = result {
                tracing::error!(%error, "raw capture persistence task failed during shutdown");
            }
        }
    }

    fn websocket_completed_for(&self, connection_id: u64, clean: bool) {
        tracing::info!(
            connection_id,
            websocket_relay_clean = clean,
            "WebSocket relay lifecycle completed"
        );
        #[cfg(test)]
        match self.websocket_outcomes.lock() {
            Ok(mut outcomes) => outcomes.push((connection_id, clean)),
            Err(error) => tracing::error!(
                %error,
                connection_id,
                "WebSocket test outcome lock poisoned"
            ),
        }
    }

    fn start_session(&self, connection_id: u64) -> Result<CaptureRecorder, ()> {
        let recorder = CaptureRecorder::new();
        let session = Arc::new(Mutex::new(RawCaptureSession {
            recorder: recorder.clone(),
            provenance: self.provenance.clone().for_connection(connection_id),
            messages: Vec::new(),
            active_request: None,
            active_response: None,
            next_sequence: 0,
            invalid: false,
        }));
        self.sessions
            .lock()
            .map_err(|_| ())?
            .insert(connection_id, session);
        Ok(recorder)
    }

    fn session(&self, connection_id: u64) -> Option<Arc<Mutex<RawCaptureSession>>> {
        match self.sessions.lock() {
            Ok(sessions) => sessions.get(&connection_id).cloned(),
            Err(error) => {
                tracing::error!(
                    %error,
                    connection_id,
                    "raw capture session map lock poisoned"
                );
                None
            }
        }
    }

    fn mark_invalid(&self, connection_id: u64) {
        if let Some(session) = self.session(connection_id) {
            if let Ok(mut session) = session.lock() {
                session.invalid = true;
            }
        }
    }

    fn request_started_for(&self, connection_id: u64, metadata: ExactWireMetadata) {
        let Some(session) = self.session(connection_id) else {
            return;
        };
        let Ok(mut session) = session.lock() else {
            self.mark_invalid(connection_id);
            return;
        };
        if session.active_request.is_some() {
            session.invalid = true;
            return;
        }
        if let Some(message_index) = session.active_response.take() {
            let Ok(stream_end) = session.recorder.direction_len(CaptureDirection::Response) else {
                session.invalid = true;
                return;
            };
            if (stream_end as u64) < session.messages[message_index].stream_start {
                session.invalid = true;
                return;
            }
            session.messages[message_index].stream_end = Some(stream_end as u64);
        }
        let stream_start = session
            .messages
            .iter()
            .rev()
            .find(|message| message.direction == ExactWireDirection::Request)
            .and_then(|message| message.stream_end)
            .unwrap_or(0);
        let message_index = session.messages.len();
        let sequence = session.next_sequence;
        session.next_sequence += 1;
        session.messages.push(RawCaptureMessage {
            direction: ExactWireDirection::Request,
            sequence,
            stream_start: stream_start as u64,
            stream_end: None,
            metadata,
        });
        session.active_request = Some(message_index);
    }

    fn request_completed_for(&self, connection_id: u64) {
        let Some(session) = self.session(connection_id) else {
            return;
        };
        let Ok(mut session) = session.lock() else {
            self.mark_invalid(connection_id);
            return;
        };
        let Some(message_index) = session.active_request.take() else {
            session.invalid = true;
            return;
        };
        let Ok(stream_end) = session.recorder.direction_len(CaptureDirection::Request) else {
            session.invalid = true;
            return;
        };
        session.messages[message_index].stream_end = Some(stream_end as u64);
    }

    fn response_started_for(&self, connection_id: u64, metadata: ExactWireMetadata) {
        let Some(session) = self.session(connection_id) else {
            return;
        };
        let Ok(mut session) = session.lock() else {
            self.mark_invalid(connection_id);
            return;
        };
        if session.active_request.is_some() || session.active_response.is_some() {
            session.invalid = true;
            return;
        }
        let Some(last_message) = session.messages.last() else {
            session.invalid = true;
            return;
        };
        if last_message.direction != ExactWireDirection::Request
            || last_message.stream_end.is_none()
        {
            session.invalid = true;
            return;
        }
        let Ok(stream_start) = session.recorder.direction_len(CaptureDirection::Response) else {
            session.invalid = true;
            return;
        };
        let message_index = session.messages.len();
        let sequence = session.next_sequence;
        session.next_sequence += 1;
        session.messages.push(RawCaptureMessage {
            direction: ExactWireDirection::Response,
            sequence,
            stream_start: stream_start as u64,
            stream_end: None,
            metadata,
        });
        session.active_response = Some(message_index);
    }

    fn response_completed_for(&self, connection_id: u64) {
        let Some(session) = self.session(connection_id) else {
            return;
        };
        let completed_upgrade = match session.lock() {
            Ok(mut session) => {
                if let Err(error) = Self::complete_upgrade_response(&mut session) {
                    session.invalid = true;
                    tracing::error!(
                        error = %error,
                        connection_id,
                        "failed to seal HTTP Upgrade capture"
                    );
                }
                Self::has_completed_upgrade(&session)
            }
            Err(error) => {
                self.mark_invalid(connection_id);
                tracing::error!(
                    error = %error,
                    connection_id,
                    "raw capture session lock poisoned after HTTP response"
                );
                false
            }
        };
        if completed_upgrade {
            self.finish_completed_upgrade(connection_id, &session);
        }
    }

    fn has_completed_upgrade(session: &RawCaptureSession) -> bool {
        session
            .messages
            .iter()
            .any(|message| message.metadata.status() == Some(101) && message.stream_end.is_some())
    }

    fn finish_completed_upgrade(
        &self,
        connection_id: u64,
        expected: &Arc<Mutex<RawCaptureSession>>,
    ) {
        if let Err(error) = tokio::runtime::Handle::try_current() {
            tracing::error!(
                %error,
                connection_id,
                "cannot finalize completed HTTP Upgrade outside a Tokio runtime"
            );
            return;
        }
        let session = match self.sessions.lock() {
            Ok(mut sessions) => {
                let is_expected = sessions
                    .get(&connection_id)
                    .is_some_and(|session| Arc::ptr_eq(session, expected));
                if is_expected {
                    sessions.remove(&connection_id)
                } else {
                    None
                }
            }
            Err(error) => {
                tracing::error!(
                    %error,
                    connection_id,
                    "raw capture session map lock poisoned during Upgrade finalization"
                );
                None
            }
        };
        if let Some(session) = session {
            let output_root = self.output_root.clone();
            self.track_persistence_task(persist_raw_capture(
                output_root,
                connection_id,
                session,
                false,
            ));
        }
    }

    fn complete_upgrade_response(session: &mut RawCaptureSession) -> Result<(), String> {
        let Some(message_index) = session.active_response else {
            return Ok(());
        };
        if session.messages[message_index].metadata.status() != Some(101) {
            return Ok(());
        }
        let snapshot = session
            .recorder
            .snapshot()
            .map_err(|error| error.to_string())?;
        let response_bytes = snapshot.response_bytes();
        let stream_start = usize::try_from(session.messages[message_index].stream_start)
            .map_err(|_| "WebSocket response start exceeds addressable memory".to_string())?;
        let header_end = response_bytes
            .get(stream_start..)
            .and_then(|bytes| bytes.windows(4).position(|window| window == b"\r\n\r\n"))
            .and_then(|offset| stream_start.checked_add(offset + 4))
            .ok_or_else(|| "incomplete HTTP Upgrade response headers".to_string())?;
        session.messages[message_index].stream_end = Some(header_end as u64);
        session.active_response = None;
        session.recorder.seal().map_err(|error| error.to_string())
    }

    fn finish_connection(
        &self,
        connection_id: u64,
        connection_clean: bool,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let session = match self.sessions.lock() {
            Ok(mut sessions) => sessions.remove(&connection_id),
            Err(error) => {
                tracing::error!(
                    %error,
                    connection_id,
                    "raw capture session map lock poisoned during connection finish"
                );
                None
            }
        };
        if let Some(session) = &session {
            match session.lock() {
                Ok(mut session) => {
                    if let Err(error) = Self::complete_upgrade_response(&mut session) {
                        session.invalid = true;
                        tracing::error!(
                            error = %error,
                            connection_id,
                            "failed to complete HTTP Upgrade capture at connection finish"
                        );
                    }
                }
                Err(error) => {
                    tracing::error!(
                        error = %error,
                        connection_id,
                        "raw capture session lock poisoned during connection finish"
                    );
                }
            }
        }
        let output_root = self.output_root.clone();
        Box::pin(async move {
            if let Some(session) = session {
                persist_raw_capture(output_root, connection_id, session, connection_clean).await;
            }
        })
    }
}

impl ClientStreamHook for RawCaptureHook {
    fn wrap(&self, context: &HttpContext, stream: ClientStream) -> ClientStream {
        let recorder = match self.start_session(context.connection_id) {
            Ok(recorder) => recorder,
            Err(()) => {
                tracing::error!(
                    connection_id = context.connection_id,
                    "raw capture recorder map poisoned"
                );
                CaptureRecorder::new()
            }
        };
        Box::new(crate::capture_io::CaptureIo::new_with_read_chunk_size(
            stream, recorder, 1,
        ))
    }

    fn request_started(
        &self,
        context: &HttpContext,
        request: &Request<hudsucker::hyper::body::Incoming>,
    ) {
        self.request_started_for(
            context.connection_id,
            ExactWireMetadata::from_request(request),
        );
    }

    fn request_completed(&self, context: &HttpContext) {
        self.request_completed_for(context.connection_id);
    }

    fn response_started(&self, context: &HttpContext, response: &Response<Body>) {
        self.response_started_for(
            context.connection_id,
            ExactWireMetadata::from_response(response),
        );
    }

    fn response_completed(&self, context: &HttpContext) {
        self.response_completed_for(context.connection_id);
    }

    fn finish(&self, context: HttpContext) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        self.finish_with_status(context, true)
    }

    fn finish_with_status(
        &self,
        context: HttpContext,
        connection_clean: bool,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        self.finish_connection(context.connection_id, connection_clean)
    }

    fn websocket_completed(&self, context: &HttpContext, clean: bool) {
        self.websocket_completed_for(context.connection_id, clean);
    }

    fn connection_aborted(&self, context: &HttpContext) {
        self.schedule_finish_connection(context.connection_id, false);
    }

    fn wait_for_background_tasks(&self) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(Self::wait_for_persistence_tasks(Arc::clone(
            &self.persistence_tasks,
        )))
    }
}

async fn persist_raw_capture(
    output_root: PathBuf,
    connection_id: u64,
    session: Arc<Mutex<RawCaptureSession>>,
    connection_clean: bool,
) {
    match tokio::task::spawn_blocking(move || {
        write_raw_capture(output_root, connection_id, session, connection_clean)
    })
    .await
    {
        Ok(Ok(Some(capture_dir))) => {
            tracing::info!(path = %capture_dir.display(), "wrote private raw capture");
        }
        Ok(Ok(None)) => {}
        Ok(Err(error)) => {
            tracing::warn!(error = %error, "failed to write private raw capture");
        }
        Err(error) => tracing::warn!(error = %error, "raw capture writer task failed"),
    }
}

struct RecorderReleaseOnDrop(crate::capture_io::CaptureRecorder);

impl Drop for RecorderReleaseOnDrop {
    fn drop(&mut self) {
        if let Err(error) = self.0.release() {
            tracing::error!(%error, "failed to release finalized raw capture buffers");
        }
    }
}

fn write_raw_capture(
    output_root: PathBuf,
    connection_id: u64,
    session: Arc<Mutex<RawCaptureSession>>,
    connection_clean: bool,
) -> Result<Option<PathBuf>, String> {
    let mut session = session
        .lock()
        .map_err(|_| "raw capture session lock poisoned".to_string())?;
    let completed_upgrade = RawCaptureHook::has_completed_upgrade(&session);
    let rejected_websocket_upgrade = !completed_upgrade
        && session.messages.iter().any(|message| {
            message.direction == ExactWireDirection::Request
                && message.metadata.is_websocket_upgrade_request()
        });
    let _release = RecorderReleaseOnDrop(session.recorder.clone());
    if session.invalid
        || (!connection_clean && !completed_upgrade)
        || session.active_request.is_some()
        || rejected_websocket_upgrade
    {
        return Ok(None);
    }
    session.provenance.mark_finished();
    let recorder = session.recorder.clone();
    if let Some(message_index) = session.active_response.take() {
        if session.messages[message_index].metadata.status() == Some(101) {
            return Ok(None);
        }
        let stream_end = recorder
            .direction_len(CaptureDirection::Response)
            .map_err(|error| error.to_string())?;
        session.messages[message_index].stream_end = Some(stream_end as u64);
    }
    if session.active_response.is_some() {
        return Ok(None);
    }
    let snapshot = recorder.snapshot().map_err(|error| error.to_string())?;
    let (request_bytes, response_bytes) = if session
        .messages
        .iter()
        .any(|message| message.metadata.status() == Some(101))
    {
        let request_end = session
            .messages
            .iter()
            .filter(|message| message.direction == ExactWireDirection::Request)
            .filter_map(|message| message.stream_end)
            .max()
            .ok_or_else(|| "WebSocket capture has no completed request boundary".to_string())?
            as usize;
        let response_end = session
            .messages
            .iter()
            .filter(|message| message.direction == ExactWireDirection::Response)
            .filter_map(|message| message.stream_end)
            .max()
            .ok_or_else(|| "WebSocket capture has no completed response boundary".to_string())?
            as usize;
        (
            snapshot
                .request_bytes()
                .get(..request_end)
                .ok_or_else(|| "WebSocket request boundary exceeds captured bytes".to_string())?,
            snapshot
                .response_bytes()
                .get(..response_end)
                .ok_or_else(|| "WebSocket response boundary exceeds captured bytes".to_string())?,
        )
    } else {
        (snapshot.request_bytes(), snapshot.response_bytes())
    };
    if request_bytes.is_empty() || response_bytes.is_empty() || session.messages.is_empty() {
        return Ok(None);
    }

    let messages = session
        .messages
        .iter()
        .map(|message| {
            let stream = match message.direction {
                ExactWireDirection::Request => request_bytes,
                ExactWireDirection::Response => response_bytes,
            };
            let stream_end = message
                .stream_end
                .ok_or_else(|| "message has no completed stream boundary".to_string())?;
            if stream_end as usize > stream.len() {
                return Err("message boundary exceeds captured stream".to_string());
            }
            ExactWireMessage::from_parts_with_metadata(
                stream[message.stream_start as usize..stream_end as usize].to_vec(),
                message.stream_start,
                stream_end,
                message.direction,
                message.sequence,
                message.metadata.clone(),
            )
            .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !session.messages.iter().any(|message| {
        message.direction == ExactWireDirection::Request
            && message
                .metadata
                .target()
                .is_some_and(|target| target.contains("/api_get_member/require_info"))
    }) {
        return Ok(None);
    }
    ExactWireCapture::from_transcript_with_provenance(
        request_bytes.to_vec(),
        response_bytes.to_vec(),
        messages,
        session.provenance.clone(),
    )
    .map_err(|error| error.to_string())?
    .write_private_raw_transcript(
        output_root,
        format!("{}-connection-{connection_id}", capture::next_capture_id()),
    )
    .map(Some)
    .map_err(|error| error.to_string())
}

#[derive(Clone)]
struct LogHandler {
    request_uri: Uri,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    save_path: String,
    file_prefix: String,
    allow_save_api_requests: bool,
    allow_save_api_responses: bool,
    allow_save_resources: bool,
    allow_save_main_js_local: bool,
    experimental_require_info_route: ExperimentalRequireInfoRoute,
}

impl HttpHandler for LogHandler {
    async fn handle_request(&mut self, ctx: &HttpContext, req: Request<Body>) -> RequestOrResponse {
        self.request_uri = req.uri().clone();

        let (part, body) = req.into_parts();

        let body_vec = match body.collect().await {
            Ok(collected) => collected.to_bytes().to_vec(),
            Err(e) => {
                tracing::warn!("failed to collect request body for logging: {}", e);
                Vec::new()
            }
        };
        let body = hyper::body::Bytes::from(body_vec);
        let full_body = http_body_util::Full::from(body.clone());

        let body_vec = body.to_vec();
        log_request(
            part.clone(),
            body_vec,
            self.request_uri.clone(),
            self.tx_proxy_log.clone(),
            self.save_path.clone(),
            self.file_prefix.clone(),
            self.allow_save_api_requests,
        );

        match self.experimental_require_info_route.decide(&part) {
            ExperimentalRequireInfoDecision::Forward => {}
            ExperimentalRequireInfoDecision::Selected => {
                let response = self
                    .experimental_require_info_route
                    .forward_selected(ctx.connection_id, part, body)
                    .await
                    .unwrap_or_else(|error| {
                        tracing::warn!(error = %error, "Experimental TLSN request was not forwarded");
                        Response::builder()
                            .status(http::StatusCode::SERVICE_UNAVAILABLE)
                            .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                            .body(hudsucker::Body::from(
                                "Experimental TLSN route failed closed; the request was not forwarded",
                            ))
                            .expect("failed to build Experimental TLSN response")
                    });
                return hudsucker::RequestOrResponse::Response(response);
            }
            ExperimentalRequireInfoDecision::Blocked => {
                return hudsucker::RequestOrResponse::Response(
                    Response::builder()
                        .status(http::StatusCode::SERVICE_UNAVAILABLE)
                        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
                        .body(hudsucker::Body::from(
                            "Experimental TLSN route rejected a repeated request",
                        ))
                        .expect("failed to build Experimental TLSN response"),
                );
            }
        }

        let reconstructed_body = hudsucker::Body::from(full_body);
        let reconstructed_resquest = Request::from_parts(part, reconstructed_body);

        return hudsucker::RequestOrResponse::Request(reconstructed_resquest);
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        let (part, body) = res.into_parts();

        let body_vec = match body.collect().await {
            Ok(collected) => collected.to_bytes().to_vec(),
            Err(e) => {
                tracing::warn!("failed to collect response body for logging: {}", e);
                Vec::new()
            }
        };
        let body = hyper::body::Bytes::from(body_vec);
        let full_body = http_body_util::Full::from(body.clone());

        let body_vec = body.to_vec();
        log_response(
            part.clone(),
            body_vec,
            self.request_uri.clone(),
            self.tx_proxy_log.clone(),
            self.save_path.clone(),
            self.file_prefix.clone(),
            self.allow_save_api_responses,
            self.allow_save_resources,
            self.allow_save_main_js_local,
        );

        let reconstructed_body = hudsucker::Body::from(full_body);
        let reconstructed_response = Response::from_parts(part, reconstructed_body);

        return reconstructed_response;
    }
}

pub fn create_ca(ca_save_path: String) {
    let ca_dir = Path::new(ca_save_path.as_str());
    let ca_key_pair = rcgen::KeyPair::generate().unwrap();

    let mut ca_param = rcgen::CertificateParams::default();
    ca_param.distinguished_name = rcgen::DistinguishedName::new();
    ca_param.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    ca_param
        .key_usages
        .push(rcgen::KeyUsagePurpose::DigitalSignature);
    ca_param
        .key_usages
        .push(rcgen::KeyUsagePurpose::KeyCertSign);
    ca_param.key_usages.push(rcgen::KeyUsagePurpose::CrlSign);
    ca_param.distinguished_name.push(
        rcgen::DnType::CountryName,
        rcgen::DnValue::PrintableString(COUNTRY_NAME.try_into().unwrap()),
    );
    ca_param
        .distinguished_name
        .push(rcgen::DnType::OrganizationName, ORGANIZATION_NAME);
    let ca_cert = ca_param.self_signed(&ca_key_pair).unwrap();

    let _ = fs::create_dir_all(ca_dir);

    let _ = fs::write(ca_dir.join(CA_CERT_NAME_PEM), ca_cert.pem());
    let _ = fs::write(ca_dir.join(CA_CERT_NAME_CRT), ca_cert.pem());
    let _ = fs::write(ca_dir.join(CA_CERT_NAME_DER), ca_cert.der());
    let _ = fs::write(ca_dir.join(CA_KEY_NAME_PEM), ca_key_pair.serialize_pem());
}

pub fn check_ca(ca_save_path: String) -> bool {
    let ca_dir = Path::new(ca_save_path.as_str());
    let ca_cert_pem = ca_dir.join(CA_CERT_NAME_PEM);
    let ca_cert_crt = ca_dir.join(CA_CERT_NAME_CRT);
    let ca_cert_der = ca_dir.join(CA_CERT_NAME_DER);
    let ca_key = ca_dir.join(CA_KEY_NAME_PEM);

    if !ca_cert_crt.exists() || !ca_cert_pem.exists() || !ca_cert_der.exists() || !ca_key.exists() {
        return false;
    }

    let key_pair_pem = match fs::read_to_string(&ca_key) {
        Ok(value) => value,
        Err(_) => return false,
    };
    let key_pair = match KeyPair::from_pem(&key_pair_pem) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let cert_pem_text = match fs::read_to_string(&ca_cert_pem) {
        Ok(value) => value,
        Err(_) => return false,
    };
    if CertificateParams::from_ca_cert_pem(&cert_pem_text)
        .and_then(|params| params.self_signed(&key_pair))
        .is_err()
    {
        return false;
    }

    let cert_crt_text = match fs::read_to_string(&ca_cert_crt) {
        Ok(value) => value,
        Err(_) => return false,
    };
    if CertificateParams::from_ca_cert_pem(&cert_crt_text)
        .and_then(|params| params.self_signed(&key_pair))
        .is_err()
    {
        return false;
    }

    let cert_der_bytes = match fs::read(&ca_cert_der) {
        Ok(value) => value,
        Err(_) => return false,
    };
    if cert_der_bytes.len() < 4 || cert_der_bytes[0] != 0x30 {
        return false;
    }

    true
}

fn available_port() -> std::io::Result<u16> {
    match std::net::TcpListener::bind("localhost:0") {
        Ok(listener) => Ok(listener.local_addr().unwrap().port()),
        Err(e) => Err(e),
    }
}

static CRYPTO_PROVIDER_LOCK: OnceLock<()> = OnceLock::new();

pub fn setup_default_crypto_provider() {
    CRYPTO_PROVIDER_LOCK.get_or_init(|| {
        // Another crate in the same process may initialize rustls first.
        // Treat that case as success to keep initialization order-independent.
        if let Err(err) = rustls::crypto::ring::default_provider().install_default() {
            tracing::debug!(error = ?err, "rustls crypto provider already initialized");
        }
    });
}

async fn wait_for_proxy_shutdown(
    mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) {
    loop {
        tokio::select! {
            recv_msg = slave.recv() => {
                match recv_msg {
                    None => {
                        tracing::warn!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                        tracing::info!("Received shutdown message: {} {}", status, message);
                        let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                            status: "SHUTTING DOWN".to_string(),
                            message: "Proxy server is shutting down".to_string(),
                        }).await;
                        break;
                    },
                    Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                        tracing::info!("Received health message: {} {}", status, message);
                        let _ = slave.send(bidirectional_channel::StatusInfo::HEALTH {
                            status: "RUNNING".to_string(),
                            message: "Proxy server is running".to_string(),
                        }).await;
                    },
                    _ => {}
                }
            },
            _ = tokio::signal::ctrl_c() => {
                break;
            },
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn serve_proxy(
    port: u16,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    log_save_path: String,
    asset_sync_save_path: String,
    ca_save_path: String,
    file_prefix: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    capture_runtime_metadata: Option<CaptureRuntimeMetadata>,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    serve_proxy_impl(
        port,
        slave,
        tx_proxy_log,
        log_save_path,
        asset_sync_save_path,
        ca_save_path,
        file_prefix,
        auth_manager,
        capture_runtime_metadata,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn serve_proxy_with_experimental_dependencies(
    port: u16,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    log_save_path: String,
    asset_sync_save_path: String,
    ca_save_path: String,
    file_prefix: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    capture_runtime_metadata: Option<CaptureRuntimeMetadata>,
    dependencies: ExperimentalTlsnDependencies,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    serve_proxy_impl(
        port,
        slave,
        tx_proxy_log,
        log_save_path,
        asset_sync_save_path,
        ca_save_path,
        file_prefix,
        auth_manager,
        capture_runtime_metadata,
        Some(dependencies.forwarder),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn serve_proxy_with_production_dependencies(
    port: u16,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    log_save_path: String,
    asset_sync_save_path: String,
    ca_save_path: String,
    file_prefix: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    capture_runtime_metadata: Option<CaptureRuntimeMetadata>,
    dependencies: crate::production_tlsn::ProductionTlsnDependencies,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    let forwarder = dependencies
        .build_forwarder()
        .map_err(|error| error.to_string())?;
    serve_proxy_impl(
        port,
        slave,
        tx_proxy_log,
        log_save_path,
        asset_sync_save_path,
        ca_save_path,
        file_prefix,
        auth_manager,
        capture_runtime_metadata,
        Some(forwarder),
    )
}

#[allow(clippy::too_many_arguments)]
fn serve_proxy_impl(
    port: u16,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    log_save_path: String,
    asset_sync_save_path: String,
    ca_save_path: String,
    file_prefix: String,
    _auth_manager: Arc<AuthManager<FileStorage>>,
    capture_runtime_metadata: Option<CaptureRuntimeMetadata>,
    injected_forwarder: Option<Arc<dyn ExperimentalRequireInfoForwarder>>,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    setup_default_crypto_provider();

    let configs = configs::get_user_configs_for_proxy();
    let _app_configs = configs::get_user_configs_for_app();
    let allow_save_api_requests = configs.get_allow_save_api_requests();
    let allow_save_api_responses = configs.get_allow_save_api_responses();
    let allow_save_resources = configs.get_allow_save_resources();
    let allow_save_main_js_local = configs.get_allow_save_main_js_local();
    let tlsn_experiment_enabled = configs.get_tlsn_experiment_enabled();
    let experimental_tlsn_forwarder: Option<Arc<dyn ExperimentalRequireInfoForwarder>> =
        injected_forwarder;
    let capture_output_root = if configs.get_capture_enabled() {
        match configs.get_capture_output_path().map(PathBuf::from) {
            Some(path) if path.is_absolute() => Some(path),
            Some(path) => {
                tracing::warn!(
                    path = %path.display(),
                    "require_info capture disabled because capture_output_path is not absolute"
                );
                None
            }
            None => None,
        }
    } else {
        None
    };
    if capture_output_root.is_some() {
        tracing::warn!(
            "require_info capture enabled; artifacts are client-facing TLS plaintext raw wire"
        );
    }

    let ca_dir = Path::new(ca_save_path.as_str());
    let use_generated_certs = configs.certificates.get_use_generated_certs();

    let custom_cert_file_path = configs.certificates.get_cert_file();
    let custom_key_file_path = configs.certificates.get_key_file();
    let (ca_cert_path, ca_key_path) = if use_generated_certs {
        (ca_dir.join(CA_CERT_NAME_PEM), ca_dir.join(CA_KEY_NAME_PEM))
    } else {
        let cert_path = custom_cert_file_path
            .ok_or("custom certificate mode requires certificates.cert_file")?;
        let key_path =
            custom_key_file_path.ok_or("custom certificate mode requires certificates.key_file")?;
        (cert_path, key_path)
    };

    tracing::info!(
        use_generated_certs,
        ca_cert_path = %ca_cert_path.display(),
        ca_key_path = %ca_key_path.display(),
        "proxy certificate paths resolved"
    );

    let key_pair_pem = fs::read_to_string(&ca_key_path).map_err(|e| {
        format!(
            "failed to open CA key file {}: {}",
            ca_key_path.display(),
            e
        )
    })?;
    let ca_cert_pem = fs::read_to_string(&ca_cert_path).map_err(|e| {
        format!(
            "failed to open CA cert file {}: {}",
            ca_cert_path.display(),
            e
        )
    })?;

    let key_pair = KeyPair::from_pem(&key_pair_pem).map_err(|e| {
        format!(
            "failed to parse private key {}: {}",
            ca_key_path.display(),
            e
        )
    })?;
    let ca_cert = CertificateParams::from_ca_cert_pem(&ca_cert_pem)
        .map_err(|e| {
            format!(
                "failed to parse CA certificate {}: {}",
                ca_cert_path.display(),
                e
            )
        })?
        .self_signed(&key_pair)
        .map_err(|e| {
            format!(
                "failed to self-sign CA certificate {}: {}",
                ca_cert_path.display(),
                e
            )
        })?;

    let ca = RcgenAuthority::new(key_pair, ca_cert, 1_000, aws_lc_rs::default_provider());

    let mut http = hyper_util::client::legacy::connect::HttpConnector::new();

    // http.enforce_http(false);
    http.enforce_http(configs.network.get_enforce_http());

    // http.set_connect_timeout(Some(Duration::from_secs(5)));
    http.set_connect_timeout(configs.network.get_connect_timeout());

    // http.set_keepalive_interval(Some(Duration::from_secs(20)));
    http.set_keepalive_interval(configs.network.get_keepalive_interval());

    // http.set_nodelay(true);
    http.set_nodelay(configs.network.get_set_nodelay());

    // http.set_recv_buffer_size(Some(8_000_000_usize));
    http.set_recv_buffer_size(configs.network.get_recv_buffer_size());
    // http.set_send_buffer_size(Some(8_000_000_usize));
    http.set_send_buffer_size(configs.network.get_send_buffer_size());

    let tls_root_store = {
        // use "rustls-native-certs" crate
        let mut roots = rustls::RootCertStore::empty();
        let native_certs = rustls_native_certs::load_native_certs();
        for cert in native_certs.certs {
            roots.add(cert).unwrap();
        }
        roots
    };

    let tls = rustls::ClientConfig::builder()
        .with_root_certificates(tls_root_store)
        .with_no_client_auth();

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_tls_config(tls)
        .https_or_http()
        .enable_http1()
        .wrap_connector(http);

    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build(https);
    let addr = match (port, configs.network.get_proxy_server_port()) {
        (0, 0) => SocketAddr::from(([127, 0, 0, 1], available_port().unwrap())),
        (0, port) => SocketAddr::from(([127, 0, 0, 1], port)),
        (port, _) => SocketAddr::from(([127, 0, 0, 1], port)),
    };
    let save_path = if let Some(save_path) = configs.get_save_file_location() {
        save_path
    } else {
        log_save_path.clone()
    };

    // Phase 1: Launch asset_sync in independent tokio task (non-blocking)
    // This prevents asset_sync initialization from blocking the proxy's main handler
    if _app_configs.asset_sync.get_enable() {
        let auth_manager_clone = _auth_manager.clone();
        let save_path_clone = save_path.clone();
        let asset_sync_save_path_clone = asset_sync_save_path.clone();
        let file_prefix_clone = file_prefix.clone();
        let app_configs_clone = _app_configs.clone();

        tokio::spawn(async move {
            match asset_sync::AssetSyncInit::from_configs(
                &app_configs_clone.asset_sync,
                save_path_clone,
                asset_sync_save_path_clone,
                if file_prefix_clone.trim().is_empty() {
                    None
                } else {
                    Some(file_prefix_clone)
                },
            ) {
                Ok(init) => {
                    tracing::info!("Starting asset sync worker in background task");
                    if let Err(err) = asset_sync::start(init, auth_manager_clone) {
                        tracing::warn!("failed to start asset sync: {}", err);
                    }
                }
                Err(err) => {
                    tracing::warn!("asset sync disabled due to invalid configuration: {}", err);
                }
            }
        });
    } else {
        tracing::info!("asset sync disabled in configuration");
    }

    let proxy_builder = Proxy::builder()
        .with_addr(addr)
        .with_ca(ca)
        .with_client(client)
        .with_http_handler(LogHandler {
            tx_proxy_log: tx_proxy_log.clone(),
            request_uri: Uri::default(),
            save_path,
            file_prefix: file_prefix.clone(),
            allow_save_api_requests,
            allow_save_api_responses,
            allow_save_resources,
            allow_save_main_js_local,
            experimental_require_info_route: ExperimentalRequireInfoRoute::new(
                tlsn_experiment_enabled,
                experimental_tlsn_forwarder,
            ),
        });

    match capture_output_root {
        Some(output_root) => {
            let capture_hook = capture_runtime_metadata.map_or_else(
                || RawCaptureHook::new(output_root.clone()),
                |metadata| RawCaptureHook::new_natural_candidate(output_root.clone(), metadata),
            );
            let server_proxy = proxy_builder
                .with_client_stream_hook(capture_hook)
                .with_graceful_shutdown(wait_for_proxy_shutdown(slave))
                .build()
                .expect_or_log("Failed to create proxy");
            tokio::task::spawn(server_proxy.start());
        }
        None => {
            let server_proxy = proxy_builder
                .with_graceful_shutdown(wait_for_proxy_shutdown(slave))
                .build()
                .expect_or_log("Failed to create proxy");
            tokio::task::spawn(server_proxy.start());
        }
    }

    tracing::info!("Proxy server addr: {}", addr);

    Ok(addr)
}

#[cfg(test)]
mod tests {
    use super::rcgen::{CertificateParams, KeyPair};
    use super::{
        check_ca, create_ca, decode_response_body, parse_content_encodings, ClientStreamHook,
        ExactWireDirection, ExactWireMetadata, ExperimentalForwardFuture,
        ExperimentalRequireInfoDecision, ExperimentalRequireInfoForwarder,
        ExperimentalRequireInfoRoute, HttpContext, LogHandler, RawCaptureHook, RawCaptureMessage,
        CA_CERT_NAME_CRT, CA_CERT_NAME_DER, CA_CERT_NAME_PEM, CA_KEY_NAME_PEM,
    };
    #[cfg(feature = "synthetic-tlsn")]
    use crate::experimental_tlsn::{
        sha256, AttestationBinding, AttestationBindingProvider, BindingFuture,
        ExperimentalResultBoundary, ExperimentalTlsnRuntimeState, ExperimentalVerifierBoundary,
        Http1OriginRequestSerializer, OriginRequestSerializer, ResultBoundaryFuture,
        SerializedOriginRequest, TlsnEvidenceMetadata, TlsnOriginExchange, TlsnOriginTransport,
        VerificationError, VerificationFuture, VerificationOutcome, VerifiedMemberId,
        VerifiedTlsnEvidence,
    };
    use http::{Request as HttpRequest, Response as HttpResponse, Uri};
    use http_body_util::BodyExt;
    use hudsucker::{
        futures::{Sink, Stream},
        hyper::{Request, Response},
        HttpHandler,
    };
    use hyper::body::Bytes;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

    #[cfg(feature = "synthetic-tlsn")]
    use crate::synthetic_tlsn::SyntheticAlpha15OriginTransport;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fusou_proxy_https_{name}_{stamp}"))
    }

    #[derive(Clone)]
    struct OutcomeCaptureHook {
        capture: RawCaptureHook,
        outcomes: Arc<Mutex<Vec<bool>>>,
    }

    type TestWebSocketMessage = hudsucker::tokio_tungstenite::tungstenite::Message;
    type TestWebSocketError = hudsucker::tokio_tungstenite::tungstenite::Error;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum HudsuckerForwarderFault {
        None,
        ReadIo,
        WriteIo,
        Panic,
    }

    #[derive(Clone, Copy)]
    struct HudsuckerForwarderTestHandler {
        fault: HudsuckerForwarderFault,
    }

    struct InjectedReadFailure<S> {
        inner: S,
        fail_next_read: bool,
    }

    impl<S> Stream for InjectedReadFailure<S>
    where
        S: Stream<Item = Result<TestWebSocketMessage, TestWebSocketError>> + Unpin,
    {
        type Item = Result<TestWebSocketMessage, TestWebSocketError>;

        fn poll_next(
            mut self: std::pin::Pin<&mut Self>,
            context: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Option<Self::Item>> {
            let this = self.as_mut().get_mut();
            if this.fail_next_read {
                this.fail_next_read = false;
                return std::task::Poll::Ready(Some(Err(TestWebSocketError::Io(
                    std::io::Error::new(
                        std::io::ErrorKind::ConnectionReset,
                        "injected WebSocket forwarder read failure",
                    ),
                ))));
            }
            std::pin::Pin::new(&mut this.inner).poll_next(context)
        }
    }

    struct InjectedWriteFailure<S> {
        inner: S,
        fail_next_write: bool,
    }

    impl<S> Sink<TestWebSocketMessage> for InjectedWriteFailure<S>
    where
        S: Sink<TestWebSocketMessage, Error = TestWebSocketError> + Unpin,
    {
        type Error = TestWebSocketError;

        fn poll_ready(
            mut self: std::pin::Pin<&mut Self>,
            context: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Result<(), Self::Error>> {
            let this = self.as_mut().get_mut();
            if this.fail_next_write {
                this.fail_next_write = false;
                return std::task::Poll::Ready(Err(TestWebSocketError::Io(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "injected WebSocket forwarder write failure",
                ))));
            }
            std::pin::Pin::new(&mut this.inner).poll_ready(context)
        }

        fn start_send(
            mut self: std::pin::Pin<&mut Self>,
            item: TestWebSocketMessage,
        ) -> Result<(), Self::Error> {
            std::pin::Pin::new(&mut self.as_mut().get_mut().inner).start_send(item)
        }

        fn poll_flush(
            mut self: std::pin::Pin<&mut Self>,
            context: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Result<(), Self::Error>> {
            std::pin::Pin::new(&mut self.as_mut().get_mut().inner).poll_flush(context)
        }

        fn poll_close(
            mut self: std::pin::Pin<&mut Self>,
            context: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Result<(), Self::Error>> {
            std::pin::Pin::new(&mut self.as_mut().get_mut().inner).poll_close(context)
        }
    }

    impl hudsucker::WebSocketHandler for HudsuckerForwarderTestHandler {
        fn handle_websocket(
            self,
            _context: hudsucker::WebSocketContext,
            stream: impl Stream<Item = Result<TestWebSocketMessage, TestWebSocketError>>
                + Unpin
                + Send
                + 'static,
            sink: impl Sink<TestWebSocketMessage, Error = TestWebSocketError> + Unpin + Send + 'static,
        ) -> impl std::future::Future<Output = ()> + Send {
            use hudsucker::futures::{SinkExt, StreamExt};

            let mut stream: std::pin::Pin<
                Box<dyn Stream<Item = Result<TestWebSocketMessage, TestWebSocketError>> + Send>,
            > = match self.fault {
                HudsuckerForwarderFault::ReadIo => Box::pin(InjectedReadFailure {
                    inner: stream,
                    fail_next_read: true,
                }),
                _ => Box::pin(stream),
            };
            let mut sink: std::pin::Pin<
                Box<dyn Sink<TestWebSocketMessage, Error = TestWebSocketError> + Send>,
            > = match self.fault {
                HudsuckerForwarderFault::WriteIo => Box::pin(InjectedWriteFailure {
                    inner: sink,
                    fail_next_write: true,
                }),
                _ => Box::pin(sink),
            };
            let fault = self.fault;

            async move {
                while let Some(message) = stream.next().await {
                    match message {
                        Ok(message) => {
                            if fault == HudsuckerForwarderFault::Panic {
                                panic!("injected WebSocket forwarder task panic");
                            }
                            if let Err(error) = sink.send(message).await {
                                tracing::warn!(%error, "WebSocket forwarder test sink failed");
                                break;
                            }
                        }
                        Err(error) => {
                            tracing::warn!(%error, "WebSocket forwarder test stream failed");
                            let _ = sink.send(TestWebSocketMessage::Close(None)).await;
                            break;
                        }
                    }
                }
            }
        }
    }

    #[derive(Clone, Copy)]
    enum HudsuckerWebSocketCase {
        CleanClose,
        OneSidedClose,
        ClientDisconnect,
        UpstreamDisconnect,
        UpstreamProtocolError,
        UpstreamHandshakeFailure,
        ForwarderReadIoFailure,
        ForwarderWriteIoFailure,
        ForwarderTaskPanic,
        ProxyShutdown,
        ProxyTaskAbort,
    }

    fn assert_websocket_101_semantics(response_wire: &[u8]) {
        let text = std::str::from_utf8(response_wire).expect("101 response is ASCII");
        let mut lines = text.split("\r\n");
        assert_eq!(lines.next(), Some("HTTP/1.1 101 Switching Protocols"));
        let headers = lines
            .take_while(|line| !line.is_empty())
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_ascii_lowercase()))
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            headers.get("upgrade").map(String::as_str),
            Some("websocket")
        );
        assert!(headers
            .get("connection")
            .is_some_and(|value| value.split(',').any(|token| token.trim() == "upgrade")));
        assert_eq!(
            headers.get("sec-websocket-accept").map(String::as_str),
            Some("s3pplmbitxaq9kygzzhzrbk+xoo=")
        );
    }

    async fn assert_client_tls_closed<S>(stream: &mut S)
    where
        S: AsyncRead + Unpin,
    {
        let mut byte = [0; 1];
        match tokio::time::timeout(std::time::Duration::from_secs(3), stream.read(&mut byte))
            .await
            .expect("client socket remained open after proxy task termination")
        {
            Ok(0) | Err(_) => {}
            Ok(count) => panic!("unexpected bytes after proxy task termination: {count}"),
        }
    }

    impl ClientStreamHook for OutcomeCaptureHook {
        fn wrap(
            &self,
            context: &hudsucker::HttpContext,
            stream: hudsucker::ClientStream,
        ) -> hudsucker::ClientStream {
            self.capture.wrap(context, stream)
        }

        fn finish(
            &self,
            context: HttpContext,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
            self.capture.finish(context)
        }

        fn finish_with_status(
            &self,
            context: HttpContext,
            connection_clean: bool,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
            self.capture.finish_with_status(context, connection_clean)
        }

        fn request_started(
            &self,
            context: &HttpContext,
            request: &Request<hudsucker::hyper::body::Incoming>,
        ) {
            self.capture.request_started(context, request);
        }

        fn request_completed(&self, context: &HttpContext) {
            self.capture.request_completed(context);
        }

        fn response_started(&self, context: &HttpContext, response: &Response<hudsucker::Body>) {
            self.capture.response_started(context, response);
        }

        fn response_completed(&self, context: &HttpContext) {
            self.capture.response_completed(context);
        }

        fn websocket_completed(&self, _context: &HttpContext, clean: bool) {
            self.outcomes
                .lock()
                .expect("WebSocket outcomes")
                .push(clean);
        }

        fn connection_aborted(&self, context: &HttpContext) {
            self.capture.connection_aborted(context);
        }

        fn wait_for_background_tasks(
            &self,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
            self.capture.wait_for_background_tasks()
        }
    }

    fn gzip_compress(input: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder
            .write_all(input)
            .expect("failed to write gzip input");
        encoder.finish().expect("failed to finish gzip")
    }

    fn br_compress(input: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut writer = brotli::CompressorWriter::new(&mut out, 4096, 5, 22);
            writer
                .write_all(input)
                .expect("failed to write brotli input");
        }
        out
    }

    #[test]
    fn experimental_require_info_route_is_disabled_by_default() {
        let route = ExperimentalRequireInfoRoute::new(false, None);
        let request = HttpRequest::builder()
            .method("POST")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info")
            .body(())
            .unwrap();
        let (parts, ()) = request.into_parts();

        assert_eq!(
            route.decide(&parts),
            ExperimentalRequireInfoDecision::Forward
        );
    }

    #[test]
    fn experimental_require_info_route_selects_actual_post_once_and_blocks_retries() {
        let route = ExperimentalRequireInfoRoute::new(true, None);
        let non_target = HttpRequest::builder()
            .method("GET")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info")
            .body(())
            .unwrap();
        let target = HttpRequest::builder()
            .method("POST")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info")
            .body(())
            .unwrap();
        let query_target = HttpRequest::builder()
            .method("POST")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info?api_token=x")
            .body(())
            .unwrap();
        let (non_target_parts, ()) = non_target.into_parts();
        let (target_parts, ()) = target.into_parts();
        let (query_target_parts, ()) = query_target.into_parts();

        assert_eq!(
            route.decide(&non_target_parts),
            ExperimentalRequireInfoDecision::Forward
        );
        assert_eq!(
            route.decide(&query_target_parts),
            ExperimentalRequireInfoDecision::Forward
        );
        assert_eq!(
            route.decide(&target_parts),
            ExperimentalRequireInfoDecision::Selected
        );
        assert_eq!(
            route.decide(&target_parts),
            ExperimentalRequireInfoDecision::Blocked
        );
    }

    struct RecordingExperimentalForwarder {
        requests: Arc<Mutex<Vec<Vec<u8>>>>,
    }

    impl ExperimentalRequireInfoForwarder for RecordingExperimentalForwarder {
        fn forward(
            &self,
            _connection_id: u64,
            request: Request<hyper::body::Bytes>,
        ) -> ExperimentalForwardFuture {
            let requests = Arc::clone(&self.requests);
            Box::pin(async move {
                requests
                    .lock()
                    .expect("recording forwarder lock")
                    .push(request.body().to_vec());
                Ok(Response::new(hudsucker::Body::from("local tlsn response")))
            })
        }
    }

    #[cfg(feature = "synthetic-tlsn")]
    fn integration_binding_value() -> String {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        use fusou_tlsn_verifier::BINDING_PREFIX;
        use uuid::Uuid;

        let mut value = Vec::new();
        value.extend_from_slice(BINDING_PREFIX);
        value.extend_from_slice(&16_u16.to_be_bytes());
        value.extend_from_slice(
            Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000")
                .expect("integration session ID")
                .as_bytes(),
        );
        value.extend_from_slice(&32_u16.to_be_bytes());
        value.extend_from_slice(&[0x42_u8; 32]);
        URL_SAFE_NO_PAD.encode(value)
    }

    #[cfg(feature = "synthetic-tlsn")]
    struct IntegrationBindingProvider {
        calls: Arc<std::sync::atomic::AtomicUsize>,
        connection_ids: Arc<Mutex<Vec<u64>>>,
        targets: Arc<Mutex<Vec<String>>>,
        value: String,
    }

    #[cfg(feature = "synthetic-tlsn")]
    impl AttestationBindingProvider for IntegrationBindingProvider {
        fn issue_binding(
            &self,
            context: crate::experimental_tlsn::BindingRequestContext,
        ) -> BindingFuture {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.connection_ids
                .lock()
                .expect("integration connection IDs lock")
                .push(context.connection_id());
            self.targets
                .lock()
                .expect("integration targets lock")
                .push(context.target().to_owned());
            let value = self.value.clone();
            Box::pin(async move { AttestationBinding::new(value) })
        }
    }

    #[cfg(feature = "synthetic-tlsn")]
    struct IntegrationVerifier {
        calls: Arc<std::sync::atomic::AtomicUsize>,
        exchange: Arc<Mutex<Option<TlsnOriginExchange>>>,
    }

    #[cfg(feature = "synthetic-tlsn")]
    impl ExperimentalVerifierBoundary for IntegrationVerifier {
        fn verify(
            &self,
            connection_id: u64,
            request: SerializedOriginRequest,
            binding: AttestationBinding,
            exchange: TlsnOriginExchange,
        ) -> VerificationFuture {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            *self.exchange.lock().expect("integration exchange lock") = Some(exchange.clone());
            let request_sha256 = sha256(request.bytes());
            let response_sha256 = sha256(&exchange.response.raw_response_bytes);
            let binding_identifier = sha256(binding.value().as_bytes());
            Box::pin(async move {
                if exchange.transcript.request_sha256 != request_sha256
                    || exchange.transcript.response_sha256 != response_sha256
                {
                    return Err(VerificationError::InvalidTranscript);
                }
                Ok(VerificationOutcome::Verified(
                    VerifiedTlsnEvidence::from_verifier(
                        request_sha256,
                        response_sha256,
                        VerifiedMemberId::from_verifier("16189463".to_owned())?,
                    )
                    .with_metadata(TlsnEvidenceMetadata::new(
                        connection_id,
                        binding_identifier,
                        Some("game.example.test".to_owned()),
                        request_sha256,
                        response_sha256,
                        None,
                        None,
                    )),
                ))
            })
        }
    }

    #[cfg(feature = "synthetic-tlsn")]
    struct IntegrationResultBoundary {
        calls: Arc<std::sync::atomic::AtomicUsize>,
        evidence: Arc<Mutex<Option<VerifiedTlsnEvidence>>>,
    }

    #[cfg(feature = "synthetic-tlsn")]
    impl ExperimentalResultBoundary for IntegrationResultBoundary {
        fn accept(&self, evidence: VerifiedTlsnEvidence) -> ResultBoundaryFuture {
            self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            *self.evidence.lock().expect("integration evidence lock") = Some(evidence);
            Box::pin(async { Ok(()) })
        }
    }

    #[cfg(feature = "synthetic-tlsn")]
    fn actual_require_info_request() -> Request<hudsucker::Body> {
        Request::builder()
            .method("POST")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info")
            .header("Host", "game.example.test")
            .header("Content-Length", "11")
            .header("Connection", "close")
            .body(hudsucker::Body::from("actual body"))
            .expect("actual require_info request")
    }

    #[cfg(feature = "synthetic-tlsn")]
    fn test_handler(route: ExperimentalRequireInfoRoute) -> LogHandler {
        let channel = super::bidirectional_channel::BidirectionalChannel::new(2);
        LogHandler {
            request_uri: Uri::default(),
            tx_proxy_log: channel.clone_master(),
            save_path: String::new(),
            file_prefix: String::new(),
            allow_save_api_requests: false,
            allow_save_api_responses: false,
            allow_save_resources: false,
            allow_save_main_js_local: false,
            experimental_require_info_route: route,
        }
    }

    #[tokio::test]
    async fn selected_actual_request_uses_only_the_experimental_forwarder() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let route = ExperimentalRequireInfoRoute::new(
            true,
            Some(Arc::new(RecordingExperimentalForwarder {
                requests: Arc::clone(&requests),
            })),
        );
        let request = HttpRequest::builder()
            .method("POST")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info")
            .body(hyper::body::Bytes::from_static(b"actual body"))
            .unwrap();
        let (parts, body) = request.into_parts();

        assert_eq!(
            route.decide(&parts),
            ExperimentalRequireInfoDecision::Selected
        );
        let response = route
            .forward_selected(7, parts, body)
            .await
            .expect("experimental forwarder response");
        assert_eq!(response.status(), http::StatusCode::OK);
        assert_eq!(
            requests
                .lock()
                .expect("recording forwarder lock")
                .as_slice(),
            [b"actual body".to_vec()]
        );
        assert_eq!(
            route.decide(
                &HttpRequest::builder()
                    .method("POST")
                    .uri("https://game.example.test/kcsapi/api_get_member/require_info")
                    .body(())
                    .unwrap()
                    .into_parts()
                    .0,
            ),
            ExperimentalRequireInfoDecision::Blocked
        );
    }

    #[tokio::test]
    async fn handler_routes_the_actual_request_once_without_production_fallback() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let route = ExperimentalRequireInfoRoute::new(
            true,
            Some(Arc::new(RecordingExperimentalForwarder {
                requests: Arc::clone(&requests),
            })),
        );
        let channel = super::bidirectional_channel::BidirectionalChannel::new(2);
        let mut handler = LogHandler {
            request_uri: Uri::default(),
            tx_proxy_log: channel.clone_master(),
            save_path: String::new(),
            file_prefix: String::new(),
            allow_save_api_requests: false,
            allow_save_api_responses: false,
            allow_save_resources: false,
            allow_save_main_js_local: false,
            experimental_require_info_route: route,
        };
        let context = HttpContext::new("127.0.0.1:40000".parse().unwrap(), 7);

        let make_request = || {
            Request::builder()
                .method("POST")
                .uri("https://game.example.test/kcsapi/api_get_member/require_info")
                .header("Host", "game.example.test")
                .header("Content-Length", "11")
                .body(hudsucker::Body::from("actual body"))
                .unwrap()
        };

        let first = handler.handle_request(&context, make_request()).await;
        let second = handler.handle_request(&context, make_request()).await;

        let hudsucker::RequestOrResponse::Response(first) = first else {
            panic!("first require_info request was not handled experimentally");
        };
        assert_eq!(first.status(), http::StatusCode::OK);
        let hudsucker::RequestOrResponse::Response(second) = second else {
            panic!("repeated require_info request was forwarded to Production");
        };
        assert_eq!(second.status(), http::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            requests
                .lock()
                .expect("recording forwarder lock")
                .as_slice(),
            [b"actual body".to_vec()]
        );
    }

    #[cfg(feature = "synthetic-tlsn")]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn actual_handler_runs_concrete_alpha15_transport_and_returns_origin_response() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::time::Instant;

        let binding_value = integration_binding_value();
        let binding_calls = Arc::new(AtomicUsize::new(0));
        let connection_ids = Arc::new(Mutex::new(Vec::new()));
        let targets = Arc::new(Mutex::new(Vec::new()));
        let verifier_calls = Arc::new(AtomicUsize::new(0));
        let result_calls = Arc::new(AtomicUsize::new(0));
        let exchange = Arc::new(Mutex::new(None));
        let evidence = Arc::new(Mutex::new(None));
        let transport =
            Arc::new(SyntheticAlpha15OriginTransport::new().expect("synthetic alpha.15 transport"));
        let forwarder = super::ExperimentalTlsnForwarder::new(
            Arc::new(IntegrationBindingProvider {
                calls: Arc::clone(&binding_calls),
                connection_ids: Arc::clone(&connection_ids),
                targets: Arc::clone(&targets),
                value: binding_value.clone(),
            }),
            Arc::new(Http1OriginRequestSerializer),
            Arc::clone(&transport) as Arc<dyn TlsnOriginTransport>,
            Arc::new(IntegrationVerifier {
                calls: Arc::clone(&verifier_calls),
                exchange: Arc::clone(&exchange),
            }),
            Arc::new(IntegrationResultBoundary {
                calls: Arc::clone(&result_calls),
                evidence: Arc::clone(&evidence),
            }),
        );
        let route = ExperimentalRequireInfoRoute::new(true, Some(forwarder.clone()));
        let mut handler = test_handler(route);
        let context = HttpContext::new("127.0.0.1:40002".parse().unwrap(), 73);

        let request_started = Instant::now();
        let first = handler
            .handle_request(&context, actual_require_info_request())
            .await;
        let browser_response_latency = request_started.elapsed();
        let hudsucker::RequestOrResponse::Response(first) = first else {
            panic!("actual require_info request did not use Experimental TLSN");
        };
        let first_status = first.status();
        let first_body = first
            .into_body()
            .collect()
            .await
            .expect("synthetic origin response body")
            .to_bytes();

        let second = handler
            .handle_request(&context, actual_require_info_request())
            .await;
        let hudsucker::RequestOrResponse::Response(second) = second else {
            panic!("repeated require_info request reached Production");
        };

        let expected_parts = HttpRequest::builder()
            .method("POST")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info")
            .header("Host", "game.example.test")
            .header("Content-Length", "11")
            .header("Connection", "close")
            .body(())
            .expect("expected request parts")
            .into_parts()
            .0;
        let expected_serialized = Http1OriginRequestSerializer
            .serialize(
                &expected_parts,
                Bytes::from_static(b"actual body"),
                &AttestationBinding::new(binding_value).expect("integration binding"),
            )
            .expect("serialized actual request");
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                if forwarder.state().expect("runtime state")
                    == ExperimentalTlsnRuntimeState::ResultReady
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("synthetic proof pipeline did not complete");
        let total_latency = request_started.elapsed();
        let timing = transport.timing().expect("synthetic timing");
        let proof_generation_latency = timing
            .proof_generation_latency
            .expect("synthetic proof timing");
        let additional_browser_latency =
            browser_response_latency.saturating_sub(timing.origin_capture_latency);
        eprintln!(
            "synthetic alpha15 timing: game_server_response={:.3}ms browser_response={:.3}ms additional_browser={:.3}ms proof_generation={:.3}ms total={:.3}ms",
            timing.origin_capture_latency.as_secs_f64() * 1000.0,
            browser_response_latency.as_secs_f64() * 1000.0,
            additional_browser_latency.as_secs_f64() * 1000.0,
            proof_generation_latency.as_secs_f64() * 1000.0,
            total_latency.as_secs_f64() * 1000.0,
        );
        let wire = transport.wire_evidence().expect("synthetic wire evidence");
        let captured_exchange = exchange
            .lock()
            .expect("integration exchange lock")
            .clone()
            .expect("authenticated exchange");
        let captured_evidence = evidence
            .lock()
            .expect("integration evidence lock")
            .clone()
            .expect("verified evidence");

        assert_eq!(first_status, http::StatusCode::OK);
        assert!(first_body.starts_with(b"svdata={\"api_result\":1"));
        assert_eq!(second.status(), http::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            binding_calls.load(Ordering::SeqCst),
            1,
            "binding must be issued exactly once"
        );
        assert_eq!(connection_ids.lock().unwrap().as_slice(), [73]);
        assert_eq!(
            targets.lock().unwrap().as_slice(),
            ["/kcsapi/api_get_member/require_info"]
        );
        assert_eq!(verifier_calls.load(Ordering::SeqCst), 1);
        assert_eq!(result_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            forwarder.state().expect("runtime state"),
            ExperimentalTlsnRuntimeState::ResultReady
        );
        assert_eq!(wire.origin_request, expected_serialized.bytes());
        assert_eq!(wire.authenticated_request, expected_serialized.bytes());
        assert_eq!(wire.origin_response, wire.authenticated_response);
        assert!(wire.presentation_available);
        assert!(wire
            .presentation
            .as_ref()
            .is_some_and(|bytes| !bytes.is_empty()));
        assert_eq!(
            captured_exchange.transcript.request_sha256,
            sha256(&expected_serialized.bytes())
        );
        assert_eq!(
            captured_exchange.transcript.response_sha256,
            sha256(&wire.origin_response)
        );
        assert_eq!(
            captured_evidence.request_sha256(),
            &sha256(&expected_serialized.bytes())
        );
        assert_eq!(
            captured_evidence.response_sha256(),
            &sha256(&wire.origin_response)
        );
        assert_eq!(captured_evidence.metadata().connection_id(), 73);
        assert_eq!(
            captured_evidence.metadata().binding_identifier(),
            &sha256(integration_binding_value().as_bytes())
        );
        assert_eq!(
            captured_evidence.metadata().server_identity(),
            Some("game.example.test")
        );
        assert_eq!(
            captured_evidence.metadata().authenticated_request_sha256(),
            &sha256(&wire.authenticated_request)
        );
        assert_eq!(
            captured_evidence.metadata().authenticated_response_sha256(),
            &sha256(&wire.authenticated_response)
        );
        assert_eq!(captured_evidence.metadata().presentation_identifier(), None);
        assert_eq!(captured_evidence.metadata().presentation_sha256(), None);
        assert_eq!(
            String::from_utf8_lossy(&wire.origin_request)
                .matches("x-attestation-binding:")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn disabled_actual_handler_returns_request_to_production_path() {
        let requests = Arc::new(Mutex::new(Vec::new()));
        let route = ExperimentalRequireInfoRoute::new(
            false,
            Some(Arc::new(RecordingExperimentalForwarder {
                requests: Arc::clone(&requests),
            })),
        );
        let channel = super::bidirectional_channel::BidirectionalChannel::new(2);
        let mut handler = LogHandler {
            request_uri: Uri::default(),
            tx_proxy_log: channel.clone_master(),
            save_path: String::new(),
            file_prefix: String::new(),
            allow_save_api_requests: false,
            allow_save_api_responses: false,
            allow_save_resources: false,
            allow_save_main_js_local: false,
            experimental_require_info_route: route,
        };
        let context = HttpContext::new("127.0.0.1:40003".parse().unwrap(), 74);

        let result = handler
            .handle_request(
                &context,
                Request::builder()
                    .method("POST")
                    .uri("https://game.example.test/kcsapi/api_get_member/require_info")
                    .header("Host", "game.example.test")
                    .header("Content-Length", "11")
                    .body(hudsucker::Body::from("actual body"))
                    .unwrap(),
            )
            .await;
        let hudsucker::RequestOrResponse::Request(request) = result else {
            panic!("disabled Experimental TLSN route intercepted Production request");
        };
        let body = request
            .into_body()
            .collect()
            .await
            .expect("production request body")
            .to_bytes();
        assert_eq!(body, Bytes::from_static(b"actual body"));
        assert!(requests.lock().unwrap().is_empty());
    }

    async fn read_http_message<S: AsyncRead + Unpin>(stream: &mut S) -> Vec<u8> {
        let mut message = Vec::new();
        let mut buffer = [0; 4096];
        let headers_end;
        loop {
            let bytes_read = stream.read(&mut buffer).await.expect("HTTP message read");
            assert!(bytes_read > 0, "stream closed before HTTP headers");
            message.extend_from_slice(&buffer[..bytes_read]);
            if let Some(position) = message.windows(4).position(|window| window == b"\r\n\r\n") {
                headers_end = position + 4;
                break;
            }
        }
        let headers = String::from_utf8_lossy(&message[..headers_end]).to_ascii_lowercase();
        if headers.contains("transfer-encoding: chunked") {
            while !message.windows(7).any(|window| window == b"\r\n0\r\n\r\n") {
                let bytes_read = stream.read(&mut buffer).await.expect("chunked body read");
                assert!(bytes_read > 0, "stream closed during chunked body");
                message.extend_from_slice(&buffer[..bytes_read]);
            }
        } else if let Some(content_length) = headers.lines().find_map(|line| {
            line.strip_prefix("content-length:")
                .and_then(|value| value.trim().parse::<usize>().ok())
        }) {
            while message.len() < headers_end + content_length {
                let bytes_read = stream.read(&mut buffer).await.expect("fixed body read");
                assert!(bytes_read > 0, "stream closed during fixed body");
                message.extend_from_slice(&buffer[..bytes_read]);
            }
        }
        message
    }

    async fn read_websocket_frame<S: AsyncRead + Unpin>(
        stream: &mut S,
    ) -> std::io::Result<(Vec<u8>, u8, Vec<u8>)> {
        let mut header = [0; 2];
        stream.read_exact(&mut header).await?;
        let payload_length = usize::from(header[1] & 0x7f);
        if payload_length >= 126 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "test WebSocket frame exceeds short payload range",
            ));
        }
        let mut raw = header.to_vec();
        let mask = if header[1] & 0x80 != 0 {
            let mut mask = [0; 4];
            stream.read_exact(&mut mask).await?;
            raw.extend_from_slice(&mask);
            Some(mask)
        } else {
            None
        };
        let mut payload = vec![0; payload_length];
        stream.read_exact(&mut payload).await?;
        raw.extend_from_slice(&payload);
        if let Some(mask) = mask {
            for (index, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask[index % mask.len()];
            }
        }
        Ok((raw, header[0] & 0x0f, payload))
    }

    #[tokio::test]
    async fn raw_capture_hook_persists_client_facing_wire_and_hashes() {
        let output_root = unique_temp_dir("raw_capture_hook");
        let hook = RawCaptureHook::new(output_root.clone());
        let context = HttpContext::new("127.0.0.1:40000".parse().expect("client address"), 42);
        let (mut peer, stream) = tokio::io::duplex(16 * 1024);
        let mut wrapped = hook.wrap(&context, Box::new(stream));
        let request =
            b"POST /kcsapi/api_get_member/require_info?x=1 HTTP/1.1\r\nHost: game\r\nContent-Length: 3\r\n\r\nabc";
        let response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";

        peer.write_all(request).await.expect("write request");
        let mut observed_request = vec![0; request.len()];
        wrapped
            .read_exact(&mut observed_request)
            .await
            .expect("read request");
        assert_eq!(observed_request, request);

        wrapped.write_all(response).await.expect("write response");
        let mut observed_response = vec![0; response.len()];
        peer.read_exact(&mut observed_response)
            .await
            .expect("read response");
        assert_eq!(observed_response, response);

        let request_metadata = ExactWireMetadata::from_request(
            &HttpRequest::builder()
                .method("POST")
                .uri("/kcsapi/api_get_member/require_info?x=1")
                .header("Host", "game")
                .header("Content-Length", "3")
                .body(())
                .expect("request metadata"),
        );
        let response_metadata = ExactWireMetadata::from_response(
            &HttpResponse::builder()
                .status(200)
                .header("Content-Length", "2")
                .body(())
                .expect("response metadata"),
        );
        let session = hook
            .session(context.connection_id)
            .expect("capture session");
        {
            let mut session = session.lock().expect("capture session lock");
            session.messages = vec![
                RawCaptureMessage {
                    direction: ExactWireDirection::Request,
                    sequence: 0,
                    stream_start: 0,
                    stream_end: Some(request.len() as u64),
                    metadata: request_metadata,
                },
                RawCaptureMessage {
                    direction: ExactWireDirection::Response,
                    sequence: 1,
                    stream_start: 0,
                    stream_end: Some(response.len() as u64),
                    metadata: response_metadata,
                },
            ];
        }
        drop(wrapped);
        hook.finish(context).await;

        let entries = std::fs::read_dir(&output_root)
            .expect("capture output root")
            .collect::<Result<Vec<_>, _>>()
            .expect("capture entries");
        assert_eq!(entries.len(), 1);
        let capture_dir = entries[0].path();
        let verification = crate::capture::verify_capture(&capture_dir).expect("verify capture");
        assert_eq!(verification.request_sha256, digest_hex(request));
        assert_eq!(verification.response_sha256, digest_hex(response));
        assert_eq!(
            std::fs::read(capture_dir.join("request-wire.bin")).expect("request wire"),
            request
        );
        assert_eq!(
            std::fs::read(capture_dir.join("response-wire.bin")).expect("response wire"),
            response
        );
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(capture_dir.join("manifest.json")).expect("manifest"),
        )
        .expect("manifest JSON");
        assert_eq!(manifest["messages"].as_array().unwrap().len(), 2);

        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test]
    async fn completed_upgrade_artifact_is_stable_across_callback_orderings() {
        async fn capture_in_order(
            output_root: PathBuf,
            connection_id: u64,
            finish_before_response_completed: bool,
            request: &[u8],
            response: &[u8],
        ) -> (Vec<u8>, Vec<u8>, serde_json::Value) {
            let hook = RawCaptureHook::new(output_root.clone());
            let context = HttpContext::new(
                "127.0.0.1:40100".parse().expect("client address"),
                connection_id,
            );
            let (mut peer, stream) = tokio::io::duplex(16 * 1024);
            let mut wrapped = hook.wrap(&context, Box::new(stream));
            let request_metadata = ExactWireMetadata::from_request(
                &HttpRequest::builder()
                    .method("GET")
                    .uri("/kcsapi/api_get_member/require_info")
                    .header("Host", "localhost")
                    .header("Upgrade", "websocket")
                    .header("Connection", "Upgrade")
                    .header("Sec-WebSocket-Version", "13")
                    .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                    .body(())
                    .expect("request metadata"),
            );
            let response_metadata = ExactWireMetadata::from_response(
                &HttpResponse::builder()
                    .status(101)
                    .header("Upgrade", "websocket")
                    .header("Connection", "Upgrade")
                    .header("Sec-WebSocket-Accept", "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
                    .body(())
                    .expect("response metadata"),
            );
            hook.request_started_for(connection_id, request_metadata);
            peer.write_all(request)
                .await
                .expect("write Upgrade request");
            let mut received_request = vec![0; request.len()];
            wrapped
                .read_exact(&mut received_request)
                .await
                .expect("capture Upgrade request");
            assert_eq!(received_request, request);
            hook.request_completed_for(connection_id);

            hook.response_started_for(connection_id, response_metadata);
            wrapped
                .write_all(response)
                .await
                .expect("write 101 response");
            let mut received_response = vec![0; response.len()];
            peer.read_exact(&mut received_response)
                .await
                .expect("receive client-facing 101");
            assert_eq!(received_response, response);
            let retained_session = hook
                .session(connection_id)
                .expect("Upgrade session before finalization");
            drop(wrapped);

            if finish_before_response_completed {
                hook.finish_connection(connection_id, false).await;
                hook.response_completed_for(connection_id);
            } else {
                hook.response_completed_for(connection_id);
                hook.finish_connection(connection_id, false).await;
            }

            let capture_dir = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    if let Ok(entries) = fs::read_dir(&output_root) {
                        if let Some(path) =
                            entries.flatten().map(|entry| entry.path()).find(|path| {
                                !path
                                    .file_name()
                                    .is_some_and(|name| name.to_string_lossy().starts_with('.'))
                                    && path.join("manifest.json").exists()
                            })
                        {
                            break path;
                        }
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("Upgrade artifact was not finalized");
            assert!(hook.session(connection_id).is_none());
            crate::capture::verify_capture(&capture_dir).expect("verify ordered Upgrade capture");
            let captured_request =
                fs::read(capture_dir.join("request-wire.bin")).expect("request artifact");
            let captured_response =
                fs::read(capture_dir.join("response-wire.bin")).expect("response artifact");
            assert_eq!(captured_request, request);
            assert_eq!(captured_response, response);
            let manifest: serde_json::Value = serde_json::from_slice(
                &fs::read(capture_dir.join("manifest.json")).expect("capture manifest"),
            )
            .expect("parse capture manifest");
            let messages = manifest["messages"]
                .as_array()
                .expect("capture message list");
            assert_eq!(messages.len(), 2);
            assert_eq!(messages[0]["direction"].as_str(), Some("request"));
            assert_eq!(
                messages[0]["stream_end"].as_u64(),
                Some(request.len() as u64)
            );
            assert_eq!(messages[1]["direction"].as_str(), Some("response"));
            assert_eq!(
                messages[1]["stream_end"].as_u64(),
                Some(response.len() as u64)
            );
            let manifest_messages = manifest["messages"].clone();
            let _ = fs::remove_dir_all(output_root);
            let snapshot = retained_session
                .lock()
                .expect("retained session")
                .recorder
                .snapshot()
                .expect("released recorder");
            assert!(snapshot.request_bytes().is_empty());
            assert!(snapshot.response_bytes().is_empty());
            (captured_request, captured_response, manifest_messages)
        }

        let request = b"GET /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        let response = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";
        let finish_first = capture_in_order(
            unique_temp_dir("upgrade_finish_first"),
            91,
            true,
            request,
            response,
        )
        .await;
        let response_first = capture_in_order(
            unique_temp_dir("upgrade_response_first"),
            92,
            false,
            request,
            response,
        )
        .await;
        assert_eq!(finish_first, response_first);
    }

    #[tokio::test]
    async fn unavailable_websocket_task_admission_releases_ineligible_capture() {
        let output_root = unique_temp_dir("unavailable_websocket_task");
        let connection_id = 93;
        let hook = RawCaptureHook::new(output_root.clone());
        let context = HttpContext::new(
            "127.0.0.1:40093".parse().expect("client address"),
            connection_id,
        );
        let (mut peer, stream) = tokio::io::duplex(16 * 1024);
        let mut wrapped = hook.wrap(&context, Box::new(stream));
        let request = b"GET /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        let response = b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n";
        let request_metadata = ExactWireMetadata::from_request(
            &HttpRequest::builder()
                .method("GET")
                .uri("/kcsapi/api_get_member/require_info")
                .header("Host", "localhost")
                .header("Upgrade", "websocket")
                .header("Connection", "Upgrade")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                .body(())
                .expect("request metadata"),
        );
        let response_metadata = ExactWireMetadata::from_response(
            &HttpResponse::builder()
                .status(503)
                .header("Content-Length", "0")
                .body(())
                .expect("503 response metadata"),
        );
        hook.request_started_for(connection_id, request_metadata);
        peer.write_all(request)
            .await
            .expect("write Upgrade request");
        let mut received_request = vec![0; request.len()];
        wrapped
            .read_exact(&mut received_request)
            .await
            .expect("capture Upgrade request");
        assert_eq!(received_request, request);
        hook.request_completed_for(connection_id);
        hook.response_started_for(connection_id, response_metadata);
        wrapped
            .write_all(response)
            .await
            .expect("write 503 response");
        let mut received_response = vec![0; response.len()];
        peer.read_exact(&mut received_response)
            .await
            .expect("receive client-facing 503");
        assert_eq!(received_response, response);
        hook.response_completed_for(connection_id);
        let retained_session = hook
            .session(connection_id)
            .expect("retain session until finish");
        drop(wrapped);

        hook.finish_connection(connection_id, true).await;

        assert!(hook.session(connection_id).is_none());
        assert!(
            !output_root.exists()
                || fs::read_dir(&output_root)
                    .expect("capture output root")
                    .next()
                    .is_none(),
            "a WebSocket request without a completed 101 must not produce an artifact"
        );
        let snapshot = retained_session
            .lock()
            .expect("finished session")
            .recorder
            .snapshot()
            .expect("released recorder");
        assert!(snapshot.request_bytes().is_empty());
        assert!(snapshot.response_bytes().is_empty());
    }

    #[tokio::test]
    async fn raw_capture_hook_does_not_finalize_dirty_or_incomplete_sessions() {
        let output_root = unique_temp_dir("raw_capture_hook_invalid");
        let hook = RawCaptureHook::new(output_root.clone());
        let context = HttpContext::new("127.0.0.1:40001".parse().expect("client address"), 43);
        let (mut peer, stream) = tokio::io::duplex(16 * 1024);
        let mut wrapped = hook.wrap(&context, Box::new(stream));
        let partial_request = b"GET /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: game";
        peer.write_all(partial_request)
            .await
            .expect("write partial request");
        let mut observed = vec![0; partial_request.len()];
        wrapped
            .read_exact(&mut observed)
            .await
            .expect("read partial request");
        drop(wrapped);

        hook.finish_with_status(context, false).await;

        assert!(!output_root.exists() || fs::read_dir(&output_root).unwrap().next().is_none());
        let _ = fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_captures_persistent_tls_plaintext_without_retry() {
        use hudsucker::{
            certificate_authority::RcgenAuthority,
            hyper_util::{client::legacy::Client, rt::TokioExecutor},
            rustls::crypto::aws_lc_rs,
            Proxy,
        };
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::net::TcpListener;
        use tokio::sync::oneshot;
        use tokio_rustls::{TlsAcceptor, TlsConnector};

        super::setup_default_crypto_provider();
        let output_root = unique_temp_dir("fork_proxy_integration");

        let upstream_cert =
            super::rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
                .expect("upstream certificate");
        let upstream_key = hudsucker::rustls::pki_types::PrivateKeyDer::Pkcs8(
            hudsucker::rustls::pki_types::PrivatePkcs8KeyDer::from(
                upstream_cert.key_pair.serialize_der(),
            ),
        );
        let upstream_server_config = hudsucker::rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![upstream_cert.cert.der().clone()], upstream_key)
            .expect("upstream server config");
        let upstream_acceptor = TlsAcceptor::from(std::sync::Arc::new(upstream_server_config));
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("upstream listener");
        let upstream_addr = upstream_listener.local_addr().expect("upstream address");
        let upstream_requests = std::sync::Arc::new(AtomicUsize::new(0));
        let upstream_requests_task = upstream_requests.clone();
        let upstream_task =
            tokio::spawn(async move {
                let (socket, _) = upstream_listener.accept().await.expect("upstream accept");
                let mut stream = upstream_acceptor
                    .accept(socket)
                    .await
                    .expect("upstream tls accept");
                for index in 0..3 {
                    let request = read_http_message(&mut stream).await;
                    if index == 1 {
                        assert!(request.starts_with(b"POST /kcsapi/api_get_member/require_info"));
                    } else {
                        assert!(request.starts_with(b"GET /kcsapi/api_get_member/require_info"));
                    }
                    upstream_requests_task.fetch_add(1, Ordering::SeqCst);
                    let response = match index {
                    0 => b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nr1"
                        .as_slice(),
                    1 => b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nr2"
                        .as_slice(),
                    _ => b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nr3"
                        .as_slice(),
                };
                    for chunk in response.chunks(index + 1) {
                        stream.write_all(chunk).await.expect("upstream response");
                    }
                }
                stream.shutdown().await.expect("upstream shutdown");
            });

        let proxy_key_pair = KeyPair::generate().expect("proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca =
            super::rcgen::IsCa::Ca(super::rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_cert = proxy_ca_params
            .self_signed(&proxy_key_pair)
            .expect("proxy CA certificate");
        let proxy_ca_der = proxy_ca_cert.der().clone();
        let proxy_ca = RcgenAuthority::new(
            proxy_key_pair,
            proxy_ca_cert,
            100,
            aws_lc_rs::default_provider(),
        );

        let mut upstream_roots = hudsucker::rustls::RootCertStore::empty();
        upstream_roots
            .add(upstream_cert.cert.der().clone())
            .expect("upstream root");
        let upstream_client_config = hudsucker::rustls::ClientConfig::builder()
            .with_root_certificates(upstream_roots)
            .with_no_client_auth();
        let upstream_connector = hyper_rustls::HttpsConnectorBuilder::new()
            .with_tls_config(upstream_client_config)
            .https_or_http()
            .enable_http1()
            .build();
        let upstream_client = Client::builder(TokioExecutor::new()).build(upstream_connector);

        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("proxy listener");
        let proxy_addr = proxy_listener.local_addr().expect("proxy address");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let mut shutdown_tx = Some(shutdown_tx);
        let proxy = Proxy::builder()
            .with_listener(proxy_listener)
            .with_ca(proxy_ca)
            .with_client(upstream_client)
            .with_http_handler(PassthroughHandler)
            .with_client_stream_hook(RawCaptureHook::new(output_root.clone()))
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .build()
            .expect("build proxy");
        let mut proxy_task = Some(tokio::spawn(proxy.start()));

        let mut client_socket = tokio::net::TcpStream::connect(proxy_addr)
            .await
            .expect("client connect");
        let authority = format!("localhost:{}", upstream_addr.port());
        let connect_request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
        client_socket
            .write_all(connect_request.as_bytes())
            .await
            .expect("connect request");
        let mut connect_response = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let bytes_read = client_socket
                .read(&mut buffer)
                .await
                .expect("connect response");
            assert!(bytes_read > 0, "proxy closed before CONNECT response");
            connect_response.extend_from_slice(&buffer[..bytes_read]);
            if connect_response
                .windows(4)
                .any(|window| window == b"\r\n\r\n")
            {
                break;
            }
        }
        assert!(connect_response.starts_with(b"HTTP/1.1 200"));

        let mut proxy_roots = hudsucker::rustls::RootCertStore::empty();
        proxy_roots.add(proxy_ca_der).expect("proxy root");
        let client_tls_config = hudsucker::rustls::ClientConfig::builder()
            .with_root_certificates(proxy_roots)
            .with_no_client_auth();
        let client_tls = TlsConnector::from(std::sync::Arc::new(client_tls_config));
        let server_name =
            hudsucker::rustls::pki_types::ServerName::try_from("localhost".to_string())
                .expect("proxy server name");
        let mut client_tls_stream = client_tls
            .connect(server_name, client_socket)
            .await
            .expect("client TLS handshake");
        let client_requests = [
            b"GET /kcsapi/api_get_member/require_info?x=1 HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n"
                .as_slice(),
            b"POST /kcsapi/api_get_member/require_info?x=2 HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n"
                .as_slice(),
            b"GET /kcsapi/api_get_member/require_info?x=3 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
                .as_slice(),
        ];
        let expected_response_bodies = [b"r1".as_slice(), b"r2".as_slice(), b"r3".as_slice()];
        let mut client_request_wire = Vec::new();
        let mut client_response_wire = Vec::new();
        for (index, request) in client_requests.iter().enumerate() {
            for chunk in request.chunks([1, 5, request.len()][index]) {
                client_tls_stream
                    .write_all(chunk)
                    .await
                    .expect("client request");
            }
            let mut response = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let bytes_read = client_tls_stream
                    .read(&mut buffer)
                    .await
                    .expect("client response");
                assert!(bytes_read > 0, "client closed before response {index}");
                response.extend_from_slice(&buffer[..bytes_read]);
                if response.windows(4).any(|window| window == b"\r\n\r\n")
                    && response.ends_with(expected_response_bodies[index])
                {
                    break;
                }
            }
            assert!(response.starts_with(b"HTTP/1.1 200 OK"));
            client_request_wire.extend_from_slice(request);
            client_response_wire.extend_from_slice(&response);
        }
        drop(client_tls_stream);

        upstream_task.await.expect("upstream task");
        assert_eq!(upstream_requests.load(Ordering::SeqCst), 3);

        let capture_dir = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if let Ok(mut entries) = std::fs::read_dir(&output_root) {
                    if let Some(path) = entries
                        .by_ref()
                        .flatten()
                        .map(|entry| (entry.file_name(), entry.path()))
                        .find_map(|(name, path)| {
                            let is_staging = name.to_string_lossy().starts_with('.');
                            (!is_staging && path.join("manifest.json").exists()).then_some(path)
                        })
                    {
                        break path;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("capture finalization timeout");
        crate::capture::verify_capture(&capture_dir).expect("verify integration capture");
        assert_eq!(
            std::fs::read(capture_dir.join("request-wire.bin")).expect("request wire"),
            client_request_wire
        );
        assert_eq!(
            std::fs::read(capture_dir.join("response-wire.bin")).expect("response wire"),
            client_response_wire
        );
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(capture_dir.join("manifest.json")).expect("manifest"),
        )
        .expect("manifest JSON");
        let messages = manifest["messages"].as_array().expect("message manifests");
        assert_eq!(messages.len(), 6);
        for (sequence, message) in messages.iter().enumerate() {
            assert_eq!(message["sequence"].as_u64(), Some(sequence as u64));
            let direction = message["direction"].as_str().expect("direction");
            let stream = if direction == "request" {
                &client_request_wire
            } else {
                assert_eq!(direction, "response");
                &client_response_wire
            };
            let start = message["stream_start"].as_u64().expect("stream start") as usize;
            let end = message["stream_end"].as_u64().expect("stream end") as usize;
            assert!(start < end);
            assert_eq!(message["body_bytes"].as_u64(), Some((end - start) as u64));
            assert_eq!(
                message["body_sha256"].as_str(),
                Some(digest_hex(&stream[start..end]).as_str())
            );
            if direction == "request" {
                if sequence == 2 {
                    assert!(
                        stream[start..end].starts_with(b"POST /kcsapi/api_get_member/require_info")
                    );
                    assert!(stream[start..end]
                        .windows(26)
                        .any(|window| { window == b"Transfer-Encoding: chunked" }));
                    assert!(stream[start..end].ends_with(b"0\r\n\r\n"));
                } else {
                    assert!(
                        stream[start..end].starts_with(b"GET /kcsapi/api_get_member/require_info")
                    );
                }
            } else {
                assert!(stream[start..end].starts_with(b"HTTP/1.1 200 OK"));
            }
        }

        shutdown_tx
            .take()
            .expect("proxy shutdown sender")
            .send(())
            .expect("proxy shutdown signal");
        proxy_task
            .take()
            .expect("proxy task")
            .await
            .expect("proxy task join")
            .expect("proxy shutdown");
        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_captures_only_websocket_upgrade_handshake_bytes() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::CleanClose).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_one_sided_close_keeps_handshake_artifact() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::OneSidedClose).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_client_disconnect_keeps_handshake_artifact() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::ClientDisconnect).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_upstream_disconnect_keeps_handshake_artifact() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::UpstreamDisconnect).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_upstream_protocol_error_keeps_handshake_artifact() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::UpstreamProtocolError).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_forwarder_read_io_failure_keeps_handshake_artifact() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::ForwarderReadIoFailure).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_forwarder_write_io_failure_keeps_handshake_artifact() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::ForwarderWriteIoFailure).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_forwarder_task_panic_keeps_handshake_artifact_and_listener_alive() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::ForwarderTaskPanic).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_shutdown_aborts_open_websocket_and_keeps_handshake_artifact() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::ProxyShutdown).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_outer_task_abort_closes_websocket_and_reports_unclean() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::ProxyTaskAbort).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_upstream_handshake_failure_does_not_send_101_or_capture() {
        run_hudsucker_websocket_case(HudsuckerWebSocketCase::UpstreamHandshakeFailure).await;
    }

    async fn run_hudsucker_websocket_case(case: HudsuckerWebSocketCase) {
        use hudsucker::{
            certificate_authority::RcgenAuthority,
            hyper_util::{client::legacy::Client, rt::TokioExecutor},
            rustls::crypto::aws_lc_rs,
            tokio_tungstenite::{tungstenite::handshake::derive_accept_key, Connector},
            Proxy,
        };
        use tokio::net::TcpListener;
        use tokio::sync::oneshot;
        use tokio_rustls::{TlsAcceptor, TlsConnector};

        super::setup_default_crypto_provider();
        let output_root = unique_temp_dir("fork_proxy_websocket_capture");
        let upstream_cert =
            super::rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
                .expect("upstream certificate");
        let upstream_key = hudsucker::rustls::pki_types::PrivateKeyDer::Pkcs8(
            hudsucker::rustls::pki_types::PrivatePkcs8KeyDer::from(
                upstream_cert.key_pair.serialize_der(),
            ),
        );
        let upstream_server_config = hudsucker::rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![upstream_cert.cert.der().clone()], upstream_key)
            .expect("upstream server config");
        let upstream_acceptor = TlsAcceptor::from(Arc::new(upstream_server_config));
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("upstream listener");
        let upstream_addr = upstream_listener.local_addr().expect("upstream address");
        let upstream_case = case;
        let upstream_task = tokio::spawn(async move {
            let (socket, _) = upstream_listener.accept().await.expect("upstream accept");
            let mut stream = upstream_acceptor
                .accept(socket)
                .await
                .expect("upstream TLS accept");
            let request = read_http_message(&mut stream).await;
            assert!(request.starts_with(b"GET /kcsapi/api_get_member/require_info HTTP/1.1"));
            if matches!(
                upstream_case,
                HudsuckerWebSocketCase::UpstreamHandshakeFailure
            ) {
                stream
                    .write_all(
                        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await
                    .expect("write rejected upstream WebSocket response");
                return;
            }
            let request_text = String::from_utf8_lossy(&request);
            let websocket_key = request_text
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("sec-websocket-key")
                        .then(|| value.trim().to_owned())
                })
                .expect("upstream WebSocket key");
            let accept_key = derive_accept_key(websocket_key.as_bytes());
            let response = format!(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept_key}\r\n\r\n"
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("upstream WebSocket response");
            match upstream_case {
                HudsuckerWebSocketCase::CleanClose => {
                    let (_, opcode, payload) = read_websocket_frame(&mut stream)
                        .await
                        .expect("read forwarded text frame");
                    assert_eq!(opcode, 1);
                    assert_eq!(payload, b"hi");
                    stream
                        .write_all(&[0x81, 0x02, b'o', b'k'])
                        .await
                        .expect("write upstream text frame");

                    let (_, opcode, payload) = read_websocket_frame(&mut stream)
                        .await
                        .expect("read forwarded Close frame");
                    assert_eq!(opcode, 8);
                    assert_eq!(payload, [0x03, 0xe8]);
                    stream
                        .write_all(&[0x88, 0x02, 0x03, 0xe8])
                        .await
                        .expect("write upstream Close response");
                    stream.shutdown().await.expect("upstream TLS shutdown");
                }
                HudsuckerWebSocketCase::OneSidedClose => {
                    let (_, opcode, payload) = read_websocket_frame(&mut stream)
                        .await
                        .expect("read one-sided client Close");
                    assert_eq!(opcode, 8);
                    assert_eq!(payload, [0x03, 0xe8]);
                }
                HudsuckerWebSocketCase::ClientDisconnect => {
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        read_websocket_frame(&mut stream),
                    )
                    .await
                    .expect("client disconnect was not propagated upstream")
                    {
                        Err(_) => {}
                        Ok((_, 8, payload)) => {
                            assert!(
                                payload.is_empty(),
                                "unexpected Close payload after disconnect"
                            );
                        }
                        Ok((_, opcode, _)) => {
                            panic!("partial client WebSocket frame escaped to upstream: {opcode}")
                        }
                    }
                }
                HudsuckerWebSocketCase::UpstreamDisconnect => {
                    stream
                        .write_all(&[0x81, 0x02, b'o'])
                        .await
                        .expect("write partial upstream WebSocket frame");
                    stream
                        .shutdown()
                        .await
                        .expect("close upstream after partial WebSocket frame");
                }
                HudsuckerWebSocketCase::UpstreamProtocolError => {
                    stream
                        .write_all(&[0xf0, 0x00])
                        .await
                        .expect("write invalid upstream frame");
                }
                HudsuckerWebSocketCase::ForwarderReadIoFailure => {
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        read_websocket_frame(&mut stream),
                    )
                    .await
                    .expect("forwarder read failure did not close upstream")
                    {
                        Ok((_, 8, _)) | Err(_) => {}
                        Ok((_, opcode, _)) => {
                            panic!("unexpected frame after forwarder read failure: {opcode}")
                        }
                    }
                }
                HudsuckerWebSocketCase::ForwarderWriteIoFailure
                | HudsuckerWebSocketCase::ForwarderTaskPanic => {
                    let mut forwarded_frame = [0; 16];
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        stream.read(&mut forwarded_frame),
                    )
                    .await
                    .expect("forwarder failure did not close upstream stream")
                    {
                        Ok(0) | Err(_) => {}
                        Ok(count) => panic!(
                            "frame escaped a failed WebSocket forwarder: {:?}",
                            &forwarded_frame[..count]
                        ),
                    }
                }
                HudsuckerWebSocketCase::ProxyShutdown | HudsuckerWebSocketCase::ProxyTaskAbort => {
                    let mut forwarded_frame = [0; 16];
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        stream.read(&mut forwarded_frame),
                    )
                    .await
                    .expect("proxy cancellation did not close the upstream WebSocket")
                    {
                        Ok(0) | Err(_) => {}
                        Ok(count) => panic!(
                            "unexpected WebSocket bytes during proxy cancellation: {:?}",
                            &forwarded_frame[..count]
                        ),
                    }
                }
                HudsuckerWebSocketCase::UpstreamHandshakeFailure => {
                    unreachable!("upstream handshake failure returned before relay")
                }
            }
        });

        let proxy_key_pair = KeyPair::generate().expect("proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca =
            super::rcgen::IsCa::Ca(super::rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_cert = proxy_ca_params
            .self_signed(&proxy_key_pair)
            .expect("proxy CA certificate");
        let proxy_ca_der = proxy_ca_cert.der().clone();
        let proxy_ca = RcgenAuthority::new(
            proxy_key_pair,
            proxy_ca_cert,
            100,
            aws_lc_rs::default_provider(),
        );

        let mut upstream_roots = hudsucker::rustls::RootCertStore::empty();
        upstream_roots
            .add(upstream_cert.cert.der().clone())
            .expect("upstream root");
        let upstream_client_config = hudsucker::rustls::ClientConfig::builder()
            .with_root_certificates(upstream_roots)
            .with_no_client_auth();
        let upstream_connector = hyper_rustls::HttpsConnectorBuilder::new()
            .with_tls_config(upstream_client_config.clone())
            .https_or_http()
            .enable_http1()
            .build();
        let upstream_client = Client::builder(TokioExecutor::new()).build(upstream_connector);

        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("proxy listener");
        let proxy_addr = proxy_listener.local_addr().expect("proxy address");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let mut shutdown_tx = Some(shutdown_tx);
        let capture_hook = RawCaptureHook::new(output_root.clone());
        let outcomes = Arc::new(Mutex::new(Vec::new()));
        let proxy = Proxy::builder()
            .with_listener(proxy_listener)
            .with_ca(proxy_ca)
            .with_client(upstream_client)
            .with_websocket_connector(Connector::Rustls(Arc::new(upstream_client_config)))
            .with_http_handler(PassthroughHandler)
            .with_websocket_handler(HudsuckerForwarderTestHandler {
                fault: match case {
                    HudsuckerWebSocketCase::ForwarderReadIoFailure => {
                        HudsuckerForwarderFault::ReadIo
                    }
                    HudsuckerWebSocketCase::ForwarderWriteIoFailure => {
                        HudsuckerForwarderFault::WriteIo
                    }
                    HudsuckerWebSocketCase::ForwarderTaskPanic => HudsuckerForwarderFault::Panic,
                    _ => HudsuckerForwarderFault::None,
                },
            })
            .with_client_stream_hook(OutcomeCaptureHook {
                capture: capture_hook.clone(),
                outcomes: Arc::clone(&outcomes),
            })
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .build()
            .expect("build Hudsucker proxy");
        let mut proxy_task = Some(tokio::spawn(proxy.start()));

        let mut client_socket = tokio::net::TcpStream::connect(proxy_addr)
            .await
            .expect("client connect");
        let authority = format!("localhost:{}", upstream_addr.port());
        let connect_request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
        client_socket
            .write_all(connect_request.as_bytes())
            .await
            .expect("CONNECT request");
        let mut connect_response = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let bytes_read = client_socket
                .read(&mut buffer)
                .await
                .expect("CONNECT response");
            assert!(bytes_read > 0, "proxy closed before CONNECT response");
            connect_response.extend_from_slice(&buffer[..bytes_read]);
            if connect_response
                .windows(4)
                .any(|window| window == b"\r\n\r\n")
            {
                break;
            }
        }
        assert!(connect_response.starts_with(b"HTTP/1.1 200"));

        let mut proxy_roots = hudsucker::rustls::RootCertStore::empty();
        proxy_roots.add(proxy_ca_der).expect("proxy root");
        let client_tls_config = hudsucker::rustls::ClientConfig::builder()
            .with_root_certificates(proxy_roots)
            .with_no_client_auth();
        let client_tls = TlsConnector::from(Arc::new(client_tls_config));
        let server_name =
            hudsucker::rustls::pki_types::ServerName::try_from("localhost".to_string())
                .expect("proxy server name");
        let mut client_tls_stream = client_tls
            .connect(server_name, client_socket)
            .await
            .expect("client TLS handshake");

        let retained_session = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let session = capture_hook
                    .sessions
                    .lock()
                    .expect("capture sessions")
                    .values()
                    .next()
                    .cloned();
                if let Some(session) = session {
                    break session;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("capture session was not started before Upgrade request");
        let request_handshake = b"GET /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        client_tls_stream
            .write_all(request_handshake)
            .await
            .expect("downstream WebSocket handshake");
        let response_handshake = read_http_message(&mut client_tls_stream).await;
        if matches!(case, HudsuckerWebSocketCase::UpstreamHandshakeFailure) {
            assert!(
                response_handshake.starts_with(b"HTTP/1.1 502"),
                "upstream rejection must not produce a downstream 101"
            );
            drop(client_tls_stream);
            tokio::time::timeout(std::time::Duration::from_secs(3), upstream_task)
                .await
                .expect("upstream rejection fixture timeout")
                .expect("upstream rejection fixture panicked");
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                while !capture_hook
                    .sessions
                    .lock()
                    .expect("capture sessions")
                    .is_empty()
                {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("failed Upgrade session was not finalized");
            assert!(
                !output_root.exists()
                    || fs::read_dir(&output_root)
                        .expect("capture output root")
                        .next()
                        .is_none(),
                "upstream WebSocket rejection must not persist a 101 capture"
            );
            assert!(outcomes.lock().expect("WebSocket outcomes").is_empty());
            shutdown_tx
                .take()
                .expect("proxy shutdown sender")
                .send(())
                .expect("proxy shutdown signal");
            proxy_task
                .take()
                .expect("proxy task")
                .await
                .expect("proxy task join")
                .expect("proxy shutdown");
            let _ = fs::remove_dir_all(output_root);
            return;
        }
        let header_end = response_handshake
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|offset| offset + 4)
            .expect("client-facing 101 header boundary");
        let response_handshake = response_handshake[..header_end].to_vec();
        assert!(response_handshake.starts_with(b"HTTP/1.1 101"));
        assert_websocket_101_semantics(&response_handshake);
        let capture_dir = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if let Ok(entries) = fs::read_dir(&output_root) {
                    if let Some(path) = entries
                        .flatten()
                        .filter_map(|entry| {
                            let is_staging = entry.file_name().to_string_lossy().starts_with('.');
                            (!is_staging).then_some(entry.path())
                        })
                        .find(|path| {
                            path.join("manifest.json").exists()
                                && path.join("request-wire.bin").exists()
                                && path.join("response-wire.bin").exists()
                        })
                    {
                        break path;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Hudsucker Upgrade artifact was not finalized before frame relay");
        assert!(
            capture_hook
                .sessions
                .lock()
                .expect("capture sessions")
                .is_empty(),
            "completed Upgrade must release its capture session before relay ends"
        );
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let released = match retained_session.try_lock() {
                    Ok(session) => {
                        let snapshot = session.recorder.snapshot().expect("finalized snapshot");
                        snapshot.request_bytes().is_empty() && snapshot.response_bytes().is_empty()
                    }
                    Err(std::sync::TryLockError::WouldBlock) => false,
                    Err(std::sync::TryLockError::Poisoned(error)) => {
                        panic!("finalized session lock poisoned: {error}")
                    }
                };
                if released {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("finalized Upgrade capture buffers were not released");

        let mut client_tls_stream = Some(client_tls_stream);
        match case {
            HudsuckerWebSocketCase::CleanClose => {
                let stream = client_tls_stream.as_mut().expect("client TLS stream");
                let text_frame = vec![0x81, 0x82, 0x11, 0x22, 0x33, 0x44, b'h' ^ 0x11, b'i' ^ 0x22];
                stream
                    .write_all(&text_frame)
                    .await
                    .expect("downstream text frame");
                let (response_text_frame, opcode, payload) = read_websocket_frame(stream)
                    .await
                    .expect("downstream text response");
                assert_eq!(opcode, 1);
                assert_eq!(payload, b"ok");
                assert_eq!(response_text_frame, [0x81, 0x02, b'o', b'k']);

                let close_frame = vec![0x88, 0x82, 0x55, 0x66, 0x77, 0x88, 0x56, 0x8e];
                stream
                    .write_all(&close_frame)
                    .await
                    .expect("downstream Close frame");
                let (response_close_frame, opcode, payload) = read_websocket_frame(stream)
                    .await
                    .expect("downstream Close response");
                assert_eq!(opcode, 8);
                assert_eq!(payload, [0x03, 0xe8]);
                assert_eq!(response_close_frame, [0x88, 0x02, 0x03, 0xe8]);
                stream.shutdown().await.expect("downstream TLS shutdown");
            }
            HudsuckerWebSocketCase::OneSidedClose => {
                let stream = client_tls_stream.as_mut().expect("client TLS stream");
                stream
                    .write_all(&[0x88, 0x82, 0x55, 0x66, 0x77, 0x88, 0x56, 0x8e])
                    .await
                    .expect("downstream one-sided Close");
                let result = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    read_websocket_frame(stream),
                )
                .await
                .expect("one-sided Close did not terminate");
                let _proxy_frame_or_disconnect = result;
            }
            HudsuckerWebSocketCase::ClientDisconnect => {
                client_tls_stream
                    .as_mut()
                    .expect("client TLS stream")
                    .write_all(&[0x81, 0x82, 0x11, 0x22])
                    .await
                    .expect("write partial downstream WebSocket frame");
                drop(client_tls_stream.take());
            }
            HudsuckerWebSocketCase::UpstreamDisconnect => {
                let stream = client_tls_stream.as_mut().expect("client TLS stream");
                match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    read_websocket_frame(stream),
                )
                .await
                .expect("upstream disconnect was not propagated downstream")
                {
                    Ok((_, 8, _)) | Err(_) => {}
                    Ok((_, opcode, _)) => {
                        panic!("partial upstream WebSocket frame reached client: {opcode}")
                    }
                }
            }
            HudsuckerWebSocketCase::UpstreamProtocolError => {
                let stream = client_tls_stream.as_mut().expect("client TLS stream");
                match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    read_websocket_frame(stream),
                )
                .await
                .expect("upstream protocol failure was not propagated downstream")
                {
                    Ok((_, 8, _)) | Err(_) => {}
                    Ok((_, opcode, _)) => {
                        panic!("invalid upstream WebSocket frame reached client: {opcode}")
                    }
                }
            }
            HudsuckerWebSocketCase::ForwarderReadIoFailure => {}
            HudsuckerWebSocketCase::ForwarderWriteIoFailure
            | HudsuckerWebSocketCase::ForwarderTaskPanic => {
                client_tls_stream
                    .as_mut()
                    .expect("client TLS stream")
                    .write_all(&[0x81, 0x82, 0x11, 0x22, 0x33, 0x44, b'h' ^ 0x11, b'i' ^ 0x22])
                    .await
                    .expect("write frame to injected forwarder failure");
            }
            HudsuckerWebSocketCase::ProxyShutdown => {
                shutdown_tx
                    .take()
                    .expect("proxy shutdown sender")
                    .send(())
                    .expect("proxy shutdown signal");
                tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    proxy_task.take().expect("proxy task"),
                )
                .await
                .expect("proxy shutdown did not terminate")
                .expect("proxy task join")
                .expect("proxy shutdown");
                assert_client_tls_closed(client_tls_stream.as_mut().expect("client TLS stream"))
                    .await;
            }
            HudsuckerWebSocketCase::ProxyTaskAbort => {
                drop(shutdown_tx.take());
                let proxy_task = proxy_task.take().expect("proxy task");
                proxy_task.abort();
                let error = tokio::time::timeout(std::time::Duration::from_secs(3), proxy_task)
                    .await
                    .expect("proxy task abort did not terminate")
                    .expect_err("aborted proxy task unexpectedly completed");
                assert!(error.is_cancelled(), "proxy task was not cancelled");
                assert_client_tls_closed(client_tls_stream.as_mut().expect("client TLS stream"))
                    .await;
            }
            HudsuckerWebSocketCase::UpstreamHandshakeFailure => {
                unreachable!("upstream handshake failure returned before relay")
            }
        }
        drop(client_tls_stream);
        tokio::time::timeout(std::time::Duration::from_secs(3), upstream_task)
            .await
            .expect("upstream WebSocket fixture timeout")
            .expect("upstream WebSocket fixture panicked");
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while outcomes.lock().expect("WebSocket outcomes").is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Hudsucker WebSocket relay outcome was not reported");
        assert_eq!(
            outcomes.lock().expect("WebSocket outcomes").as_slice(),
            &[matches!(case, HudsuckerWebSocketCase::CleanClose)]
        );
        RawCaptureHook::wait_for_persistence_tasks(Arc::clone(&capture_hook.persistence_tasks))
            .await;
        assert!(
            capture_hook
                .sessions
                .lock()
                .expect("capture sessions")
                .is_empty(),
            "terminated WebSocket must not retain a capture session"
        );
        assert!(
            capture_hook
                .persistence_tasks
                .lock()
                .expect("capture persistence tasks")
                .is_empty(),
            "capture persistence tasks must be joined after proxy termination"
        );
        let retained_snapshot = retained_session
            .lock()
            .expect("retained finalized session")
            .recorder
            .snapshot()
            .expect("retained capture snapshot");
        assert!(retained_snapshot.request_bytes().is_empty());
        assert!(retained_snapshot.response_bytes().is_empty());

        let expected_request_wire = request_handshake.to_vec();
        let expected_response_wire = response_handshake.clone();
        crate::capture::verify_capture(&capture_dir).expect("verify Hudsucker WebSocket capture");
        assert_eq!(
            fs::read(capture_dir.join("request-wire.bin")).expect("request wire"),
            expected_request_wire
        );
        assert_eq!(
            fs::read(capture_dir.join("response-wire.bin")).expect("response wire"),
            expected_response_wire
        );
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(capture_dir.join("manifest.json")).expect("capture manifest"),
        )
        .expect("parse capture manifest");
        let messages = manifest["messages"].as_array().expect("message list");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["direction"].as_str(), Some("request"));
        assert_eq!(
            messages[0]["stream_end"].as_u64(),
            Some(request_handshake.len() as u64)
        );
        assert_eq!(messages[1]["direction"].as_str(), Some("response"));
        assert_eq!(
            messages[1]["stream_end"].as_u64(),
            Some(response_handshake.len() as u64)
        );

        if matches!(case, HudsuckerWebSocketCase::ForwarderTaskPanic) {
            assert!(
                !proxy_task
                    .as_ref()
                    .expect("proxy listener task")
                    .is_finished(),
                "WebSocket child-task panic must not stop the proxy listener"
            );
            let mut followup = tokio::net::TcpStream::connect(proxy_addr)
                .await
                .expect("connect after WebSocket task panic");
            followup
                .write_all(b"NOT HTTP\r\n\r\n")
                .await
                .expect("write malformed follow-up request");
            let response = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                read_http_message(&mut followup),
            )
            .await
            .expect("proxy listener did not serve after WebSocket task panic");
            assert!(
                response.starts_with(b"HTTP/1.1 400"),
                "unexpected post-panic listener response: {:?}",
                String::from_utf8_lossy(&response)
            );
            assert!(
                !proxy_task
                    .as_ref()
                    .expect("proxy listener task")
                    .is_finished(),
                "proxy listener stopped after follow-up parse failure"
            );
        }

        if let Some(shutdown_tx) = shutdown_tx.take() {
            shutdown_tx.send(()).expect("proxy shutdown signal");
        }
        if let Some(proxy_task) = proxy_task.take() {
            proxy_task
                .await
                .expect("proxy task join")
                .expect("proxy shutdown");
        }
        let _ = fs::remove_dir_all(output_root);
    }

    #[derive(Clone)]
    struct PassthroughHandler;

    impl HttpHandler for PassthroughHandler {}

    fn digest_hex(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};

        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    #[test]
    fn parse_content_encoding_list() {
        let parsed = parse_content_encodings("gzip, br");
        assert_eq!(parsed, vec!["gzip".to_string(), "br".to_string()]);
    }

    #[test]
    fn decode_single_brotli_payload() {
        let json = br#"{"ok":true,"kind":"single-br"}"#;
        let compressed = br_compress(json);
        let encodings = vec!["br".to_string()];

        let decoded = decode_response_body(compressed, &encodings, false);
        assert_eq!(decoded, json);
    }

    #[test]
    fn decode_stacked_gzip_then_brotli_payload() {
        // Encoding order in header is the order encoders were applied.
        // For gzip then br, decoder must run in reverse order: br -> gzip.
        let json = br#"{"ok":true,"kind":"gzip-then-br"}"#;
        let gz = gzip_compress(json);
        let stacked = br_compress(&gz);
        let encodings = vec!["gzip".to_string(), "br".to_string()];

        let decoded = decode_response_body(stacked, &encodings, false);
        assert_eq!(decoded, json);
    }

    #[test]
    fn decode_gzip_by_magic_sniff_when_header_missing() {
        let json = br#"{"ok":true,"kind":"sniff-gzip"}"#;
        let gz = gzip_compress(json);

        let decoded = decode_response_body(gz, &[], true);
        assert_eq!(decoded, json);
    }

    #[test]
    fn create_ca_outputs_parseable_pem_and_crt() {
        let ca_dir = unique_temp_dir("create_ca_outputs_parseable_pem_and_crt");
        let ca_dir_str = ca_dir.to_string_lossy().to_string();

        create_ca(ca_dir_str);

        let pem_path = ca_dir.join(CA_CERT_NAME_PEM);
        let crt_path = ca_dir.join(CA_CERT_NAME_CRT);
        let der_path = ca_dir.join(CA_CERT_NAME_DER);
        let key_path = ca_dir.join(CA_KEY_NAME_PEM);

        assert!(pem_path.exists(), "expected PEM file to exist");
        assert!(crt_path.exists(), "expected CRT file to exist");
        assert!(der_path.exists(), "expected DER file to exist");
        assert!(key_path.exists(), "expected key file to exist");

        let pem = fs::read_to_string(&pem_path).expect("failed to read PEM file");
        let crt = fs::read_to_string(&crt_path).expect("failed to read CRT file");
        let der = fs::read(&der_path).expect("failed to read DER file");
        let key_pem = fs::read_to_string(&key_path).expect("failed to read key file");

        assert!(pem.contains("-----BEGIN CERTIFICATE-----"));
        assert!(pem.contains("-----END CERTIFICATE-----"));
        assert!(crt.contains("-----BEGIN CERTIFICATE-----"));
        assert!(crt.contains("-----END CERTIFICATE-----"));
        assert!(!der.is_empty(), "DER file should not be empty");
        assert_eq!(der[0], 0x30, "DER should start with ASN.1 SEQUENCE tag");

        let key_pair = KeyPair::from_pem(&key_pem).expect("generated key should be parseable");
        let _cert_from_pem = CertificateParams::from_ca_cert_pem(&pem)
            .expect("generated PEM should be parseable")
            .self_signed(&key_pair)
            .expect("generated PEM should be self-signable");
        let _cert_from_crt = CertificateParams::from_ca_cert_pem(&crt)
            .expect("generated CRT should be parseable")
            .self_signed(&key_pair)
            .expect("generated CRT should be self-signable");

        let _ = fs::remove_file(pem_path);
        let _ = fs::remove_file(crt_path);
        let _ = fs::remove_file(der_path);
        let _ = fs::remove_file(key_path);
        let _ = fs::remove_dir_all(ca_dir);
    }

    #[test]
    fn check_ca_returns_false_when_der_is_missing() {
        let ca_dir = unique_temp_dir("check_ca_returns_false_when_der_is_missing");
        let ca_dir_str = ca_dir.to_string_lossy().to_string();

        create_ca(ca_dir_str.clone());

        let der_path = ca_dir.join(CA_CERT_NAME_DER);
        fs::remove_file(&der_path).expect("failed to remove der before check");

        assert!(
            !check_ca(ca_dir_str),
            "check_ca should fail when der is missing"
        );
        assert!(!der_path.exists(), "der should remain missing");

        let _ = fs::remove_file(ca_dir.join(CA_CERT_NAME_PEM));
        let _ = fs::remove_file(ca_dir.join(CA_CERT_NAME_CRT));
        let _ = fs::remove_file(ca_dir.join(CA_CERT_NAME_DER));
        let _ = fs::remove_file(ca_dir.join(CA_KEY_NAME_PEM));
        let _ = fs::remove_dir_all(ca_dir);
    }
}
