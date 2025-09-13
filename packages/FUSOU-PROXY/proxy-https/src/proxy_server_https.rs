use http::{method, request, response, HeaderName, Uri};
use http_body_util::BodyExt;
use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{CertificateParams, KeyPair},
    rustls::crypto::aws_lc_rs,
    *,
};
use std::{
    fs,
    io::Read,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::Path,
    sync::OnceLock,
};

use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;

#[cfg(target_os = "linux")]
use std::os::linux::fs::MetadataExt;
#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;

use crate::bidirectional_channel;

use configs;

use tracing_unwrap::ResultExt;

fn log_response(
    parts: response::Parts,
    body: Vec<u8>,
    uri: Uri,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    save_path: String,
    file_prefix: String,
    allow_save_api_responses: bool,
    allow_save_resources: bool,
) {
    let mut content_type: String = String::new();
    let mut _content_length: i64 = -1;

    const HEADER_NAME_CONTENT_TYPE: HeaderName = HeaderName::from_static("content-type");
    const HEADER_NAME_CONTENT_LENGTH: HeaderName = HeaderName::from_static("content-length");
    {
        for (key, value) in parts.headers {
            match key {
                Some(HEADER_NAME_CONTENT_TYPE) => {
                    content_type = value.to_str().unwrap().to_string();
                }
                Some(HEADER_NAME_CONTENT_LENGTH) => {
                    _content_length = value.to_str().unwrap().parse::<i64>().unwrap();
                }
                _ => {}
            };
        }
    }

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

    let save: bool = match content_type.as_str() {
        "text/plain" => allow_save_api_responses,
        "application/json" => allow_save_resources,
        "image/png" => allow_save_resources,
        "video/mp4" => allow_save_resources,
        "audio/mpeg" => allow_save_resources,
        "text/html" => false,
        "text/css" => false,
        "text/javascript" => false,
        _ => allow_save_resources,
    };

    let utc: chrono::NaiveDateTime = Utc::now().naive_utc();
    let jst: chrono::DateTime<chrono_tz::Tz> = Tokyo.from_utc_datetime(&utc);

    let re_uri = regex::Regex::new(r"https+://.*\.kancolle-server\.com").unwrap();
    let uri_path = re_uri.replace(uri.path(), "").to_string();
    let status = parts.status.to_string();

    tracing::info!(status = %status, uri = %uri_path, content_type = %content_type);

    if save || !pass {
        if body.is_empty() {
            return;
        }

        tokio::spawn(async move {
            let mut buffer: Vec<u8> = Vec::new();
            if !pass && content_type.eq("text/plain") {
                // this code is for the response not decoded in hudsucker!!
                match flate2::read::MultiGzDecoder::new(body.as_slice()).read_to_end(&mut buffer) {
                    Ok(_) => {}
                    Err(_) => {
                        buffer = body.clone();
                    }
                }

                if let Ok(buffer_string) = String::from_utf8(buffer.clone()) {
                    let mes = bidirectional_channel::StatusInfo::RESPONSE {
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

                if content_type.eq("text/plain") && uri_path.as_str().starts_with("/kcsapi") {
                    let parent = Path::new("kcsapi");
                    let path_parent = path_log.join(parent);
                    if !path_parent.exists() {
                        fs::create_dir_all(path_parent).expect_or_log("Failed to create directory");
                    }

                    // let time_stamped = format!(
                    //     "kcsapi/{}_{}S{}",
                    //     file_prefix,
                    //     jst.timestamp(),
                    //     uri_path.as_str().replace("/kcsapi", "").replace("/", "@")
                    // );

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

                    if content_type.eq("application/json") {
                        // this code is for the response not decoded in hudsucker!!
                        match flate2::read::MultiGzDecoder::new(body.as_slice())
                            .read_to_end(&mut buffer)
                        {
                            Ok(_) => {}
                            Err(_) => {
                                buffer = body.clone();
                            }
                        }
                        fs::write(file_log_path, buffer).expect_or_log("Failed to write file");
                    } else {
                        fs::write(file_log_path, body.clone())
                            .expect_or_log("Failed to write file");
                    }

                    // if !file_log_path.exists() {
                    //     fs::write(file_log_path, body.clone().clone())
                    //         .expect_or_log("Failed to write file");
                    // } else {
                    //     let file_log_metadata =
                    //         fs::metadata(file_log_path.clone()).expect_or_log("Failed to get metadata");
                    //     #[cfg(target_os = "linux")]
                    //     if file_log_metadata.len() == 0 {
                    //         fs::write(file_log_path, body.clone().clone())
                    //             .expect_or_log("Failed to write file");
                    //     }
                    //     #[cfg(target_os = "windows")]
                    //     if file_log_metadata.file_size() == 0 {
                    //         fs::write(file_log_path, body.clone().clone())
                    //             .expect_or_log("Failed to write file");
                    //     }
                    // }
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
                    content_type = value.to_str().unwrap().to_string();
                }
                Some(HEADER_NAME_CONTENT_LENGTH) => {
                    _content_length = value.to_str().unwrap().parse::<i64>().unwrap();
                }
                _ => {}
            };
        }
    }

    let pass: bool = match content_type.as_str() {
        "application/x-www-form-urlencoded" => false,
        _ => true,
    };

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
struct LogHandler {
    request_uri: Uri,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    save_path: String,
    file_prefix: String,
    allow_save_api_requests: bool,
    allow_save_api_responses: bool,
    allow_save_resources: bool,
}

impl HttpHandler for LogHandler {
    // async fn handle_request(
    //     &mut self,
    //     _ctx: &HttpContext,
    //     req: Request<Body>,
    // ) -> RequestOrResponse {
    //     self.request_uri = req.uri().clone();
    //     req.into()
    // }

    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        self.request_uri = req.uri().clone();

        let (part, body) = req.into_parts();

        let collected = body.collect().await.unwrap();
        let body = collected.to_bytes().clone();
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

        let collected = body.collect().await.unwrap();
        let body = collected.to_bytes().clone();
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
        );

        let reconstructed_body = hudsucker::Body::from(full_body);
        let reconstructed_response = Response::from_parts(part, reconstructed_body);

        return reconstructed_response;
    }
}

fn create_ca(ca_dir: &Path) {
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
        rcgen::DnValue::PrintableString("JP".try_into().unwrap()),
    );
    ca_param
        .distinguished_name
        .push(rcgen::DnType::OrganizationName, "FUSOU");
    let ca_cert = ca_param.self_signed(&ca_key_pair).unwrap();

    let entity_key_pair = rcgen::KeyPair::generate().unwrap();

    let mut entity_param = rcgen::CertificateParams::default();
    entity_param.is_ca = rcgen::IsCa::NoCa;
    entity_param.use_authority_key_identifier_extension = true;
    entity_param
        .key_usages
        .push(rcgen::KeyUsagePurpose::DigitalSignature);
    entity_param
        .extended_key_usages
        .push(rcgen::ExtendedKeyUsagePurpose::ServerAuth);
    entity_param
        .distinguished_name
        .push(rcgen::DnType::CommonName, "localhost");
    entity_param.subject_alt_names.extend(vec![
        rcgen::SanType::IpAddress(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
        rcgen::SanType::DnsName("localhost".try_into().unwrap()),
    ]);
    let entity_cert = entity_param
        .signed_by(&entity_key_pair, &ca_cert, &ca_key_pair)
        .unwrap();

    // let ca_dir = Path::new("./ca");
    let _ = fs::create_dir_all(ca_dir);

    let _ = fs::write(ca_dir.join("ca_cert.pem"), ca_cert.pem());
    let _ = fs::write(ca_dir.join("ca_key.pem"), ca_key_pair.serialize_pem());

    let _ = fs::write(ca_dir.join("entity_cert.pem"), entity_cert.pem());
    let _ = fs::write(
        ca_dir.join("entity_key.pem"),
        entity_key_pair.serialize_pem(),
    );
}

pub fn check_ca(ca_save_path: String) {
    // let ca_dir = Path::new("./ca");
    let ca_dir = Path::new(ca_save_path.as_str());
    let entity_cert = ca_dir.join("entity_cert.pem");
    let entity_key = ca_dir.join("entity_key.pem");
    let ca_cert = ca_dir.join("ca_cert.pem");
    let ca_key = ca_dir.join("ca_key.pem");

    if !entity_cert.exists() || !entity_key.exists() || !ca_cert.exists() || !ca_key.exists() {
        create_ca(ca_dir);
    }
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
        rustls::crypto::ring::default_provider()
            .install_default()
            .expect_or_log("Failed to install rustls crypto provider")
    });
}

pub fn serve_proxy(
    port: u16,
    mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>,
    log_save_path: String,
    ca_save_path: String,
    file_prefix: String,
) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    setup_default_crypto_provider();

    let configs = configs::get_user_configs_for_proxy();
    let allow_save_api_requests = configs.get_allow_save_api_requests();
    let allow_save_api_responses = configs.get_allow_save_api_responses();
    let allow_save_resources = configs.get_allow_save_resources();

    let ca_dir = Path::new(ca_save_path.as_str());
    let use_generated_certs = configs.certificates.get_use_generated_certs();

    let custom_cert_file_path = configs.certificates.get_cert_file();
    let entity_cert = if use_generated_certs {
        ca_dir.join("entity_cert.pem")
    } else if let Some(custom_cert_file_path) = custom_cert_file_path {
        custom_cert_file_path
    } else {
        ca_dir.join("entity_cert.pem")
    };

    let custom_key_file_path = configs.certificates.get_key_file();
    let entity_key = if use_generated_certs {
        ca_dir.join("entity_key.pem")
    } else if let Some(custom_key_file_path) = custom_key_file_path {
        custom_key_file_path
    } else {
        ca_dir.join("entity_key.pem")
    };

    let key_pair = fs::read_to_string(entity_key.clone()).expect_or_log("Failed to open file");

    let ca_cert = fs::read_to_string(entity_cert.clone()).expect_or_log("Failed to open file");

    let key_pair = KeyPair::from_pem(&key_pair).expect_or_log("Failed to parse private key");
    let ca_cert = CertificateParams::from_ca_cert_pem(&ca_cert)
        .expect_or_log("Failed to parse CA certificate")
        .self_signed(&key_pair)
        .expect_or_log("Failed to sign CA certificate");

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
    let server_proxy = Proxy::builder()
        .with_addr(addr)
        .with_ca(ca)
        .with_client(client)
        // .with_rustls_client(aws_lc_rs::default_provider())
        .with_http_handler(LogHandler {
            tx_proxy_log: tx_proxy_log.clone(),
            request_uri: Uri::default(),
            save_path,
            file_prefix: file_prefix.clone(),
            allow_save_api_requests,
            allow_save_api_responses,
            allow_save_resources,
        })
        .with_graceful_shutdown(async move {
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
        })
        .build()
        .expect_or_log("Failed to create proxy");

    tracing::info!("Proxy server addr: {}", addr);

    tokio::task::spawn(server_proxy.start());

    Ok(addr)
}
