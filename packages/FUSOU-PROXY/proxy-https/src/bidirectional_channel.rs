// Re-export either the mpsc-based implementation (default) or the grpc-based
// implementation when the `grpc` feature is enabled.
#[cfg(feature = "grpc")]
pub use crate::grpc_channel::*;

#[cfg(not(feature = "grpc"))]
pub use crate::mpsc_channel::*;

pub use crate::channel_types::StatusInfo;
