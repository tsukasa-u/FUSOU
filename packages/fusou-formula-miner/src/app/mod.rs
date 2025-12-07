//! Application orchestration layer
//!
//! This module contains the high-level application logic that coordinates
//! between the UI, solver engine, and network components.

pub mod initialization;
pub mod event_loop;
pub mod helpers;
pub mod sweep_manager;

pub use initialization::{initialize_terminal, cleanup_terminal, setup_application};
pub use event_loop::run_event_loop;
pub use helpers::push_log;
pub use sweep_manager::save_sweep_results;
