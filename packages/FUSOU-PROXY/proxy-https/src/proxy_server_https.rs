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

use crate::capture_io::CaptureRecorder;
use crate::{bidirectional_channel, capture};

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
    recorders: Arc<Mutex<HashMap<u64, CaptureRecorder>>>,
}

impl RawCaptureHook {
    fn new(output_root: PathBuf) -> Self {
        Self {
            output_root,
            recorders: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl ClientStreamHook for RawCaptureHook {
    fn wrap(&self, context: &HttpContext, stream: ClientStream) -> ClientStream {
        let recorder = CaptureRecorder::new();
        match self.recorders.lock() {
            Ok(mut recorders) => {
                recorders.insert(context.connection_id, recorder.clone());
            }
            Err(_) => {
                tracing::error!(
                    connection_id = context.connection_id,
                    "raw capture recorder map poisoned"
                );
            }
        }
        Box::new(crate::capture_io::CaptureIo::new(stream, recorder))
    }

    fn finish(&self, context: HttpContext) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        let recorder = self
            .recorders
            .lock()
            .ok()
            .and_then(|mut recorders| recorders.remove(&context.connection_id));
        let output_root = self.output_root.clone();
        Box::pin(async move {
            let Some(recorder) = recorder else {
                return;
            };
            match tokio::task::spawn_blocking(move || {
                write_raw_capture(output_root, context.connection_id, recorder)
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
        })
    }
}

fn write_raw_capture(
    output_root: PathBuf,
    connection_id: u64,
    recorder: CaptureRecorder,
) -> Result<Option<PathBuf>, String> {
    let snapshot = recorder.snapshot().map_err(|error| error.to_string())?;
    if snapshot.request_len() == 0
        || snapshot.response_len() == 0
        || !is_require_info_request(snapshot.request_bytes())
    {
        return Ok(None);
    }

    recorder
        .exact_wire_capture()
        .map_err(|error| error.to_string())?
        .write_private_raw(
            output_root,
            format!("{}-connection-{connection_id}", capture::next_capture_id()),
        )
        .map(Some)
        .map_err(|error| error.to_string())
}

fn is_require_info_request(bytes: &[u8]) -> bool {
    let Some(line_end) = bytes.windows(2).position(|window| window == b"\r\n") else {
        return false;
    };
    let mut fields = bytes[..line_end].split(|byte| *byte == b' ');
    let _method = fields.next();
    let Some(target) = fields.next() else {
        return false;
    };
    let Ok(target) = std::str::from_utf8(target) else {
        return false;
    };
    target
        .parse::<Uri>()
        .map(|uri| uri.path().ends_with("/api_get_member/require_info"))
        .unwrap_or(false)
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
}

impl HttpHandler for LogHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
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
    _auth_manager: Arc<AuthManager<FileStorage>>,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    setup_default_crypto_provider();

    let configs = configs::get_user_configs_for_proxy();
    let _app_configs = configs::get_user_configs_for_app();
    let allow_save_api_requests = configs.get_allow_save_api_requests();
    let allow_save_api_responses = configs.get_allow_save_api_responses();
    let allow_save_resources = configs.get_allow_save_resources();
    let allow_save_main_js_local = configs.get_allow_save_main_js_local();
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
        });

    match capture_output_root {
        Some(output_root) => {
            let server_proxy = proxy_builder
                .with_client_stream_hook(RawCaptureHook::new(output_root))
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
        HttpContext, RawCaptureHook, CA_CERT_NAME_CRT, CA_CERT_NAME_DER, CA_CERT_NAME_PEM,
        CA_KEY_NAME_PEM,
    };
    use hudsucker::HttpHandler;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fusou_proxy_https_{name}_{stamp}"))
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

        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fork_proxy_captures_tls_plaintext_after_connect_without_retry() {
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
        let upstream_task = tokio::spawn(async move {
            let (socket, _) = upstream_listener.accept().await.expect("upstream accept");
            let mut stream = upstream_acceptor
                .accept(socket)
                .await
                .expect("upstream tls accept");
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let bytes_read = stream.read(&mut buffer).await.expect("upstream read");
                if bytes_read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..bytes_read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            assert!(request.starts_with(b"GET /kcsapi/api_get_member/require_info"));
            upstream_requests_task.fetch_add(1, Ordering::SeqCst);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await
                .expect("upstream response");
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
        let proxy_task = tokio::spawn(proxy.start());

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
        let client_request =
            b"GET /kcsapi/api_get_member/require_info?x=1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
        client_tls_stream
            .write_all(client_request)
            .await
            .expect("client request");
        let mut client_response = Vec::new();
        loop {
            let bytes_read = client_tls_stream
                .read(&mut buffer)
                .await
                .expect("client response");
            if bytes_read == 0 {
                break;
            }
            client_response.extend_from_slice(&buffer[..bytes_read]);
            if client_response
                .windows(4)
                .any(|window| window == b"\r\n\r\n")
                && client_response.ends_with(b"ok")
            {
                break;
            }
        }
        assert!(client_response.starts_with(b"HTTP/1.1 200"));
        drop(client_tls_stream);

        upstream_task.await.expect("upstream task");
        assert_eq!(upstream_requests.load(Ordering::SeqCst), 1);

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
            client_request
        );
        assert_eq!(
            std::fs::read(capture_dir.join("response-wire.bin")).expect("response wire"),
            client_response
        );

        shutdown_tx.send(()).expect("proxy shutdown signal");
        proxy_task
            .await
            .expect("proxy task join")
            .expect("proxy shutdown");
        let _ = std::fs::remove_dir_all(output_root);
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
