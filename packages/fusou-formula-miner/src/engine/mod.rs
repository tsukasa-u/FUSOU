//! Genetic Algorithm optimization engine
//!
//! This module contains the core optimization logic including the main solver loop,
//! genetic operators, and optimization strategies.

pub mod optimizer;
pub mod synthetic_data;
pub mod selection;
pub mod dataset;
pub mod statistics;
pub mod duplicate_detection;
pub mod solver_helpers;

pub use optimizer::run_solver;
pub use synthetic_data::{synthetic_job, synthetic_job_with_config};
pub use selection::{Individual, tournament_select};
pub use dataset::*;
pub use statistics::*;
pub use duplicate_detection::*;
pub use solver_helpers::*;
