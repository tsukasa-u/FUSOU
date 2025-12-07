use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use rand::prelude::*;
use ratatui::{backend::CrosstermBackend, Terminal};
use std::{
    cmp::Ordering,
    io,
    sync::mpsc::{self, Receiver, Sender},
    sync::{Arc, Mutex},
    sync::atomic::AtomicBool,
    thread,
    time::{Duration, Instant},
};
use rayon::prelude::*;
use uuid::Uuid;

// Use modules from lib.rs
use formula_miner::*;
use formula_miner::config::MinerConfig;
use formula_miner::solver::GeneticConfig;
use formula_miner::state::{AppEvent, Phase, SolverState, ParameterSet};
use formula_miner::app::{push_log, save_sweep_results};
use engine::run_solver;

fn main() -> Result<()> {
    // Initialize terminal and application state
    let mut terminal = app::initialize_terminal()?;
    let (mut state, tx, rx, worker_id, shutdown_flag, shared_config) = app::setup_application();
    
    // Auto-load configuration
    if let Ok(mut cfg_guard) = state.miner_config.lock() {
        let loaded = config::MinerConfig::load_or_default("miner_config.toml");
        *cfg_guard = loaded;
        let _ = tx.send(AppEvent::Log("✓ miner_config.toml auto-loaded (clustering & cluster_mode ready)".to_string()));
    }
    
    // Set initial phase and log ready message
    state.phase = Phase::Idle;
    let _ = tx.send(AppEvent::Log("Ready. Use /start command to begin optimization.".to_string()));
    
    // Run main event loop
    app::run_event_loop(&mut terminal, &mut state, &tx, &rx)?;
    
    // Cleanup and exit
    app::cleanup_terminal(&mut terminal)?;
    Ok(())
}
