use std::time::Duration;
use url::{Host, Url};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerRole {
    Canary,
    Production,
}

impl WorkerRole {
    pub fn from_binding_mode(mode: &str) -> Result<Self, String> {
        match mode {
            "fixed_canary" => Ok(Self::Canary),
            "random" => Ok(Self::Production),
            _ => Err("TLSN expected role/binding pair is invalid".to_owned()),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Canary => "canary",
            Self::Production => "production",
        }
    }
}

pub fn validate_active_version_pin(value: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(value)
        .map_err(|_| "TLSN independent active-version pin is missing or invalid".to_owned())?;
    if parsed.is_nil() || parsed.to_string() != value {
        return Err(
            "TLSN independent active-version pin must be a canonical non-nil UUID".to_owned(),
        );
    }
    Ok(())
}

fn worker_url(value: &str) -> Result<Url, String> {
    let parsed = Url::parse(value).map_err(|_| "TLSN Worker endpoint is invalid".to_owned())?;
    if value.trim() != value
        || parsed.as_str() != value
        || parsed.scheme() != "https"
        || !matches!(parsed.host(), Some(Host::Domain(_)))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "TLSN Worker endpoint must be clean HTTPS without credentials, port, query or fragment"
                .to_owned(),
        );
    }
    Ok(parsed)
}

pub fn validate_worker_endpoints(health: &str, verification: &str) -> Result<(), String> {
    let health = worker_url(health)?;
    let verification = worker_url(verification)?;
    if health.path() != "/health" {
        return Err("TLSN Worker health path must be /health".to_owned());
    }
    if !matches!(verification.path(), "/verify/tlsn" | "/verify/tlsn/sparse") {
        return Err("TLSN Worker verification path is invalid".to_owned());
    }
    if health.origin() != verification.origin() {
        return Err(
            "TLSN health and verification endpoints must use the same approved Worker origin"
                .to_owned(),
        );
    }
    Ok(())
}

pub fn health_http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
}

pub fn validate_disclosure_endpoint(mode: &str, endpoint: &str) -> Result<(), String> {
    let expected_path = match mode {
        "complete" => "/verify/tlsn",
        "sparse" => "/verify/tlsn/sparse",
        _ => return Err("TLSN disclosure mode is invalid".to_owned()),
    };
    if worker_url(endpoint)?.path() != expected_path {
        return Err("TLSN disclosure mode does not match the pinned verification route".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn role_is_selected_from_the_independent_binding_expectation() {
        assert_eq!(
            WorkerRole::from_binding_mode("random").unwrap(),
            WorkerRole::Production
        );
        assert_eq!(
            WorkerRole::from_binding_mode("fixed_canary").unwrap(),
            WorkerRole::Canary
        );
        for mode in ["", "fixed_test", "arbitrary", "production", "canary"] {
            assert!(WorkerRole::from_binding_mode(mode).is_err(), "{mode}");
        }
    }

    #[test]
    fn version_pin_requires_an_independently_supplied_canonical_id() {
        validate_active_version_pin("4b064508-1cdb-453c-826b-bdea36a8b1e5").unwrap();
        for version in [
            "",
            "cf-version-1",
            "00000000-0000-0000-0000-000000000000",
            "4B064508-1CDB-453C-826B-BDEA36A8B1E5",
        ] {
            assert!(validate_active_version_pin(version).is_err(), "{version}");
        }
    }

    #[test]
    fn disclosure_mode_must_match_the_pinned_verification_route() {
        for (mode, path) in [
            ("complete", "/verify/tlsn"),
            ("sparse", "/verify/tlsn/sparse"),
        ] {
            validate_disclosure_endpoint(mode, &format!("https://worker.example{path}")).unwrap();
            let wrong = if mode == "complete" {
                "sparse"
            } else {
                "complete"
            };
            assert!(
                validate_disclosure_endpoint(wrong, &format!("https://worker.example{path}"))
                    .unwrap_err()
                    .contains("pinned verification route")
            );
        }
    }

    #[test]
    fn endpoint_binding_accepts_only_the_approved_https_origin_and_paths() {
        for path in ["/verify/tlsn", "/verify/tlsn/sparse"] {
            validate_worker_endpoints(
                "https://worker.example/health",
                &format!("https://worker.example{path}"),
            )
            .unwrap();
        }
        for (health, verification) in [
            (
                "https://other.example/health",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example/health",
                "https://other.example/verify/tlsn",
            ),
            (
                "http://worker.example/health",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example/health",
                "http://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example/health?x=1",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example/health",
                "https://worker.example/verify/tlsn?x=1",
            ),
            (
                "https://worker.example/health#x",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example/health",
                "https://worker.example/verify/tlsn/status",
            ),
            (
                "https://worker.example/other",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://user@worker.example/health",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example:8443/health",
                "https://worker.example:8443/verify/tlsn",
            ),
            (
                "https://worker.example:443/health",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example/x/../health",
                "https://worker.example/verify/tlsn",
            ),
            (
                "https://worker.example/health",
                "https://worker.example/x/../verify/tlsn",
            ),
            ("", "https://worker.example/verify/tlsn"),
            ("https://worker.example/health", ""),
        ] {
            assert!(
                validate_worker_endpoints(health, verification).is_err(),
                "{health} / {verification}"
            );
        }
    }

    #[tokio::test]
    async fn approved_health_client_never_follows_a_redirect() {
        let source = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = source.local_addr().unwrap();
        let destination = target.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = source.accept().await.unwrap();
            let mut request = [0; 4096];
            stream.read(&mut request).await.unwrap();
            stream.write_all(format!("HTTP/1.1 302 Found\r\nLocation: http://{destination}/health\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        });
        let response = health_http_client()
            .unwrap()
            .get(format!("http://{address}/health"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), target.accept())
                .await
                .is_err()
        );
        server.await.unwrap();
    }
}
