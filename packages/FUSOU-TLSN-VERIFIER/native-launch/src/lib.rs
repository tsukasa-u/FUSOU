#![deny(unsafe_code)]
#![deny(unsafe_op_in_unsafe_fn)]
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use std::fmt;

#[derive(Debug)]
pub enum LaunchError {
    PolicyContextNotRegistered,
    Invalid(&'static str),
    Io(std::io::Error),
    Syscall(nix::errno::Errno),
    ExecutableMemfd(nix::errno::Errno),
    Input(String),
}

impl fmt::Display for LaunchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PolicyContextNotRegistered => f.write_str("FD_POLICY_CONTEXT_NOT_REGISTERED"),
            Self::Invalid(message) => write!(f, "NATIVE_LAUNCH {message}"),
            Self::Io(error) => write!(f, "NATIVE_LAUNCH I/O: {error}"),
            Self::Syscall(error) => write!(f, "NATIVE_LAUNCH syscall: {error}"),
            Self::ExecutableMemfd(error) => write!(
                f,
                "NATIVE_LAUNCH executable memfd refused; no fallback: {error}"
            ),
            Self::Input(error) => write!(f, "NATIVE_LAUNCH input: {error}"),
        }
    }
}
impl std::error::Error for LaunchError {}
impl From<std::io::Error> for LaunchError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<nix::errno::Errno> for LaunchError {
    fn from(error: nix::errno::Errno) -> Self {
        Self::Syscall(error)
    }
}
type Result<T> = std::result::Result<T, LaunchError>;

pub struct RegisteredPolicyContext {
    _private: (),
}

/// There is deliberately no registered policy issuer or synthetic public factory.
pub fn registered_policy_context() -> Result<RegisteredPolicyContext> {
    Err(LaunchError::PolicyContextNotRegistered)
}

// Unadopted OS containment is a synthetic experiment, not a testplay dependency.
// The ordinary library exposes only the closed registration boundary.
#[cfg(test)]
mod bridge;
#[cfg(test)]
mod cgroup;
#[cfg(test)]
mod lifecycle;
#[cfg(test)]
mod prepare;
#[cfg(test)]
mod supervise;
#[cfg(test)]
#[allow(unsafe_code)]
mod sys;

#[cfg(test)]
#[path = "../tests/synthetic.rs"]
mod tests;

#[cfg(test)]
#[path = "../tests/ipc_peer.rs"]
mod ipc_peer;
