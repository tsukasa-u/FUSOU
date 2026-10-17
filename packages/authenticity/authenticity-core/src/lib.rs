#![forbid(unsafe_code)]

use thiserror::Error;

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

        for label in hostname.split('.') {
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

        for invalid in [
            "",
            "TLSNotary.org",
            "*.example.org",
            "example.org.",
            "example.org:443",
            "192.0.2.1",
            "[2001:db8::1]",
            "münich.example",
            "-bad.example",
            "bad-.example",
            "bad_name.example",
        ] {
            assert!(ServerIdentity::new(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn principal_identifiers_keep_issuer_and_subject_distinct() {
        let id = PrincipalId::new("https://issuer.example", "subject-7").unwrap();
        assert_eq!(id.issuer(), "https://issuer.example");
        assert_eq!(id.subject(), "subject-7");
    }
}
