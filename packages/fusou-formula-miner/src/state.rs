use crate::mina::FocusedPanel;
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
        }
    }
}

pub enum AppEvent {
    Update(u64, f64, String),
    Log(String),
    TopCandidates(Vec<CandidateFormula>),
    PhaseChange(Phase),
    Online(bool),
    JobLoaded(JobSummary),
    FeatureSelection(Vec<String>),
    Error(String),
    Finished,
    // Request main loop to start a fresh solver run
    StartRequested,
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
