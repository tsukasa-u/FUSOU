// Core modules
pub mod config;
pub mod mina;
pub mod network;
pub mod state;
pub mod ui;
pub mod worker_mgmt;

// Organized module structure
pub mod app;
pub mod engine;
pub mod evaluation;
pub mod solver;

#[cfg(feature = "clustering")]
pub mod clustering;
