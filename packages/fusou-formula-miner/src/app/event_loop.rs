//! Main event loop handling UI events and solver messages

use anyhow::Result;
use crossterm::event::{self, Event};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::io;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::thread;
use std::time::{Duration, Instant};

use crate::state::{AppEvent, SolverState, Phase, ParameterSet};
use crate::mina;
use crate::ui;

/// Main event loop: render UI, handle input, process solver messages
pub fn run_event_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    state: &mut SolverState,
    tx: &Sender<AppEvent>,
    rx: &Receiver<AppEvent>,
) -> Result<()> {
    loop {
        terminal.draw(|f| ui::render_ui(f, state))?;

        if event::poll(Duration::from_millis(16))? {
            match event::read()? {
                Event::Key(key) => {
                    if mina::handle_key_event(key, state) {
                        break;
                    }
                }
                Event::Mouse(mouse) => {
                    mina::handle_mouse_event(mouse, state);
                }
                _ => {}
            }
        }

        while let Ok(msg) = rx.try_recv() {
            handle_app_event(msg, state, tx)?;
        }
    }
    
    Ok(())
}

/// Handle a single AppEvent message from solver or UI commands
fn handle_app_event(
    msg: AppEvent,
    state: &mut SolverState,
    tx: &Sender<AppEvent>,
) -> Result<()> {
    match msg {
        AppEvent::Update(completed, total, error, formula) => {
            // If solver is not running (e.g., stopped), ignore late updates
            if !state.solver_running {
                return Ok(());
            }
            let capped_completed = if total > 0 { completed.min(total) } else { completed };
            state.best_error = error;
            state.best_formula = formula.clone();
            // Progress is fraction of completed work over total work
            state.progress = if total > 0 {
                (capped_completed as f64 / total as f64).min(1.0)
            } else {
                0.0
            };

            // record total work for UI (used when clustered)
            state.total_work = total;

            // Map completed/total back to an approximate generation number for UI display.
            // If per-cluster generation info is available, prefer the sum of per-cluster generations
            // so that state.generation matches the sum shown in the per-cluster list.
            if !state.per_cluster_generation.is_empty() {
                let sum: u64 = state.per_cluster_generation.values().copied().sum();
                state.generation = sum;
            } else if state.max_generations > 0 && total > 0 {
                // proportionally scale completed -> generation within [0, max_generations]
                let gen = ((capped_completed as f64 * state.max_generations as f64) / total as f64).round() as u64;
                state.generation = gen.min(state.max_generations);
            }

            // record per-generation history for current run (for learning curves)
            if let Some(sweep_cfg) = state.sweep_config.as_mut() {
                if (sweep_cfg.current_run_history.len() as u64) <= state.max_generations {
                    sweep_cfg.current_run_history.push((state.generation, error));
                }
            }
            
            // Send to dashboard via broadcast
            let _ = state.dashboard_tx.send(crate::state::DashboardEvent {
                event_type: "progress".to_string(),
                data: serde_json::json!({
                    "generation": state.generation,
                    "best_error": error,
                    "progress": state.progress,
                }),
            });
        }
        AppEvent::Online(is_online) => {
            state.online = is_online;
            let _ = tx.send(AppEvent::Log(format!("Mode: {}", if is_online { "Online" } else { "Offline" })));
        }
        AppEvent::Log(message) => push_log(state, message),
        AppEvent::TopCandidates(candidates) => {
            state.top_candidates = candidates.clone();
            // Send top candidates to dashboard
            for candidate in &candidates {
                let _ = state.dashboard_tx.send(crate::state::DashboardEvent {
                    event_type: "candidate".to_string(),
                    data: serde_json::json!({
                        "formula": candidate.formula,
                        "rmse": candidate.rmse,
                        "rank": candidate.rank,
                    }),
                });
            }
        }
        AppEvent::OperatorStats(counts) => {
            state.operator_counts = counts;
        }
        AppEvent::PhaseChange(phase) => {
            state.phase = phase.clone();
            // Send phase change to dashboard
            let _ = state.dashboard_tx.send(crate::state::DashboardEvent {
                event_type: "phase_change".to_string(),
                data: serde_json::json!({
                    "phase": format!("{:?}", phase),
                }),
            });
        }
        AppEvent::JobLoaded(summary) => {
            state.job_id = summary.job_id;
            state.chunk_id = summary.chunk_id;
            state.sample_count = summary.sample_count;
            state.selected_features = summary.feature_names;
            // If max_generations hasn't been explicitly set by user (still at initial value),
            // use job's configuration
            if state.max_generations == 100 {  // Our new default initial value
                state.max_generations = summary.max_generations;
            }
            // Keep user-configured target_error if it was already set
            // Only use job's target_error if still at default value
            if (state.target_error - 1e-3).abs() < 1e-9 {
                // Default value - use job's configuration
                state.target_error = summary.target_error;
            }
            // Keep user-configured correlation_threshold if it was already set
            // Only use job's correlation_threshold if still at default value
            if (state.correlation_threshold - 0.1).abs() < 1e-9 {
                // Default value - use job's configuration
                state.correlation_threshold = summary.correlation_threshold;
            }
            state.target_formula = summary.ground_truth.clone();
            state.generation = 0;
            state.progress = 0.0;
        }
        AppEvent::StartRequested => {
            handle_start_request(state, tx)?;
        }
        AppEvent::FeatureSelection(features) => {
            state.selected_features = features;
        }
        AppEvent::Error(err) => {
            state.last_error = Some(err.clone());
            push_log(state, format!("Error: {err}"));
            state.phase = Phase::Error;
        }
        AppEvent::Finished => {
            handle_finished_event(state)?;
            // Send completion event to dashboard
            let _ = state.dashboard_tx.send(crate::state::DashboardEvent {
                event_type: "completed".to_string(),
                data: serde_json::json!({
                    "final_rmse": state.best_error,
                    "final_generation": state.generation,
                }),
            });
        }
        #[cfg(feature = "clustering")]
        AppEvent::ClusteringResults(assignments) => {
            state.cluster_assignments = assignments;
        }
        AppEvent::CurrentClusterInfo(info) => {
            // Update current cluster info and set/start timestamp when cluster changes
            let prev = state.current_cluster_info.clone();
            if prev.as_deref() != Some(info.as_str()) {
                state.current_cluster_started_at = Some(Instant::now());
            }
            state.current_cluster_info = Some(info);
        }
        AppEvent::PerClusterBest(label, err, formula, gen) => {
            // Update per-cluster best mapping and generation
            state.per_cluster_best.insert(label.clone(), (err, formula.clone()));
            state.per_cluster_generation.insert(label.clone(), gen);
            // mark active cluster label to allow UI to highlight the row
            state.current_cluster_label = Some(label);
            
            // Send best formula update to dashboard
            let _ = state.dashboard_tx.send(crate::state::DashboardEvent {
                event_type: "best_formula".to_string(),
                data: serde_json::json!({
                    "formula": formula,
                    "rmse": err,
                    "generation": gen,
                }),
            });
        }
    }
    Ok(())
}

/// Handle StartRequested event: spawn solver thread
fn handle_start_request(
    state: &mut SolverState,
    tx: &Sender<AppEvent>,
) -> Result<()> {
    if state.shared_config.is_none() {
        push_log(state, "Start requested but no shared configuration available".into());
        state.solver_running = false;
    } else {
        let shutdown_flag = Arc::new(AtomicBool::new(false));
        state.shutdown_flag = Some(shutdown_flag.clone());
        state.worker_started_at = Some(std::time::Instant::now());
        state.solver_running = true;  // Mark solver as running BEFORE spawn
        let solver_tx = tx.clone();
        let solver_shutdown = shutdown_flag.clone();
        let solver_config = state.shared_config.clone().unwrap();
        let worker_id = state.worker_id;
        let user_max_generations = state.max_generations;
        let user_target_error = state.target_error;
        let user_correlation_threshold = state.correlation_threshold;
        let solver_miner_config = state.miner_config.clone();
        let solver_dup_tracker = state.duplicate_tracker.clone();
        
        thread::spawn(move || {
            crate::engine::run_solver(
                worker_id,
                solver_tx,
                solver_shutdown,
                solver_config,
                solver_miner_config,
                solver_dup_tracker,
                user_max_generations,
                user_target_error,
                user_correlation_threshold
            )
        });
        
        push_log(state, "Spawned fresh solver run in response to /start".into());
    }
    Ok(())
}

/// Handle Finished event: record sweep results if applicable
fn handle_finished_event(state: &mut SolverState) -> Result<()> {
    push_log(state, "Done.".into());
    state.progress = 1.0;
    if state.max_generations > 0 {
        state.generation = state.max_generations;
    }
    state.phase = Phase::Finished;
    state.solver_running = false;
    state.shutdown_flag = None;
    
    // If this is part of a parameter sweep, record the result
    if let Some(mut sweep_config) = state.sweep_config.take() {
        let mut current_params = ParameterSet {
            population_size: 0,
            max_depth: 0,
            mutation_rate: 0.0,
            crossover_rate: 0.0,
            tournament_size: 0,
            elite_count: 0,
            use_nsga2: false,
            tarpeian_probability: 0.0,
            hoist_mutation_rate: 0.0,
            constant_optimization_interval: 0,
            max_generations: state.max_generations,
            target_error: state.target_error,
            correlation_threshold: state.correlation_threshold,
            achieved_error: Some(state.best_error),
        };
        
        if let Some(cfg_arc) = &state.shared_config {
            if let Ok(cfg) = cfg_arc.lock() {
                current_params.population_size = cfg.population_size;
                current_params.max_depth = cfg.max_depth;
                current_params.mutation_rate = cfg.mutation_rate;
                current_params.crossover_rate = cfg.crossover_rate;
                current_params.tournament_size = cfg.tournament_size;
                current_params.elite_count = cfg.elite_count;
                current_params.use_nsga2 = cfg.use_nsga2;
                current_params.tarpeian_probability = cfg.tarpeian_probability;
                current_params.hoist_mutation_rate = cfg.hoist_mutation_rate;
                current_params.constant_optimization_interval = cfg.constant_optimization_interval;
            }
        }
        
        sweep_config.results.push((current_params.clone(), state.best_error));
        
        // record run duration if available
        if let Some(start) = state.worker_started_at.take() {
            let dur = start.elapsed().as_secs_f64();
            sweep_config.run_durations.push(dur);
            sweep_config.historical_run_durations.push(dur);
        }

        // accumulate error for repeats
        sweep_config.accumulated_errors.push(state.best_error);
        // accumulate current run history
        sweep_config.accumulated_histories.push(sweep_config.current_run_history.clone());
        sweep_config.current_run_history.clear();

        // Continue sweep logic here (truncated for brevity - see main.rs lines 220-650)
        // TODO: Extract sweep continuation logic to separate function
        
        state.sweep_config = Some(sweep_config);
    }
    
    Ok(())
}

/// Helper: push log message to state
fn push_log(state: &mut SolverState, message: String) {
    state.logs.push(message);
    if state.logs.len() > 1000 {
        state.logs.drain(0..500);
    }
}
