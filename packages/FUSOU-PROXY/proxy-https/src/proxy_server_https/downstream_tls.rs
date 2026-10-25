use http::uri::Authority;
use std::{future::Future, sync::Arc};
use tokio_rustls::rustls::ServerConfig;

/// Downstream interception TLS configuration only; never an upstream trust root.
pub trait DownstreamTlsConfigProvider: Send + Sync + 'static {
    fn server_config(&self, authority: &Authority) -> impl Future<Output = Arc<ServerConfig>> + Send;
}

impl<T: hudsucker::certificate_authority::CertificateAuthority> DownstreamTlsConfigProvider for T {
    fn server_config(&self, authority: &Authority) -> impl Future<Output = Arc<ServerConfig>> + Send {
        hudsucker::certificate_authority::CertificateAuthority::gen_server_config(self, authority)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct IndependentProvider(Arc<ServerConfig>);

    impl DownstreamTlsConfigProvider for IndependentProvider {
        async fn server_config(&self, _authority: &Authority) -> Arc<ServerConfig> {
            Arc::clone(&self.0)
        }
    }

    #[tokio::test]
    async fn provider_can_be_used_without_a_hudsucker_ca() {
        let config = ServerConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(
            tokio_rustls::rustls::server::ResolvesServerCertUsingSni::new(),
        ));
        let config = Arc::new(config);
        let provider = IndependentProvider(Arc::clone(&config));
        let actual = provider
            .server_config(&"game.example.test:443".parse().unwrap())
            .await;
        assert!(Arc::ptr_eq(&config, &actual));
    }
}
