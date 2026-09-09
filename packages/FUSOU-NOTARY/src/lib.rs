#![forbid(unsafe_code)]

pub mod config;
pub mod keys;
pub mod protocol;

pub use config::NotaryConfig;
pub use keys::{KeyMaterial, KeyStatus};
