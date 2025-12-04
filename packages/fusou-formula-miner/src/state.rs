use crate::mina::FocusedPanel;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Preprocessing,
    Solving,
    Finished,
}

pub struct SolverState {
    pub generation: u64,
    pub best_error: f64,
    pub best_formula: String,
    pub logs: Vec<String>,
    pub progress: f64,
    pub input_buffer: String,
    pub command_suggestions: Vec<String>,
    pub log_scroll_offset: usize,
    pub best_solution_scroll_offset: usize,
    pub focused_panel: FocusedPanel,
    pub phase: Phase,
}

impl SolverState {
    pub fn new() -> Self {
        Self {
            generation: 0,
            best_error: f64::MAX,
            best_formula: "Initializing...".into(),
            logs: vec![],
            progress: 0.0,
            input_buffer: String::new(),
            command_suggestions: vec![],
            log_scroll_offset: 0,
            best_solution_scroll_offset: 0,
            focused_panel: FocusedPanel::Logs,
            phase: Phase::Preprocessing,
        }
    }
}

pub enum AppEvent {
    Update(u64, f64, String),
    Log(String),
    PhaseChange(Phase),
    Finished,
}
