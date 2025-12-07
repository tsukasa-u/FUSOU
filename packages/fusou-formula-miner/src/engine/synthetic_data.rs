//! Synthetic dataset generation for testing and development

use uuid::Uuid;
use crate::network::RemoteJob;
use crate::config::MinerConfig;

/// Create a synthetic job with specified configuration
pub fn synthetic_job_with_config(cfg: &MinerConfig) -> RemoteJob {
    let dataset = crate::engine::dataset::synthetic_dataset_for(&cfg.synthetic_data.dataset_type, &cfg.synthetic_data);
    let samples = dataset.len();
    RemoteJob {
        job_id: Uuid::nil(),
        chunk_id: None,
        dataset,
        max_generations: 10_000,
        target_error: 1e-3,
        correlation_threshold: 0.1,
        sample_count: samples,
    }
}

/// Create a synthetic job with default configuration
pub fn synthetic_job() -> RemoteJob {
    // Backwards-compatible fallback using default config
    let cfg = MinerConfig::default();
    synthetic_job_with_config(&cfg)
}
