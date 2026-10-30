#![forbid(unsafe_code)]

use thiserror::Error;

pub mod http_framing;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum IdentityError {
    #[error("identifier is empty, too long, or contains control characters")]
    InvalidIdentifier,
    #[error("server identity is not a canonical lowercase DNS hostname")]
    InvalidServerIdentity,
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PrincipalId {
    issuer: String,
    subject: String,
}

impl PrincipalId {
    pub fn new(
        issuer: impl Into<String>,
        subject: impl Into<String>,
    ) -> Result<Self, IdentityError> {
        let issuer = issuer.into();
        let subject = subject.into();
        validate_identifier(&issuer)?;
        validate_identifier(&subject)?;
        Ok(Self { issuer, subject })
    }

    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    pub fn subject(&self) -> &str {
        &self.subject
    }
}

impl std::fmt::Debug for PrincipalId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PrincipalId")
            .field("issuer", &self.issuer)
            .field("subject", &"[redacted]")
            .finish()
    }
}

macro_rules! string_identifier {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, IdentityError> {
                let value = value.into();
                validate_identifier(&value)?;
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

string_identifier!(DeviceId);
string_identifier!(SessionId);
string_identifier!(AuthorityKeyId);

/// Returns whether a key ID uses the shared ASCII key identifier syntax.
pub fn is_valid_key_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ChallengeId([u8; 16]);

impl ChallengeId {
    pub const fn new(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Digest([u8; 32]);

impl Digest {
    pub const fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerificationStatus {
    Verified,
    Rejected,
    NotImplemented,
    NotChecked,
    Blocked,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ServerIdentity(String);

impl ServerIdentity {
    pub fn new(hostname: impl Into<String>) -> Result<Self, IdentityError> {
        let hostname = hostname.into();
        if hostname.is_empty()
            || hostname.len() > 253
            || !hostname.is_ascii()
            || hostname.parse::<std::net::IpAddr>().is_ok()
        {
            return Err(IdentityError::InvalidServerIdentity);
        }

        let labels = hostname.split('.').collect::<Vec<_>>();
        let Some(top_level_domain) = labels.last() else {
            return Err(IdentityError::InvalidServerIdentity);
        };
        if labels.len() < 2
            || !(2..=63).contains(&top_level_domain.len())
            || !top_level_domain
                .bytes()
                .all(|byte| byte.is_ascii_lowercase())
        {
            return Err(IdentityError::InvalidServerIdentity);
        }

        for label in labels {
            let bytes = label.as_bytes();
            if bytes.is_empty()
                || bytes.len() > 63
                || bytes[0] == b'-'
                || bytes[bytes.len() - 1] == b'-'
                || !bytes
                    .iter()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
            {
                return Err(IdentityError::InvalidServerIdentity);
            }
        }

        Ok(Self(hostname))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

fn validate_identifier(value: &str) -> Result<(), IdentityError> {
    if value.is_empty() || value.len() > 1024 || value.chars().any(char::is_control) {
        return Err(IdentityError::InvalidIdentifier);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_identity_accepts_only_canonical_dns_hostnames() {
        assert_eq!(
            ServerIdentity::new("tlsnotary.org").unwrap().as_str(),
            "tlsnotary.org"
        );
        assert_eq!(
            ServerIdentity::new("xn--mnich-kva.example")
                .unwrap()
                .as_str(),
            "xn--mnich-kva.example"
        );
        assert!(ServerIdentity::new(&format!("{}.example", "a".repeat(63))).is_ok());
        assert!(ServerIdentity::new(&format!("game.{}", "a".repeat(63))).is_ok());
        assert!(ServerIdentity::new(&format!(
            "{}.{}.{}.{}",
            "a".repeat(63),
            "b".repeat(63),
            "c".repeat(63),
            "d".repeat(61)
        ))
        .is_ok());

        for invalid in [
            "",
            "localhost",
            "TLSNotary.org",
            "*.example.org",
            "example.org.",
            ".example.org",
            "example..org",
            "example.org:443",
            "https://example.org",
            "example.org/path",
            "example.org?query",
            "sha256/fingerprint",
            "192.0.2.1",
            "[2001:db8::1]",
            "2001:db8::1",
            "münich.example",
            "example.xn--p1ai",
            "-bad.example",
            "bad-.example",
            "bad_name.example",
            "game.1",
            "game.example\n",
            "game.example\t",
            "game example",
        ] {
            assert!(ServerIdentity::new(invalid).is_err(), "{invalid}");
        }

        assert!(ServerIdentity::new(&format!("{}.example", "a".repeat(64))).is_err());
        assert!(ServerIdentity::new(&format!("game.{}", "a".repeat(64))).is_err());
        assert!(ServerIdentity::new(&format!(
            "{}.{}.{}.{}",
            "a".repeat(63),
            "b".repeat(63),
            "c".repeat(63),
            "d".repeat(62)
        ))
        .is_err());
    }

    #[test]
    fn principal_identifiers_keep_issuer_and_subject_distinct() {
        let id = PrincipalId::new("https://issuer.example", "subject-7").unwrap();
        assert_eq!(id.issuer(), "https://issuer.example");
        assert_eq!(id.subject(), "subject-7");
    }

    #[test]
    fn key_id_syntax_preserves_ascii_and_byte_length_constraints() {
        assert!(is_valid_key_id("a"));
        assert!(is_valid_key_id("AZaz09._-"));
        assert!(is_valid_key_id("result-signer_2026.v1"));
        assert!(is_valid_key_id(&"a".repeat(128)));

        for invalid in [
            "",
            "invalid key ID",
            "café",
            "key/id",
            "key:id",
            "key\nid",
            "key\tid",
        ] {
            assert!(!is_valid_key_id(invalid), "{invalid}");
        }
        assert!(!is_valid_key_id(&"a".repeat(129)));
    }
}
