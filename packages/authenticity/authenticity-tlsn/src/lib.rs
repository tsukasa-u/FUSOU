#![forbid(unsafe_code)]

pub const TLSN_UPSTREAM_REVISION: &str = "47aee45b53e06648c1b2ad3689b367b8c923fdec";

#[cfg(feature = "clean-upstream-spike")]
mod clean_upstream;

#[cfg(feature = "clean-upstream-spike")]
pub use clean_upstream::{
    DisclosureDirection, PresentationVerifier, ServerCertificateTrust, TlsnVerificationError,
    TrustedNotaryKey, UntrustedPresentation, VerifiedDisclosure, VerifiedPresentation,
    default_spike_input_limit,
};
