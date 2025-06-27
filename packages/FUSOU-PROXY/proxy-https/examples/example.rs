use http_body_util::BodyExt;
use hudsucker::{
    certificate_authority::RcgenAuthority,
    hyper::{Request, Response},
    rcgen::{CertificateParams, KeyPair},
    rustls::crypto::aws_lc_rs,
    tokio_tungstenite::tungstenite::Message,
    *,
};
use std::{net::SocketAddr, time::Duration};
use tracing::*;

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to install CTRL+C signal handler");
}

#[derive(Clone)]
struct LogHandler;

impl HttpHandler for LogHandler {
    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        println!("{:?}", req.uri());
        req.into()
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        // println!("{:?}", res);
        // res.body_mut();
        let (part, body) = res.into_parts();
        // let _res = decode_response(res).unwrap();

        let collected = body.collect().await.unwrap();
        let body = collected.to_bytes().clone();
        let full_body = http_body_util::Full::from(body.clone());
        let _body_vec = body.to_vec();
        if !body.is_empty() {
            // println!("{:?}", body.slice(0..10));
            println!("{:?}", part.headers);
        } else {
            println!("No body");
        }

        // let reconstructed_body = Body::from(collected);
        let reconstructed_body = hudsucker::Body::from(full_body);

        let reconstructed_response = Response::from_parts(part, reconstructed_body);
        // let reconstructed_response = Response::from_parts(part, body);
        return reconstructed_response;
        // res
    }
}

impl WebSocketHandler for LogHandler {
    async fn handle_message(&mut self, _ctx: &WebSocketContext, msg: Message) -> Option<Message> {
        println!("{:?}", msg);
        Some(msg)
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let key_pair = include_str!("ca/entity_key.pem");
    let ca_cert = include_str!("ca/entity_cert.pem");
    let key_pair = KeyPair::from_pem(key_pair).expect("Failed to parse private key");
    let ca_cert = CertificateParams::from_ca_cert_pem(ca_cert)
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

    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build(https);

    let proxy = Proxy::builder()
        .with_addr(SocketAddr::from(([127, 0, 0, 1], 3000)))
        .with_ca(ca)
        .with_client(client)
        // .with_rustls_client(aws_lc_rs::default_provider())
        .with_http_handler(LogHandler)
        .with_websocket_handler(LogHandler)
        .with_graceful_shutdown(shutdown_signal())
        .build()
        .expect("Failed to create proxy");

    println!("Proxy listening on 127.0.0.1:3000");

    println!("set proxy address to http://localhost:3000 and install root ca ca_cert.der on click to trusted root ca");

    println!("Press Ctrl+C to shutdown");

    if let Err(e) = proxy.start().await {
        error!("{}", e);
    }
}
