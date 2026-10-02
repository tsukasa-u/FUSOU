use std::{
    error::Error as StdError,
    fmt::Debug,
    sync::{Arc, Mutex},
    time::Duration,
};

use rustls::{
    client::{
        danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
        WebPkiServerVerifier,
    },
    pki_types::{CertificateDer, ServerName, UnixTime},
    ClientConfig, DigitallySignedStruct, Error, RootCertStore, SignatureScheme,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use x509_parser::parse_x509_certificate;

#[derive(Debug)]
struct RecordingVerifier {
    inner: Arc<dyn ServerCertVerifier>,
    observed_chain: Arc<Mutex<Vec<Vec<u8>>>>,
}

impl ServerCertVerifier for RecordingVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        if let Ok(mut chain) = self.observed_chain.lock() {
            chain.clear();
            chain.push(end_entity.as_ref().to_vec());
            chain.extend(intermediates.iter().map(|certificate| certificate.as_ref().to_vec()));
        }
        self.inner.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        )
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner
            .verify_tls12_signature(message, certificate, signature)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.inner
            .verify_tls13_signature(message, certificate, signature)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

fn certificate_metadata(index: usize, der: &[u8]) -> Value {
    let fingerprint = Sha256::digest(der)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    match parse_x509_certificate(der) {
        Ok((_, certificate)) => json!({
            "chain_index": index,
            "der_bytes": der.len(),
            "sha256": fingerprint,
            "serial_hex": certificate.raw_serial().iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "subject": certificate.subject().to_string(),
            "issuer": certificate.issuer().to_string(),
            "not_before_unix": certificate.validity().not_before.timestamp(),
            "not_after_unix": certificate.validity().not_after.timestamp(),
        }),
        Err(_) => json!({
            "chain_index": index,
            "der_bytes": der.len(),
            "sha256": fingerprint,
            "parse_error": "peer certificate is not valid X.509 DER",
        }),
    }
}

fn native_root_store() -> (RootCertStore, usize, Vec<String>) {
    let mut root_store = RootCertStore::empty();
    let loaded = rustls_native_certs::load_native_certs();
    let mut accepted = 0;
    let mut errors = loaded
        .errors
        .iter()
        .map(|error| format!("{error:?}"))
        .collect::<Vec<_>>();
    for certificate in loaded.certs {
        match root_store.add(certificate) {
            Ok(()) => accepted += 1,
            Err(error) => errors.push(format!("root certificate rejected: {error}")),
        }
    }
    (root_store, accepted, errors)
}

fn client_config(
    roots: RootCertStore,
    observed_chain: Arc<Mutex<Vec<Vec<u8>>>>,
) -> Result<ClientConfig, Box<dyn StdError>> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let standard_verifier = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), Arc::clone(&provider)).build()?;
    let recording_verifier = Arc::new(RecordingVerifier {
        inner: standard_verifier,
        observed_chain,
    });
    Ok(ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .dangerous()
        .with_custom_certificate_verifier(recording_verifier)
        .with_no_client_auth())
}

async fn observe_origin(host: &str, port: u16) -> Value {
    let (roots, root_count, root_errors) = native_root_store();
    let observed_chain = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
    let base_report = |handshake: bool, error: Option<String>| {
        let chain = observed_chain
            .lock()
            .map(|certificates| {
                certificates
                    .iter()
                    .enumerate()
                    .map(|(index, certificate)| certificate_metadata(index, certificate))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        json!({
            "schema_version": 1,
            "observation_only": true,
            "trust_configuration_changed": false,
            "host": host,
            "port": port,
            "trust_store": "rustls_native_certs",
            "native_roots_loaded": root_count,
            "native_root_load_errors": root_errors,
            "tls_handshake_verified": handshake,
            "validation_error": error,
            "peer_chain": chain,
        })
    };

    let server_name = match ServerName::try_from(host.to_owned()) {
        Ok(server_name) => server_name,
        Err(error) => return base_report(false, Some(format!("invalid DNS host: {error}"))),
    };
    let client_config = match client_config(roots, Arc::clone(&observed_chain)) {
        Ok(config) => Arc::new(config),
        Err(error) => return base_report(false, Some(format!("cannot build TLS verifier: {error}"))),
    };
    let stream = match tokio::time::timeout(Duration::from_secs(8), TcpStream::connect((host, port))).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(error)) => return base_report(false, Some(format!("TCP connection failed: {error}"))),
        Err(_) => return base_report(false, Some("TCP connection timed out".to_owned())),
    };
    let connector = TlsConnector::from(client_config);
    match tokio::time::timeout(Duration::from_secs(8), connector.connect(server_name, stream)).await {
        Ok(Ok(_stream)) => base_report(true, None),
        Ok(Err(error)) => base_report(false, Some(format!("TLS handshake rejected: {error}"))),
        Err(_) => base_report(false, Some("TLS handshake timed out".to_owned())),
    }
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(host) = args.next() else {
        eprintln!("usage: tlsn-origin-probe <dns-hostname> [port]");
        return std::process::ExitCode::from(2);
    };
    if host == "--help" || host == "-h" {
        println!("usage: tlsn-origin-probe <dns-hostname> [port]\n\nPerforms a TLS handshake only; sends no HTTP request and does not modify trust configuration.");
        return std::process::ExitCode::SUCCESS;
    }
    let port = match args.next() {
        Some(value) => match value.parse::<u16>() {
            Ok(port) if port > 0 => port,
            _ => {
                eprintln!("port must be between 1 and 65535");
                return std::process::ExitCode::from(2);
            }
        },
        None => 443,
    };
    if args.next().is_some() {
        eprintln!("usage: tlsn-origin-probe <dns-hostname> [port]");
        return std::process::ExitCode::from(2);
    }
    let report = observe_origin(&host, port).await;
    println!("{}", serde_json::to_string_pretty(&report).expect("JSON report serializes"));
    if report["tls_handshake_verified"] == true {
        std::process::ExitCode::SUCCESS
    } else {
        std::process::ExitCode::from(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::{
        date_time_ymd, BasicConstraints, Certificate, CertificateParams,
        ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose,
    };

    fn ca(common_name: &str) -> (Certificate, KeyPair) {
        let key = KeyPair::generate().expect("CA key");
        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, common_name);
        (params.self_signed(&key).expect("CA certificate"), key)
    }

    fn intermediate(
        common_name: &str,
        issuer: &Certificate,
        issuer_key: &KeyPair,
    ) -> (Certificate, KeyPair) {
        let key = KeyPair::generate().expect("intermediate key");
        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, common_name);
        (
            params.signed_by(&key, issuer, issuer_key).expect("intermediate certificate"),
            key,
        )
    }

    fn leaf(
        dns_name: &str,
        issuer: &Certificate,
        issuer_key: &KeyPair,
        expired: bool,
    ) -> (Certificate, KeyPair) {
        let key = KeyPair::generate().expect("leaf key");
        let mut params = CertificateParams::new(vec![dns_name.to_owned()]).expect("leaf params");
        params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        if expired {
            params.not_before = date_time_ymd(2020, 1, 1);
            params.not_after = date_time_ymd(2020, 2, 1);
        }
        (params.signed_by(&key, issuer, issuer_key).expect("leaf certificate"), key)
    }

    fn verify(
        roots: RootCertStore,
        host: &str,
        leaf: &Certificate,
        intermediates: &[&Certificate],
    ) -> Result<(), Error> {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let verifier = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider)
            .build()
            .expect("test verifier");
        let server_name = ServerName::try_from(host.to_owned()).expect("test DNS name");
        verifier
            .verify_server_cert(
                &CertificateDer::from(leaf.der().to_vec()),
                &intermediates
                    .iter()
                    .map(|certificate| CertificateDer::from(certificate.der().to_vec()))
                    .collect::<Vec<_>>(),
                &server_name,
                &[],
                UnixTime::now(),
            )
            .map(|_| ())
    }

    fn root_store(root: &Certificate) -> RootCertStore {
        let mut roots = RootCertStore::empty();
        roots.add(CertificateDer::from(root.der().to_vec())).expect("test root");
        roots
    }

    #[test]
    fn leaf_renewal_and_intermediate_migration_keep_the_same_root_trust() {
        let (root, root_key) = ca("Origin Root");
        let (first_leaf, _) = leaf("origin.example.test", &root, &root_key, false);
        let (renewed_leaf, _) = leaf("origin.example.test", &root, &root_key, false);
        let roots = root_store(&root);
        assert!(verify(roots.clone(), "origin.example.test", &first_leaf, &[]).is_ok());
        assert!(verify(roots, "origin.example.test", &renewed_leaf, &[]).is_ok());

        let (first_intermediate, first_intermediate_key) =
            intermediate("Origin Intermediate A", &root, &root_key);
        let (first_intermediate_leaf, _) = leaf(
            "origin.example.test",
            &first_intermediate,
            &first_intermediate_key,
            false,
        );
        let (second_intermediate, second_intermediate_key) =
            intermediate("Origin Intermediate B", &root, &root_key);
        let (second_intermediate_leaf, _) = leaf(
            "origin.example.test",
            &second_intermediate,
            &second_intermediate_key,
            false,
        );
        let roots = root_store(&root);
        assert!(verify(roots.clone(), "origin.example.test", &first_intermediate_leaf, &[&first_intermediate]).is_ok());
        assert!(verify(roots, "origin.example.test", &second_intermediate_leaf, &[&second_intermediate]).is_ok());
    }

    #[test]
    fn invalid_hostname_expiry_missing_intermediate_and_wrong_root_are_rejected() {
        let (root, root_key) = ca("Origin Root");
        let roots = root_store(&root);
        let (leaf_certificate, _) = leaf("origin.example.test", &root, &root_key, false);
        assert!(verify(roots.clone(), "other.example.test", &leaf_certificate, &[]).is_err());

        let (expired, _) = leaf("origin.example.test", &root, &root_key, true);
        assert!(verify(roots.clone(), "origin.example.test", &expired, &[]).is_err());

        let (intermediate_root, intermediate_root_key) = ca("Intermediate Root");
        let (intermediate, intermediate_key) =
            intermediate("Origin Intermediate", &intermediate_root, &intermediate_root_key);
        let (intermediate_leaf, _) = leaf("origin.example.test", &intermediate, &intermediate_key, false);
        let roots = root_store(&intermediate_root);
        assert!(verify(roots.clone(), "origin.example.test", &intermediate_leaf, &[]).is_err());
        assert!(verify(roots, "origin.example.test", &intermediate_leaf, &[&intermediate]).is_ok());

        let (untrusted_root, untrusted_root_key) = ca("Untrusted Root");
        let (untrusted_leaf, _) = leaf("origin.example.test", &untrusted_root, &untrusted_root_key, false);
        assert!(verify(root_store(&root), "origin.example.test", &untrusted_leaf, &[]).is_err());
    }

    #[test]
    fn root_migration_requires_adding_the_new_root_to_the_native_store() {
        let (old_root, old_root_key) = ca("Old Origin Root");
        let (new_root, new_root_key) = ca("New Origin Root");
        let (old_leaf, _) = leaf("origin.example.test", &old_root, &old_root_key, false);
        let (new_leaf, _) = leaf("origin.example.test", &new_root, &new_root_key, false);
        let old_roots = root_store(&old_root);
        assert!(verify(old_roots.clone(), "origin.example.test", &old_leaf, &[]).is_ok());
        assert!(verify(old_roots, "origin.example.test", &new_leaf, &[]).is_err());
        let mut migrated_roots = root_store(&old_root);
        migrated_roots
            .add(CertificateDer::from(new_root.der().to_vec()))
            .expect("new root");
        assert!(verify(migrated_roots, "origin.example.test", &new_leaf, &[]).is_ok());
    }
}