use crate::dataset::{Dataset, RemoteJobPayload};
use anyhow::{bail, Context, Result};
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde::Serialize;
use std::time::Duration;
use uuid::Uuid;

const DEFAULT_SERVER: &str = "http://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const DEFAULT_MAX_GENERATIONS: u64 = 25_000;
const DEFAULT_TARGET_ERROR: f64 = 1e-3;

pub struct WorkerClient {
    base_url: String,
    token: Option<String>,
    worker_id: Uuid,
    client: Client,
}

impl WorkerClient {
    pub fn new_from_env() -> Result<Self> {
        let base_url = std::env::var("FORMULA_MINER_SERVER")
            .ok()
            .unwrap_or_else(|| DEFAULT_SERVER.to_string());
        let token = std::env::var("FORMULA_MINER_TOKEN").ok();
        let timeout = std::env::var("FORMULA_MINER_TIMEOUT_MS")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .unwrap_or(DEFAULT_TIMEOUT_MS);

        let client = Client::builder()
            .timeout(Duration::from_millis(timeout))
            .build()
            .context("failed to construct HTTP client")?;

        Ok(Self {
            base_url,
            token,
            worker_id: Uuid::new_v4(),
            client,
        })
    }

    pub fn worker_id(&self) -> Uuid {
        self.worker_id
    }

    pub fn fetch_job(&self) -> Result<Option<RemoteJob>> {
        let url = format!("{}/job", self.base_url.trim_end_matches('/'));
        let mut request = self
            .client
            .get(url)
            .header("X-Worker-Id", self.worker_id.to_string());

        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }

        let response = request
            .send()
            .context("failed to contact coordination server")?;

        match response.status() {
            StatusCode::NO_CONTENT | StatusCode::NOT_FOUND => Ok(None),
            StatusCode::OK => {
                let payload: RemoteJobPayload =
                    response.json().context("failed to decode job payload")?;
                let dataset = payload
                    .ensure_dataset()
                    .context("job payload missing usable dataset")?;
                let job = RemoteJob {
                    job_id: payload.job_id,
                    chunk_id: payload.chunk_id,
                    dataset,
                    max_generations: payload.max_generations.unwrap_or(DEFAULT_MAX_GENERATIONS),
                    target_error: payload.target_error.unwrap_or(DEFAULT_TARGET_ERROR),
                    correlation_threshold: payload.correlation_threshold,
                    sample_count: payload.sample_count(),
                };
                Ok(Some(job))
            }
            status => bail!("server responded with unexpected status {status}"),
        }
    }

    pub fn submit_result(&self, submission: &JobSubmission) -> Result<()> {
        let url = format!("{}/result", self.base_url.trim_end_matches('/'));
        let mut request = self
            .client
            .post(url)
            .header("X-Worker-Id", self.worker_id.to_string())
            .json(submission);

        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }

        let response = request
            .send()
            .context("failed to deliver submission to server")?;

        if response.status().is_success() {
            return Ok(());
        }

        bail!(
            "server rejected submission with status {}",
            response.status()
        );
    }
}

pub struct RemoteJob {
    pub job_id: Uuid,
    pub chunk_id: Option<Uuid>,
    pub dataset: Dataset,
    pub max_generations: u64,
    pub target_error: f64,
    pub correlation_threshold: f64,
    pub sample_count: usize,
}

impl RemoteJob {
    pub fn feature_names(&self) -> &[String] {
        &self.dataset.feature_names
    }
}

#[derive(Debug, Serialize)]
pub struct JobSubmission {
    pub job_id: Uuid,
    pub worker_id: Uuid,
    pub chunk_id: Option<Uuid>,
    pub expression: String,
    pub error: f64,
    pub generation: u64,
    pub features: Vec<String>,
    pub duration_ms: u128,
}
