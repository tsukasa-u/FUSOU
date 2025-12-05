use std::path::PathBuf;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerRunConfig {
    pub worker_id: String,
    pub results_dir: PathBuf,
    pub process_id: Option<u32>,
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerResultFile {
    pub worker_id: String,
    pub job_id: String,
    pub expression: String,
    pub error: f64,
    pub generation: u64,
    pub features: Vec<String>,
    pub duration_ms: u128,
    pub timestamp: String,
}

pub fn load_worker_result(results_dir: &PathBuf) -> anyhow::Result<Option<WorkerResultFile>> {
    let result_path = results_dir.join("result.json");
    if !result_path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(&result_path)?;
    let result: WorkerResultFile = serde_json::from_str(&json)?;
    Ok(Some(result))
}

pub fn save_worker_run_config(config: &WorkerRunConfig, path: &PathBuf) -> anyhow::Result<()> {
    let json = serde_json::to_string_pretty(config)?;
    std::fs::write(path, json)?;
    Ok(())
}

pub fn load_worker_run_config(path: &PathBuf) -> anyhow::Result<Option<WorkerRunConfig>> {
    if !path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(path)?;
    let config: WorkerRunConfig = serde_json::from_str(&json)?;
    Ok(Some(config))
}
