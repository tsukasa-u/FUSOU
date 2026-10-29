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

// The mechanism is private and has no production admission constructor.
// Only this crate's test harness can manufacture a launch permit.
#[allow(dead_code)]
mod bridge;
#[allow(dead_code)]
mod cgroup;
#[allow(dead_code)]
mod lifecycle;
#[allow(dead_code)]
mod prepare;
#[allow(dead_code)]
mod recovery;
#[allow(dead_code)]
mod supervise;
#[allow(dead_code, unsafe_code)]
mod sys;

#[cfg(test)]
#[path = "../tests/synthetic.rs"]
mod tests;

#[cfg(test)]
#[path = "../tests/ipc_peer.rs"]
mod ipc_peer;
