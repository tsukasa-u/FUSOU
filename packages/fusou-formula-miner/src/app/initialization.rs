//! Application initialization and cleanup

use anyhow::Result;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::sync::mpsc::{self, Sender, Receiver};
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::state::{AppEvent, SolverState, Phase};
use crate::solver::GeneticConfig;

/// Initialize terminal for TUI rendering
pub fn initialize_terminal() -> Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend).map_err(Into::into)
}

/// Cleanup terminal state before exit
pub fn cleanup_terminal(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> Result<()> {
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;
    Ok(())
}

/// Setup application state, channels, and configuration
pub fn setup_application() -> (
    SolverState,
    Sender<AppEvent>,
    Receiver<AppEvent>,
    Uuid,
    Arc<AtomicBool>,
    Arc<Mutex<GeneticConfig>>,
) {
    let (tx, rx) = mpsc::channel();
    let worker_id = Uuid::new_v4();
    let shutdown_flag = Arc::new(AtomicBool::new(false));
    let shared_config = Arc::new(Mutex::new(GeneticConfig::default()));
    
    // Create broadcast channel for dashboard updates (buffer 100 events)
    let (dashboard_tx, _) = broadcast::channel(100);

    let mut state = SolverState::new(worker_id);
    state.shutdown_flag = Some(shutdown_flag.clone());
    state.shared_config = Some(shared_config.clone());
    state.event_sender = Some(tx.clone());
    state.dashboard_tx = dashboard_tx;
    state.phase = Phase::Idle;

    (state, tx, rx, worker_id, shutdown_flag, shared_config)
}
