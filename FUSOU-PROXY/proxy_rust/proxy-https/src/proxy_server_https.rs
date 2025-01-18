use http_body_util::BodyExt;
use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{CertificateParams, KeyPair},
    rustls::crypto::aws_lc_rs,
    *,
};
use std::{
    fs, io::Read, 
    net::{IpAddr, Ipv4Addr, SocketAddr}, 
    path::Path, 
    process::Command, 
    time::Duration
};
use http::{
    response::Parts,
    HeaderName,
    Uri,
};

use chrono_tz::Asia::Tokyo;
use chrono::{Utc, TimeZone};

#[cfg(target_os = "windows")]
use std::os::windows::fs::MetadataExt;
#[cfg(target_os = "linux")]
use std::os::linux::fs::MetadataExt;

use crate::bidirectional_channel;

fn log_response(parts: Parts, body: Vec<u8>, uri: Uri, tx_proxy_log:bidirectional_channel::Master<bidirectional_channel::StatusInfo>, save_path: String) {

    let mut content_type : String = String::new();
    let mut _content_length : i64 = -1;

    const HEADER_NAME_CONTENT_TYPE: HeaderName = HeaderName::from_static("content-type");
    const HEADER_NAME_CONTENT_LENGTH: HeaderName = HeaderName::from_static("content-length");
    {
        for (key, value) in parts.headers {
            match key {
                Some(HEADER_NAME_CONTENT_TYPE) => {
                    content_type = value.to_str().unwrap().to_string();
                },
                Some(HEADER_NAME_CONTENT_LENGTH) => {
                    _content_length = value.to_str().unwrap().parse::<i64>().unwrap();
                },
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
        _ => true
    };

    let save: bool = match content_type.as_str() {
        "text/plain" => true,
        "application/json" => true,
        "image/png" => true,
        "video/mp4" => true,
        "audio/mpeg" => true,
        "text/html" => false,
        "text/css" => false,
        "text/javascript" => false,
        _ => true
    };

    let utc = Utc::now().naive_utc();
    let jst = Tokyo.from_utc_datetime(&utc);
    
    println!("{} status: {:?}, path:{:?}, content-type:{:?}", format!("{}", jst.format("%Y-%m-%d %H:%M:%S.%3f %Z")), parts.status, "path", content_type);
    
    if save || !pass {

        if body.len() == 0 {
            return;
        }
        
        let body_cloned = body.clone();
        tokio::spawn(async move {
            if !pass {
                if content_type.eq("text/plain") {
                    if let Ok(buffer_string) = String::from_utf8(body.clone()) {
                        let mes = bidirectional_channel::StatusInfo::CONTENT {
                            path: uri.path().to_string(),
                            content_type: content_type.to_string(), 
                            content: buffer_string,
                        };
                        let _ = tx_proxy_log.send(mes).await;
                    } else {
                        println!("Failed to convert buffer to string");
                    }
                }
            }
            if save {
                let path_log = Path::new(save_path.as_str());

                if content_type.eq("text/plain") && uri.path().starts_with("/kcsapi") {
                    let parent = Path::new("kcsapi");
                    let path_parent = path_log.join(parent);
                    if !path_parent.exists() {
                        fs::create_dir_all(path_parent).expect("Failed to create directory");
                    }
                } else {
                    let path_removed = uri.path().replacen("/", "", 1);
                    if let Some(parent) = Path::new(path_removed.as_str()).parent() {
                        let path_parent = path_log.join(parent);
                        if !path_parent.exists() {
                            fs::create_dir_all(path_parent).expect("Failed to create directory");
                        }
                    }
                    
                    let file_log_path = path_log.join(Path::new(path_removed.as_str()));

                    if !file_log_path.exists() {
                        fs::write(file_log_path, body_cloned.clone()).expect("Failed to write file");
                    } else {
                        let file_log_metadata = fs::metadata(file_log_path.clone()).expect("Failed to get metadata");
                        #[cfg(target_os = "linux")]
                        if file_log_metadata.len() == 0 {
                            fs::write(file_log_path, body_cloned.clone()).expect("Failed to write file");
                        }
                        #[cfg(target_os = "windows")]
                        if file_log_metadata.file_size() == 0 {
                            fs::write(file_log_path, body_cloned.clone()).expect("Failed to write file");
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
}

impl HttpHandler for LogHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        println!("{:?}", req.uri());
        self.request_uri = req.uri().clone();
        req.into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {

        let (part , body) = res.into_parts();
        
        let collected = body.collect().await.unwrap();
        let body = collected.to_bytes().clone();
        let full_body = http_body_util::Full::from(body.clone());

        let body_vec = body.to_vec();
        log_response(part.clone(), body_vec, self.request_uri.clone(), self.tx_proxy_log.clone(), self.save_path.clone());

        let reconstructed_body = hudsucker::Body::from(full_body);
        let reconstructed_response = Response::from_parts(part, reconstructed_body);

        return reconstructed_response;
    }
}

fn create_ca() {
    
    let ca_key_pair = rcgen::KeyPair::generate().unwrap();

    let mut ca_param = rcgen::CertificateParams::default();
    ca_param.distinguished_name = rcgen::DistinguishedName::new();
    ca_param.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    ca_param.key_usages.push(rcgen::KeyUsagePurpose::DigitalSignature);
    ca_param.key_usages.push(rcgen::KeyUsagePurpose::KeyCertSign);
    ca_param.key_usages.push(rcgen::KeyUsagePurpose::CrlSign);
    ca_param.distinguished_name.push(rcgen::DnType::CountryName, rcgen::DnValue::PrintableString("JP".try_into().unwrap()));
    ca_param.distinguished_name.push(rcgen::DnType::OrganizationName, "FUSOU");
    let ca_cert = ca_param.self_signed(&ca_key_pair).unwrap();

    let entity_key_pair = rcgen::KeyPair::generate().unwrap();

    let mut entity_param = rcgen::CertificateParams::default();
    entity_param.is_ca = rcgen::IsCa::NoCa;
    entity_param.use_authority_key_identifier_extension = true;
    entity_param.key_usages.push(rcgen::KeyUsagePurpose::DigitalSignature);
    entity_param.distinguished_name.push(rcgen::DnType::CommonName, "localhost");
    entity_param.subject_alt_names.extend(vec![
        rcgen::SanType::IpAddress(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))),
        rcgen::SanType::DnsName("localhost".try_into().unwrap()),
        ]);
    let entity_cert = entity_param.signed_by(&entity_key_pair, &ca_cert, &ca_key_pair).unwrap();

    let ca_dir = Path::new("./ca");
    let _ = fs::create_dir_all(ca_dir);

    let _ = fs::write(ca_dir.join("ca_cert.pem"), ca_cert.pem());
    let _ = fs::write(ca_dir.join("ca_key.pem"), ca_key_pair.serialize_pem());

    let _ = fs::write(ca_dir.join("entity_cert.pem"), entity_cert.pem());
    let _ = fs::write(ca_dir.join("entity_key.pem"), entity_key_pair.serialize_pem());

    // let mut der_binary = Vec::<u8>::new();
    // for b in entity_cert.der().bytes() {
    //     match b {
    //         Ok(b) => der_binary.push(b),
    //         Err(e) => println!("{:?}", e)
    //     }
    // }
    // let _ = fs::write(ca_dir.join("entity_cert.der"), der_binary);

    let mut der_binary = Vec::<u8>::new();
    for b in ca_cert.der().bytes() {
        match b {
            Ok(b) => der_binary.push(b),
            Err(e) => println!("{:?}", e)
        }
    }
    let _ = fs::write(ca_dir.join("ca_cert.der"), der_binary);

}

fn check_ca() {
    let ca_dir = Path::new("./ca");
    let entity_cert = ca_dir.join("entity_cert.pem");
    let entity_key = ca_dir.join("entity_key.pem");
    let ca_cert = ca_dir.join("ca_cert.pem");
    let ca_key = ca_dir.join("ca_key.pem");

    if !entity_cert.exists() || !entity_key.exists() || !ca_cert.exists() || !ca_key.exists() {
        create_ca();

        // Command::new("./ca/ca_cert.der")
        //     .output()
        //     .expect("failed to execute process");
    }
}

fn available_port() -> std::io::Result<u16> {
    match std::net::TcpListener::bind("localhost:0") {
        Ok(listener) => {
            Ok(listener.local_addr().unwrap().port())
        }
        Err(e) => Err(e)
    }
}

pub fn serve_proxy(port: u16, mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>, tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>, save_path: String) -> Result<SocketAddr, Box<dyn std::error::Error>> {

    check_ca();
    let key_pair = fs::read_to_string("./ca/entity_key.pem").expect("Failed to open file");
    // let key_pair = include_str!("../ca/entity_key.pem");
    let ca_cert = fs::read_to_string("./ca/entity_cert.pem").expect("Failed to open file");
    // let ca_cert = include_str!("../ca/entity_cert.pem");
    let key_pair = KeyPair::from_pem(&key_pair).expect("Failed to parse private key");
    let ca_cert = CertificateParams::from_ca_cert_pem(&ca_cert)
        .expect("Failed to parse CA certificate")
        .self_signed(&key_pair)
        .expect("Failed to sign CA certificate");

    let ca = RcgenAuthority::new(key_pair, ca_cert, 1_000, aws_lc_rs::default_provider());
    
    let mut http = hyper_util::client::legacy::connect::HttpConnector::new();
    http.enforce_http(false);
    // http.set_connect_timeout(Some(Duration::from_secs(5)));
    http.set_keepalive_interval(Some(Duration::from_secs(20)));
    
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


    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new()).build(https);
    let addr = match port {
        0 => SocketAddr::from(([127, 0, 0, 1], available_port().unwrap())),
        _ => SocketAddr::from(([127, 0, 0, 1], port)),
    };
    let server_proxy = Proxy::builder()
        .with_addr(addr.clone())
        .with_ca(ca)
        .with_client(client)
        // .with_rustls_client(aws_lc_rs::default_provider())
        .with_http_handler(LogHandler {
            tx_proxy_log: tx_proxy_log.clone(),
            request_uri: Uri::default(),
            save_path: save_path.clone(),
        })
        .with_graceful_shutdown(async move {
            loop {
                tokio::select! {
                    recv_msg = slave.recv() => {
                        match recv_msg {
                            None => {
                                println!("Received None message");
                            },
                            Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                                println!("Received shutdown message: {} {}", status, message);
                                let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                                    status: "SHUTTING DOWN".to_string(),
                                    message: "Proxy server is shutting down".to_string(),
                                }).await;
                                break;
                            },
                            Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                                println!("Received health message: {} {}", status, message);
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
        .expect("Failed to create proxy");

    println!("Proxy server addr: {}", addr);

    tokio::task::spawn(server_proxy.start());

    Ok(addr)
}
