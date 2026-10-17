#![forbid(unsafe_code)]

pub const TLSN_UPSTREAM_REVISION: &str = "47aee45b53e06648c1b2ad3689b367b8c923fdec";

#[cfg(feature = "clean-upstream-spike")]
mod clean_upstream;

#[cfg(feature = "clean-upstream-spike")]
pub use clean_upstream::{
    default_spike_input_limit, DisclosureDirection, PresentationVerifier, ServerCertificateTrust,
    ServerCertificateTrustKind, TlsnVerificationError, TrustedNotaryKey, UntrustedPresentation,
    VerifiedDisclosure, VerifiedPresentation,
};
