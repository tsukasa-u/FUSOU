use anyhow::Result;
use std::{
    sync::mpsc,
    sync::atomic::AtomicBool,
    thread,
};
use std::sync::Arc;

// Use modules from lib.rs
use formula_miner::*;
use formula_miner::config::MinerConfig;
use formula_miner::solver::GeneticConfig;
use formula_miner::state::{AppEvent, Phase, SolverState, ParameterSet};
use formula_miner::app::{push_log, save_sweep_results, run_ws_server};
use engine::run_solver;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize terminal and application state
    let mut terminal = app::initialize_terminal()?;
    let (mut state, tx, rx, worker_id, shutdown_flag, shared_config) = app::setup_application();
    
    // Clone dashboard_tx for WebSocket server
    let dashboard_tx = state.dashboard_tx.clone();
    
    // Auto-load configuration
    if let Ok(mut cfg_guard) = state.miner_config.lock() {
        let loaded = config::MinerConfig::load_or_default("miner_config.toml");
        *cfg_guard = loaded;
        let _ = tx.send(AppEvent::Log("✓ miner_config.toml auto-loaded (clustering & cluster_mode ready)".to_string()));
    }
    
    // Set initial phase and log ready message
    state.phase = Phase::Idle;
    let _ = tx.send(AppEvent::Log("Ready. Use /start command to begin optimization.".to_string()));
    let _ = tx.send(AppEvent::Log("📊 Dashboard: Click to open → http://localhost:8766".to_string()));
    
    // Spawn WebSocket server on background thread
    let ws_handle = {
        let shutdown = shutdown_flag.clone();
        thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                if let Err(e) = run_ws_server("127.0.0.1", 8765, dashboard_tx).await {
                    eprintln!("WebSocket server error: {}", e);
                }
            });
        })
    };
    
    // Run main event loop
    app::run_event_loop(&mut terminal, &mut state, &tx, &rx)?;
    
    // Cleanup and exit
    app::cleanup_terminal(&mut terminal)?;
    Ok(())
}
