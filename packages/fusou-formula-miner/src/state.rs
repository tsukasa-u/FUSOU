use crate::mina::FocusedPanel;
use crate::config::MinerConfig;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::sync::mpsc::Sender;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Connecting,
    Preprocessing,
    Solving,
    Uploading,
    Finished,
    Error,
    #[allow(dead_code)]
    WorkerRunning,
    #[allow(dead_code)]
    WorkerFinished,
}

/// Top candidate expression with its RMSE
#[derive(Clone, Debug)]
pub struct CandidateFormula {
    pub rank: usize,           // 1-5
    pub formula: String,
    pub rmse: f64,
}

pub struct SolverState {
    pub worker_id: Uuid,
    pub job_id: Option<Uuid>,
    pub chunk_id: Option<Uuid>,
    pub generation: u64,
    pub best_error: f64,
    pub best_formula: String,
    pub logs: Vec<String>,
    pub progress: f64,
    pub input_buffer: String,
    pub command_suggestions: Vec<String>,
    // Index of the currently selected suggestion in `command_suggestions`, if any.
    pub suggestion_selected: Option<usize>,
    pub log_scroll_offset: usize,
    pub best_solution_scroll_offset: usize,
    pub focused_panel: FocusedPanel,
    pub phase: Phase,
    pub sample_count: usize,
    pub selected_features: Vec<String>,
    pub max_generations: u64,
    pub target_error: f64,
    pub correlation_threshold: f64,
    pub last_error: Option<String>,
    // Optional human-readable ground-truth expression (when synthetic dataset used)
    pub target_formula: Option<String>,
    // Shutdown flag for requesting the solver to stop early
    pub shutdown_flag: Option<Arc<AtomicBool>>,
    // Is the worker running in online mode (connected to coordination server)?
    pub online: bool,
    // Shared genetic configuration (allows UI to update GA parameters at runtime)
    pub shared_config: Option<Arc<Mutex<crate::solver::GeneticConfig>>>,
    // Sender to send AppEvent messages back into the main event loop (used to spawn solver)
    pub event_sender: Option<Sender<crate::state::AppEvent>>,
    // Top 5 candidate formulas being explored
    pub top_candidates: Vec<CandidateFormula>,
    // Subprocess management
    #[allow(dead_code)]
    pub worker_process_id: Option<u32>,
    #[allow(dead_code)]
    pub worker_results_dir: Option<PathBuf>,
    #[allow(dead_code)]
    pub worker_started_at: Option<std::time::Instant>,
    // Track input mode: true if IME (Japanese) mode is active, false for English
    pub ime_mode_active: bool,
    // Track if solver is currently running
    pub solver_running: bool,
    // Parameter sweep configuration for parameter tuning experiments
    pub sweep_config: Option<SweepConfig>,
    // Centralized miner configuration (replaces scattered hardcoded values)
    pub miner_config: Arc<Mutex<MinerConfig>>,
    // Track duplicate/similar solutions to encourage exploration diversity (shared with solver thread)
    pub duplicate_tracker: Arc<Mutex<crate::duplicate_detection::DuplicateTracker>>,
    // Latest operator counts aggregated from solver (label, count)
    pub operator_counts: Vec<(String, usize)>,
    // Selected operator index when OperatorStats panel is focused
    pub operator_selected_index: usize,
    // Clustering results: cluster ID for each sample (if clustering enabled)
    // Uses serde_json::Value as placeholder to avoid feature-gate complications
    pub cluster_assignments: Option<serde_json::Value>,
    // Currently selected cluster to view (when clustering enabled)
    pub selected_cluster_id: Option<usize>,
    // UI state: which panel is currently focused
    pub focus_cluster_panel: bool,
    // Current cluster being processed (for per-cluster optimization)
    pub current_cluster_info: Option<String>,
}

impl SolverState {
    pub fn new(worker_id: Uuid) -> Self {
        Self {
            worker_id,
            job_id: None,
            chunk_id: None,
            generation: 0,
            best_error: f64::MAX,
            best_formula: "Initializing...".into(),
            logs: vec![],
            progress: 0.0,
            input_buffer: String::new(),
            command_suggestions: vec![],
            suggestion_selected: None,
            log_scroll_offset: 0,
            best_solution_scroll_offset: 0,
            focused_panel: FocusedPanel::Logs,
            phase: Phase::Idle,
            sample_count: 0,
            selected_features: vec![],
            max_generations: 1,
            target_error: 1e-3,
            correlation_threshold: 0.1,
            last_error: None,
            target_formula: None,
            shutdown_flag: None,
            online: false,
            shared_config: None,
            event_sender: None,
            top_candidates: vec![],
            worker_process_id: None,
            worker_results_dir: None,
            worker_started_at: None,
            ime_mode_active: false,
            solver_running: false,
            sweep_config: None,
            miner_config: Arc::new(Mutex::new(MinerConfig::default())),
            duplicate_tracker: Arc::new(Mutex::new(crate::duplicate_detection::DuplicateTracker::default())),
            operator_counts: Vec::new(),
            operator_selected_index: 0,
            cluster_assignments: None,
            selected_cluster_id: None,
            focus_cluster_panel: false,
            current_cluster_info: None,
        }
    }
}

pub enum AppEvent {
    Update(u64, f64, String),
    Log(String),
    TopCandidates(Vec<CandidateFormula>),
    OperatorStats(Vec<(String, usize)>),
    PhaseChange(Phase),
    Online(bool),
    JobLoaded(JobSummary),
    FeatureSelection(Vec<String>),
    Error(String),
    Finished,
    // Request main loop to start a fresh solver run
    StartRequested,
    // Clustering results
    ClusteringResults(Option<serde_json::Value>),
    // Current cluster being processed during optimization
    CurrentClusterInfo(String),
}

#[derive(Clone)]
pub struct JobSummary {
    pub job_id: Option<Uuid>,
    pub chunk_id: Option<Uuid>,
    pub sample_count: usize,
    pub feature_names: Vec<String>,
    pub max_generations: u64,
    pub target_error: f64,
    pub correlation_threshold: f64,
    pub ground_truth: Option<String>,
}

/// Parameter set for tuning genetic algorithm performance
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ParameterSet {
    pub population_size: usize,
    pub max_depth: usize,
    pub mutation_rate: f64,
    pub crossover_rate: f64,
    pub tournament_size: usize,
    pub elite_count: usize,
    pub use_nsga2: bool,
    pub tarpeian_probability: f64,
    pub hoist_mutation_rate: f64,
    pub constant_optimization_interval: usize,
    pub max_generations: u64,
    pub target_error: f64,
    pub correlation_threshold: f64,
    /// Performance metric achieved with this parameter set
    #[serde(skip_serializing_if = "Option::is_none")]
    pub achieved_error: Option<f64>,
}

/// Sweep configuration for parameter tuning (with optional local refinement)
#[derive(Clone, Debug)]
pub struct SweepConfig {
    pub parameters_to_sweep: Vec<String>,
    pub ranges: std::collections::HashMap<String, (f64, f64, f64)>, // (min, max, step)
    pub current_iteration: usize,
    pub total_iterations: usize,
    pub best_params: Option<ParameterSet>,
    pub best_error: f64,
    pub results: Vec<(ParameterSet, f64)>, // (params, achieved_error)

    // Refinement controls
    pub refinement_enabled: bool,
    pub max_refinements: usize,
    pub refinement_factor: f64, // multiply step by this when refining (e.g. 0.5 -> half step)
    pub current_refinement: usize,
    // When performing a local refinement, we generate a temporary ranges map
    pub in_refinement_mode: bool,
    pub refinement_ranges: Option<std::collections::HashMap<String, (f64, f64, f64)>>,
    pub refinement_total_iterations: usize,
    pub refinement_current_iteration: usize,
    pub refinement_parent_iteration: Option<usize>,
    // Repeats per parameter setting and aggregation
    pub repeats_per_setting: usize,
    pub current_repeat: usize,
    pub accumulated_errors: Vec<f64>,
    pub run_durations: Vec<f64>,
    // Historical durations across the whole sweep (used to estimate ETA)
    pub historical_run_durations: Vec<f64>,
    // Per-run generation history for the currently executing run
    pub current_run_history: Vec<(u64, f64)>,
    // Accumulated per-repeat histories for current parameter setting
    pub accumulated_histories: Vec<Vec<(u64, f64)>>,
    // Detailed JSON results (includes median/stddev and histories)
    pub detailed_results: Vec<serde_json::Value>,
    // When refining, consider top K previous results to compute refinement center
    pub refinement_top_k: usize,
}

