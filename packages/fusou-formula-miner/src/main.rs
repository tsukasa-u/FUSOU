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
use uuid::Uuid;

mod dataset;
mod mina;
mod network;
mod solver;
mod state;
mod statistics;
mod ui;
mod smart_init;
mod residual_learning;
mod nsga2;
mod bloat_control;
mod constant_opt;

use dataset::synthetic_dataset;
use network::{JobSubmission, RemoteJob, WorkerClient};
use solver::{crossover, mutate, Expr, GeneticConfig, UnaryOp};
use smart_init::{DataStats, smart_init};
use state::{AppEvent, JobSummary, Phase, SolverState, CandidateFormula, ParameterSet, SweepConfig};
use nsga2::{MultiObjectiveIndividual, nsga2_selection, nsga2_tournament_select};
use bloat_control::{tarpeian_penalty, hoist_mutation, average_size};
use constant_opt::optimize_constants;

fn main() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let (tx, rx): (Sender<AppEvent>, Receiver<AppEvent>) = mpsc::channel();
    let worker_id = Uuid::new_v4();

    // Prepare a shutdown flag shared between UI and solver thread
    let shutdown_flag = Arc::new(AtomicBool::new(false));

    // Create UI state and attach shutdown flag so /stop can signal solver
    let mut state = SolverState::new(worker_id);
    state.shutdown_flag = Some(shutdown_flag.clone());

    // Prepare shared genetic configuration so UI can modify parameters at runtime
    use std::sync::Mutex;
    let shared_config = Arc::new(Mutex::new(GeneticConfig::default()));
    // Expose shared_config to UI state so commands can update it
    state.shared_config = Some(shared_config.clone());
    // Expose event sender so UI commands can request actions (e.g., start solver)
    state.event_sender = Some(tx.clone());

    // Do NOT spawn solver thread immediately - wait for /start command
    // This allows users to configure parameters before starting optimization
    state.phase = Phase::Idle;
    let _ = tx.send(AppEvent::Log("Ready. Use /start command to begin optimization.".to_string()));

    loop {
        terminal.draw(|f| ui::render_ui(f, &state))?;

        if event::poll(Duration::from_millis(16))? {
            match event::read()? {
                Event::Key(key) => {
                    if mina::handle_key_event(key, &mut state) {
                        break;
                    }
                }
                Event::Mouse(mouse) => {
                    mina::handle_mouse_event(mouse, &mut state);
                }
                _ => {}
            }
        }

        while let Ok(msg) = rx.try_recv() {
            match msg {
                AppEvent::Update(generation, error, formula) => {
                    state.generation = generation;
                    state.best_error = error;
                    state.best_formula = formula;
                    if state.max_generations > 0 {
                        state.progress = (generation as f64 / state.max_generations as f64).min(1.0);
                    }
                    // record per-generation history for current run (for learning curves)
                    if let Some(sweep_cfg) = state.sweep_config.as_mut() {
                        if (sweep_cfg.current_run_history.len() as u64) <= state.max_generations {
                            sweep_cfg.current_run_history.push((generation, error));
                        }
                    }
                }
                AppEvent::Online(is_online) => {
                    state.online = is_online;
                    let _ = tx.send(AppEvent::Log(format!("Mode: {}", if is_online { "Online" } else { "Offline" })));
                }
                AppEvent::Log(message) => push_log(&mut state, message),
                AppEvent::TopCandidates(candidates) => {
                    state.top_candidates = candidates;
                }
                AppEvent::PhaseChange(phase) => {
                    state.phase = phase;
                }
                AppEvent::JobLoaded(summary) => {
                    state.job_id = summary.job_id;
                    state.chunk_id = summary.chunk_id;
                    state.sample_count = summary.sample_count;
                    state.selected_features = summary.feature_names;
                    // Keep user-configured max_generations if it was already set (/set command)
                    // Only use job's max_generations if not yet configured by user
                    if state.max_generations == 1 {
                        // Default value - use job's configuration
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
                    // Spawn a fresh solver thread in response to UI request
                    if state.shared_config.is_none() {
                        push_log(&mut state, "Start requested but no shared configuration available".into());
                        state.solver_running = false;
                    } else {
                        let shutdown_flag = Arc::new(AtomicBool::new(false));
                        state.shutdown_flag = Some(shutdown_flag.clone());
                        state.worker_started_at = Some(std::time::Instant::now());
                        let solver_tx = tx.clone();
                        let solver_shutdown = shutdown_flag.clone();
                        let solver_config = state.shared_config.clone().unwrap();
                        let worker_id = state.worker_id;
                        let user_max_generations = state.max_generations;
                        let user_target_error = state.target_error;
                        let user_correlation_threshold = state.correlation_threshold;
                        thread::spawn(move || run_solver(worker_id, solver_tx, solver_shutdown, solver_config, user_max_generations, user_target_error, user_correlation_threshold));
                        push_log(&mut state, "Spawned fresh solver run in response to /start".into());
                        // solver_running flag will be set to false when solver finishes (via Finished event)
                    }
                }
                AppEvent::FeatureSelection(features) => {
                    state.selected_features = features;
                }
                AppEvent::Error(err) => {
                    state.last_error = Some(err.clone());
                    push_log(&mut state, format!("Error: {err}"));
                    state.phase = Phase::Error;
                }
                AppEvent::Finished => {
                    push_log(&mut state, "Done.".into());
                    state.progress = 1.0;
                    state.phase = Phase::Finished;
                    state.solver_running = false;
                    
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
                        // clear current run history for next repeat
                        sweep_config.current_run_history.clear();

                        if state.best_error < sweep_config.best_error {
                            sweep_config.best_error = state.best_error;
                            sweep_config.best_params = Some(current_params.clone());
                        }
                        
                        // If repeats are configured, manage repeats before advancing main iteration
                        if sweep_config.repeats_per_setting > 1 {
                            sweep_config.current_repeat += 1;
                        }

                        // If we've completed the repeats for this parameter setting, advance main iteration
                        if sweep_config.current_repeat >= sweep_config.repeats_per_setting || sweep_config.repeats_per_setting == 1 {
                            // compute aggregated performance (mean)
                            let mean_error = if !sweep_config.accumulated_errors.is_empty() {
                                let sum: f64 = sweep_config.accumulated_errors.iter().sum();
                                sum / (sweep_config.accumulated_errors.len() as f64)
                            } else { state.best_error };
                            // push aggregated result (we'll attach achieved_error = mean)
                            // use current_params with achieved_error overwritten
                            let mut agg_params = current_params.clone();
                            agg_params.achieved_error = Some(mean_error);
                            sweep_config.results.push((agg_params.clone(), mean_error));

                            // compute median and stddev
                            let mut errs = sweep_config.accumulated_errors.clone();
                            errs.sort_by(|a,b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                            let median = if errs.is_empty() { mean_error } else {
                                let n = errs.len();
                                if n % 2 == 1 { errs[n/2] } else { (errs[n/2 - 1] + errs[n/2]) / 2.0 }
                            };
                            let mean = mean_error;
                            let var = errs.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (errs.len().max(1) as f64);
                            let stddev = var.sqrt();

                            // collect durations and histories for JSON
                            let durations = sweep_config.run_durations.clone();
                            let histories = sweep_config.accumulated_histories.clone();

                            // build detailed JSON entry
                            let detailed = serde_json::json!({
                                "parameters": serde_json::to_value(&agg_params).unwrap_or(serde_json::json!({})),
                                "mean_error": mean,
                                "median_error": median,
                                "stddev_error": stddev,
                                "run_durations": durations,
                                "histories": histories.iter().map(|h| {
                                    h.iter().map(|(g,e)| serde_json::json!({"generation": g, "best_error": e})).collect::<Vec<_>>()
                                }).collect::<Vec<_>>()
                            });
                            sweep_config.detailed_results.push(detailed);

                            // reset accumulated errors/histories/durations for next setting
                            sweep_config.accumulated_errors.clear();
                            sweep_config.accumulated_histories.clear();
                            sweep_config.run_durations.clear();
                            sweep_config.current_repeat = 0;
                            sweep_config.current_iteration += 1;
                        }
                        
                        // Save sweep results to file after each aggregated result
                        // Prefer to notify via in-app logs rather than stderr output
                        let (json_path, csv_path) = save_sweep_results(&sweep_config);
                        if let Some(p) = json_path {
                            push_log(&mut state, format!("Sweep results saved to {}", p));
                        }
                        if let Some(p) = csv_path {
                            push_log(&mut state, format!("CSV summary saved to {}", p));
                        }
                        
                        // Decide whether to start next run automatically (main sweep or local refinement)
                        let mut do_start_next = false;
                        // Helper closure to apply a ParameterSet into shared_config
                        let apply_params = |state: &mut crate::state::SolverState, params: &ParameterSet| {
                            if let Some(cfg_arc) = &state.shared_config {
                                if let Ok(mut cfg) = cfg_arc.lock() {
                                    cfg.population_size = params.population_size;
                                    cfg.max_depth = params.max_depth;
                                    cfg.mutation_rate = params.mutation_rate;
                                    cfg.crossover_rate = params.crossover_rate;
                                    cfg.tournament_size = params.tournament_size;
                                    cfg.elite_count = params.elite_count;
                                    cfg.use_nsga2 = params.use_nsga2;
                                    cfg.tarpeian_probability = params.tarpeian_probability;
                                    cfg.hoist_mutation_rate = params.hoist_mutation_rate;
                                    cfg.constant_optimization_interval = params.constant_optimization_interval;
                                }
                            }
                            // state-level params
                            state.max_generations = params.max_generations;
                            state.target_error = params.target_error;
                            state.correlation_threshold = params.correlation_threshold;
                        };

                        // Helper to compute a ParameterSet from ranges at a given mixed-radix index
                        let compute_params_from_ranges = |ranges: &std::collections::HashMap<String, (f64,f64,f64)>,
                                                           cfg_arc: &Option<std::sync::Arc<std::sync::Mutex<crate::solver::GeneticConfig>>>,
                                                           params_order: &Vec<String>,
                                                           index: usize|
                            -> ParameterSet {
                            // Compute iteration counts per parameter
                            let mut counts: Vec<usize> = Vec::new();
                            for p in params_order {
                                if let Some((min,max,step)) = ranges.get(p) {
                                    let cnt = (((max - min) / step).ceil() as usize) + 1;
                                    counts.push(cnt);
                                } else {
                                    counts.push(1);
                                }
                            }
                            // mixed-radix decode
                            let mut rem = index;
                            let mut values: std::collections::HashMap<String,f64> = std::collections::HashMap::new();
                            for (i, p) in params_order.iter().enumerate() {
                                let base = counts[i];
                                let idx = if base == 0 { 0 } else { rem % base };
                                rem = if base == 0 { rem } else { rem / base };
                                if let Some((min,max,step)) = ranges.get(p) {
                                    let val = min + (idx as f64) * step;
                                    // clamp
                                    let val = val.max(*min).min(*max);
                                    values.insert(p.clone(), val);
                                }
                            }

                            // Start with current shared_config as baseline
                            let mut pset = if let Some(cfg_arc) = cfg_arc {
                                if let Ok(cfg) = cfg_arc.lock() {
                                    ParameterSet {
                                        population_size: cfg.population_size,
                                        max_depth: cfg.max_depth,
                                        mutation_rate: cfg.mutation_rate,
                                        crossover_rate: cfg.crossover_rate,
                                        tournament_size: cfg.tournament_size,
                                        elite_count: cfg.elite_count,
                                        use_nsga2: cfg.use_nsga2,
                                        tarpeian_probability: cfg.tarpeian_probability,
                                        hoist_mutation_rate: cfg.hoist_mutation_rate,
                                        constant_optimization_interval: cfg.constant_optimization_interval,
                                        max_generations:  state.max_generations,
                                        target_error: state.target_error,
                                        correlation_threshold: state.correlation_threshold,
                                        achieved_error: None,
                                    }
                                } else {
                                    // fallback default (zeroed but preserve run-level params)
                                        ParameterSet {
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
                                            achieved_error: None,
                                        }
                                }
                            } else {
                                ParameterSet {
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
                                    achieved_error: None,
                                }
                            };

                            for (k, v) in values {
                                match k.as_str() {
                                    "population_size" => pset.population_size = v as usize,
                                    "max_depth" => pset.max_depth = v as usize,
                                    "mutation_rate" => pset.mutation_rate = v,
                                    "crossover_rate" => pset.crossover_rate = v,
                                    "tournament_size" => pset.tournament_size = v as usize,
                                    "elite_count" => pset.elite_count = v as usize,
                                    "tarpeian_probability" => pset.tarpeian_probability = v,
                                    "hoist_mutation_rate" => pset.hoist_mutation_rate = v,
                                    "constant_optimization_interval" => pset.constant_optimization_interval = v as usize,
                                    "max_generations" => pset.max_generations = v as u64,
                                    _ => {}
                                }
                            }

                            pset
                        };

                        // If currently in refinement mode, check refinement iteration
                        if sweep_config.in_refinement_mode {
                                if sweep_config.refinement_current_iteration < sweep_config.refinement_total_iterations {
                                // Start next refinement iteration
                                let idx = sweep_config.refinement_current_iteration;
                                if let Some(ref ranges) = sweep_config.refinement_ranges {
                                        // Respect user stop request: if shutdown flag is set, abort remaining sweep/refinement
                                        if let Some(flag) = &state.shutdown_flag {
                                            if flag.load(std::sync::atomic::Ordering::SeqCst) {
                                                push_log(&mut state, "Sweep/refinement aborted by user (stop requested).".into());
                                                // Clear sweep state to stop further automatic starts
                                                state.sweep_config = None;
                                                continue;
                                            }
                                        }
                                    let pset = compute_params_from_ranges(ranges, &state.shared_config, &sweep_config.parameters_to_sweep, idx);
                                    apply_params(&mut state, &pset);
                                    // spawn solver: create fresh shutdown flag
                                    let shutdown_flag = Arc::new(AtomicBool::new(false));
                                    state.shutdown_flag = Some(shutdown_flag.clone());
                                    let solver_tx = tx.clone();
                                    let solver_shutdown = shutdown_flag.clone();
                                    let solver_config = state.shared_config.clone().unwrap();
                                    let worker_id = state.worker_id;
                                    let user_max_generations = state.max_generations;
                                    let user_target_error = state.target_error;
                                    let user_correlation_threshold = state.correlation_threshold;
                                    state.solver_running = true;
                                    thread::spawn(move || run_solver(worker_id, solver_tx, solver_shutdown, solver_config, user_max_generations, user_target_error, user_correlation_threshold));
                                    push_log(&mut state, format!("Started refinement run {}/{} for parent iter {}", idx+1, sweep_config.refinement_total_iterations, sweep_config.refinement_parent_iteration.unwrap_or(0)));
                                    // increment refinement counter for next time
                                    let mut sc = sweep_config.clone();
                                    sc.refinement_current_iteration += 1;
                                    state.sweep_config = Some(sc);
                                    continue;
                                }
                            } else {
                                // Finished refinement block; exit refinement mode
                                sweep_config.in_refinement_mode = false;
                                sweep_config.refinement_ranges = None;
                                sweep_config.refinement_current_iteration = 0;
                                sweep_config.refinement_total_iterations = 0;
                                sweep_config.refinement_parent_iteration = None;
                                sweep_config.current_refinement += 1;
                                // After finishing refinement, if main sweep still has iterations, start next
                                if sweep_config.current_iteration < sweep_config.total_iterations {
                                    do_start_next = true;
                                }
                            }
                        } else {
                            // Not in refinement mode: if main sweep still has iterations, start next
                            if sweep_config.current_iteration < sweep_config.total_iterations {
                                do_start_next = true;
                            } else {
                                // main sweep exhausted — consider kicking off local refinement around this result
                                if sweep_config.refinement_enabled && (state.best_error > state.target_error) && (sweep_config.current_refinement < sweep_config.max_refinements) {
                                    // Build refinement ranges centered at current_params
                                    let mut rmap: std::collections::HashMap<String,(f64,f64,f64)> = std::collections::HashMap::new();
                                    for param in &sweep_config.parameters_to_sweep {
                                        if let Some((orig_min, orig_max, orig_step)) = sweep_config.ranges.get(param) {
                                            // find center value from current_params
                                            let mut center = if let Some(v) = match param.as_str() {
                                                        "population_size" => Some(current_params.population_size as f64),
                                                        "max_depth" => Some(current_params.max_depth as f64),
                                                        "mutation_rate" => Some(current_params.mutation_rate),
                                                        "crossover_rate" => Some(current_params.crossover_rate),
                                                        "tournament_size" => Some(current_params.tournament_size as f64),
                                                        "elite_count" => Some(current_params.elite_count as f64),
                                                        _ => None,
                                                    } { v } else { *orig_min };

                                                    // If detailed results exist, compute center as mean of top-K results for robustness
                                                    if !sweep_config.detailed_results.is_empty() {
                                                        let k = sweep_config.refinement_top_k.min(sweep_config.detailed_results.len());
                                                        let mut sum = 0.0f64;
                                                        let mut cnt = 0usize;
                                                        // sort copy by mean_error ascending
                                                        let mut entries = sweep_config.detailed_results.clone();
                                                        entries.sort_by(|a,b| {
                                                            let aa = a.get("mean_error").and_then(|v| v.as_f64()).unwrap_or(f64::INFINITY);
                                                            let bb = b.get("mean_error").and_then(|v| v.as_f64()).unwrap_or(f64::INFINITY);
                                                            aa.partial_cmp(&bb).unwrap_or(std::cmp::Ordering::Equal)
                                                        });
                                                        for e in entries.iter().take(k) {
                                                            if let Some(p) = e.get("parameters").and_then(|p| p.get(param)) {
                                                                if let Some(val) = p.as_f64() {
                                                                    sum += val;
                                                                    cnt += 1;
                                                                } else if let Some(i) = p.as_i64() {
                                                                    sum += i as f64;
                                                                    cnt += 1;
                                                                }
                                                            }
                                                        }
                                                        if cnt > 0 {
                                                            center = sum / (cnt as f64);
                                                        }
                                                    }

                                            let half = *orig_step; // use original step as radius
                                            let new_min = (center - half).max(*orig_min);
                                            let new_max = (center + half).min(*orig_max);
                                            let new_step = (*orig_step) * sweep_config.refinement_factor;
                                            rmap.insert(param.clone(), (new_min, new_max, new_step));
                                        }
                                    }
                                    // compute refinement iteration count
                                    let mut total = 1usize;
                                    for (_, (min,max,step)) in &rmap {
                                        let iters = (((max - min) / step).ceil() as usize) + 1;
                                        total *= iters.max(1);
                                    }
                                    sweep_config.in_refinement_mode = true;
                                    sweep_config.refinement_ranges = Some(rmap);
                                    sweep_config.refinement_total_iterations = total;
                                    sweep_config.refinement_current_iteration = 0;
                                    sweep_config.refinement_parent_iteration = Some(sweep_config.current_iteration.saturating_sub(1));
                                    // start first refinement run immediately if any
                                    if sweep_config.refinement_total_iterations > 0 {
                                        if let Some(ref ranges) = &sweep_config.refinement_ranges {
                                            let pset = compute_params_from_ranges(ranges, &state.shared_config, &sweep_config.parameters_to_sweep, 0);
                                            apply_params(&mut state, &pset);
                                            let shutdown_flag = Arc::new(AtomicBool::new(false));
                                            state.shutdown_flag = Some(shutdown_flag.clone());
                                            let solver_tx = tx.clone();
                                            let solver_shutdown = shutdown_flag.clone();
                                            let solver_config = state.shared_config.clone().unwrap();
                                            let worker_id = state.worker_id;
                                            let user_max_generations = state.max_generations;
                                            let user_target_error = state.target_error;
                                            let user_correlation_threshold = state.correlation_threshold;
                                            state.solver_running = true;
                                            thread::spawn(move || run_solver(worker_id, solver_tx, solver_shutdown, solver_config, user_max_generations, user_target_error, user_correlation_threshold));
                                            push_log(&mut state, format!("Started refinement run 1/{} for parent iter {}", sweep_config.refinement_total_iterations, sweep_config.refinement_parent_iteration.unwrap_or(0)));
                                            // increment refinement counter
                                            let mut sc = sweep_config.clone();
                                            sc.refinement_current_iteration = 1;
                                            state.sweep_config = Some(sc);
                                            continue;
                                        }
                                    }
                                }
                            }
                        }

                        // If requested, start next main-sweep iteration
                        if do_start_next {
                            // Respect user stop request: if shutdown flag is set, abort remaining sweep
                            if let Some(flag) = &state.shutdown_flag {
                                if flag.load(std::sync::atomic::Ordering::SeqCst) {
                                    push_log(&mut state, "Sweep aborted by user (stop requested).".into());
                                    state.sweep_config = None;
                                    continue;
                                }
                            }
                            // compute next parameter combination index (current_iteration is already incremented)
                            let next_idx = sweep_config.current_iteration.saturating_sub(1);
                            // compute ParameterSet for this iteration
                            let pset = compute_params_from_ranges(&sweep_config.ranges, &state.shared_config, &sweep_config.parameters_to_sweep, next_idx);
                            apply_params(&mut state, &pset);
                            // Spawn solver for next iteration
                            let shutdown_flag = Arc::new(AtomicBool::new(false));
                            state.shutdown_flag = Some(shutdown_flag.clone());
                            let solver_tx = tx.clone();
                            let solver_shutdown = shutdown_flag.clone();
                            let solver_config = state.shared_config.clone().unwrap();
                            let worker_id = state.worker_id;
                            let user_max_generations = state.max_generations;
                            let user_target_error = state.target_error;
                            let user_correlation_threshold = state.correlation_threshold;
                            state.solver_running = true;
                            thread::spawn(move || run_solver(worker_id, solver_tx, solver_shutdown, solver_config, user_max_generations, user_target_error, user_correlation_threshold));
                            push_log(&mut state, format!("Started sweep run {}/{}", sweep_config.current_iteration, sweep_config.total_iterations));
                            // persist updated sweep_config back into state
                            state.sweep_config = Some(sweep_config);
                            continue;
                        }

                        // Otherwise, simply persist the updated sweep_config
                        state.sweep_config = Some(sweep_config);
                    }
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    Ok(())
}

fn push_log(state: &mut SolverState, message: String) {
    // Filter out very noisy smart-init generation logs
    if message.contains("Smart-init: generated") {
        return;
    }

    // Preserve user's scroll position unless they were viewing the bottom
    let was_at_bottom = state.log_scroll_offset == 0;
    state.logs.push(message);
    if state.logs.len() > 2000 {
        state.logs.drain(0..state.logs.len() - 2000);
    }
    if was_at_bottom {
        state.log_scroll_offset = 0;
    }
}

pub fn run_solver(worker_id: Uuid, tx: Sender<AppEvent>, shutdown: Arc<AtomicBool>, shared_config: Arc<Mutex<GeneticConfig>>, max_generations: u64, target_error: f64, correlation_threshold: f64) {
    let mut rng = rand::thread_rng();
    let _ = tx.send(AppEvent::Log(format!("Worker {worker_id} started")));

    let client = match WorkerClient::new_from_env() {
        Ok(client) => Some(client),
        Err(err) => {
            let _ = tx.send(AppEvent::Log(format!(
                "Failed to initialise network client: {err}. Switching to offline mode."
            )));
            // Inform UI that we're offline
            let _ = tx.send(AppEvent::Online(false));
            None
        }
    };

    // If client init succeeded, inform UI that we're online
    if client.is_some() {
        let _ = tx.send(AppEvent::Online(true));
    }

    let mut job = {
        if let Some(ref client) = client {
            let _ = tx.send(AppEvent::PhaseChange(Phase::Connecting));
            match client.fetch_job() {
                Ok(Some(job)) => {
                    let _ = tx.send(AppEvent::Log(format!("Fetched job {}", job.job_id)));
                    job
                }
                Ok(None) => {
                    let _ = tx.send(AppEvent::Log(
                        "No job available from server; using synthetic dataset.".into(),
                    ));
                    synthetic_job()
                }
                Err(err) => {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Unable to fetch job: {err}. Using synthetic dataset instead."
                    )));
                    synthetic_job()
                }
            }
        } else {
            synthetic_job()
        }
    };

    // If this is a synthetic job, provide a human-readable ground-truth expression
    let ground_truth = if job.job_id.is_nil() {
        // Use `step` representation to avoid 'if' wording differences
        // Equivalent: multiplier = 1.0 + 0.5 * step(luck - 80)
        Some("dmg = max(atk - def, 1.0) * (1.0 + 0.5 * step(luck - 80.0))".to_string())
    } else {
        None
    };

    let _ = tx.send(AppEvent::JobLoaded(JobSummary {
        job_id: if job.job_id.is_nil() { None } else { Some(job.job_id) },
        chunk_id: job.chunk_id,
        sample_count: job.sample_count,
        feature_names: job.dataset.feature_names.clone(),
        max_generations: max_generations,
        target_error: target_error,
        correlation_threshold: correlation_threshold,
        ground_truth: ground_truth.clone(),
    }));

    // If we have a ground-truth for synthetic data, also emit a log so it is visible in logs
    if let Some(gt) = ground_truth {
        let _ = tx.send(AppEvent::Log(format!("Using synthetic dataset. Ground truth: {}", gt)));
    }

    if job.dataset.is_empty() {
        let _ = tx.send(AppEvent::Error("Dataset contained no samples".into()));
        return;
    }

    let _ = tx.send(AppEvent::PhaseChange(Phase::Preprocessing));
    let _ = tx.send(AppEvent::Log("Starting feature selection".into()));

    let (selected_indices, filter_logs) = job.dataset.filter_features(correlation_threshold);
    for entry in filter_logs {
        let _ = tx.send(AppEvent::Log(entry));
        thread::sleep(Duration::from_millis(25));
    }

    let filtered_dataset = job.dataset.apply_selection(&selected_indices);
    let _ = tx.send(AppEvent::FeatureSelection(filtered_dataset.feature_names.clone()));
    let _ = tx.send(AppEvent::Log(format!(
        "Feature selection complete: {} -> {} columns",
        job.dataset.feature_names.len(),
        filtered_dataset.feature_names.len()
    )));
    job.dataset = filtered_dataset;
    job.sample_count = job.dataset.len();

    let data = job.dataset.to_pairs();
    let var_names = job.dataset.feature_names_as_str();
    let num_vars = var_names.len();
    if num_vars == 0 {
        let _ = tx.send(AppEvent::Error(
            "No usable features remaining after preprocessing".into(),
        ));
        return;
    }

    // Initialize shared config with sensible defaults derived from data
    {
        let mut cfg = shared_config.lock().unwrap();
        cfg.max_depth = (num_vars + 2).min(8);
        cfg.population_size = (num_vars.max(1) * 24).clamp(48, 256);
        cfg.elite_count = (cfg.population_size / 8).max(2);
        cfg.tournament_size = cfg.population_size.min(6).max(2);
        // Increased base mutation rate from 0.15 to 0.25 to better escape local optima
        cfg.mutation_rate = (0.25 + (1.0 / num_vars as f64)).min(0.5);
        cfg.crossover_rate = 0.85;
    }

    let _ = tx.send(AppEvent::PhaseChange(Phase::Solving));
    {
        let cfg = shared_config.lock().unwrap();
        let _ = tx.send(AppEvent::Log(format!(
            "Solver configuration => population: {}, max depth: {}, max generations: {}",
            cfg.population_size, cfg.max_depth, max_generations
        )));
    }

    // Apply smart initialization (Approach 1: Linear/Power law analysis)
    let _ = tx.send(AppEvent::Log("Analyzing dataset for smart initialization...".into()));
    let data_stats = DataStats::analyze(&job.dataset);
    
    if data_stats.linear_r_squared > 0.7 {
        let _ = tx.send(AppEvent::Log(format!(
            "Linear pattern detected (R²: {:.3})",
            data_stats.linear_r_squared
        )));
    }
    if data_stats.power_r_squared > 0.7 {
        let _ = tx.send(AppEvent::Log(format!(
            "Power law pattern detected (R²: {:.3})",
            data_stats.power_r_squared
        )));
    }

    let start_time = Instant::now();
    
    // Track best result across all attempts
    let mut global_best_expr = Expr::Const(0.0);
    let mut global_best_error = f64::MAX;
    let mut global_best_attempt = 0;
    let mut global_best_generation = 0u64;
    
    // Read initial config snapshot; will refresh at each attempt
    let mut config = shared_config.lock().unwrap().clone();

    // Multi-attempt optimization loop
    for attempt in 0..config.max_attempts {
        // Refresh config from shared state so runtime changes take effect between attempts
        config = shared_config.lock().unwrap().clone();
        // Respect external shutdown requests (e.g., from /stop)
        if shutdown.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = tx.send(AppEvent::Log("Shutdown requested before attempt start - aborting.".into()));
            break;
        }
        let _ = tx.send(AppEvent::Log(format!(
            "Optimization attempt {}/{} (max {} generations per attempt) - Using {} mode",
            attempt + 1, config.max_attempts, max_generations,
            if config.use_nsga2 { "NSGA-II multi-objective" } else { "single-objective" }
        )));

        // Create population with smart initialization (Approach 1 & 2)
        // Call smart_init with a progress sender so the UI shows initialization steps
        let smart_population: Vec<Expr> = smart_init(
            &job.dataset,
            &data_stats,
            {
                // read current population_size from shared config
                let cfg = shared_config.lock().unwrap();
                cfg.population_size
            },
            {
                let cfg = shared_config.lock().unwrap();
                cfg.max_depth
            },
            num_vars,
            &mut rng,
            Some(&tx),
        );

        // Initialize population based on optimization mode
        let mut population: Vec<Individual>;
        let mut mo_population: Vec<MultiObjectiveIndividual>;
        
        if config.use_nsga2 {
            // Multi-objective mode
            mo_population = smart_population
                .into_iter()
                .map(|expr| {
                    let error = evaluate_error_only(&expr, &data);
                    MultiObjectiveIndividual::new(expr, error)
                })
                .collect();
            population = Vec::new(); // Not used in NSGA-II mode
        } else {
            // Single-objective mode (legacy)
            population = smart_population
                .into_iter()
                .map(|expr| Individual {
                    expr,
                    fitness: f64::MAX,
                })
                .collect();
            mo_population = Vec::new(); // Not used in single-objective mode
        }

        // Initialize best_expr and best_error from the initial population
        let (mut best_expr, mut best_error) = if config.use_nsga2 {
            let rank0_inds: Vec<_> = mo_population
                .iter()
                .filter(|ind| ind.rank == 0)
                .collect();
            if let Some(best_ind) = rank0_inds.iter().min_by(|a, b| {
                a.error.partial_cmp(&b.error).unwrap_or(Ordering::Equal)
            }) {
                (best_ind.expr.clone(), best_ind.error)
            } else {
                let best = mo_population.iter().min_by(|a, b| {
                    a.error.partial_cmp(&b.error).unwrap_or(Ordering::Equal)
                }).unwrap();
                (best.expr.clone(), best.error)
            }
        } else {
            let best = population.iter().min_by(|a, b| {
                let err_a = evaluate_error_only(&a.expr, &data);
                let err_b = evaluate_error_only(&b.expr, &data);
                err_a.partial_cmp(&err_b).unwrap_or(Ordering::Equal)
            }).unwrap();
            let best_err = evaluate_error_only(&best.expr, &data);
            (best.expr.clone(), best_err)
        };
        let _ = tx.send(AppEvent::Log(format!(
            "Initial best RMSE: {:.6}",
            best_error
        )));
        let mut best_generation = 0u64;
        let mut last_emit = Instant::now();

        for generation in 0..=max_generations {
            // Check for shutdown each generation
            if shutdown.load(std::sync::atomic::Ordering::SeqCst) {
                let _ = tx.send(AppEvent::Log(format!(
                    "Shutdown requested at generation {} - stopping attempt {}.",
                    generation, attempt + 1
                )));
                break;
            }

            if config.use_nsga2 {
                // NSGA-II multi-objective optimization
                // Perform non-dominated sorting and calculate crowding distance
                nsga2_selection(&mut mo_population);
                
                // Find best (rank 0, lowest error)
                let rank0: Vec<&MultiObjectiveIndividual> = mo_population
                    .iter()
                    .filter(|ind| ind.rank == 0)
                    .collect();
                
                if let Some(leader) = rank0.iter().min_by(|a, b| {
                    a.error.partial_cmp(&b.error).unwrap_or(Ordering::Equal)
                }) {
                    if leader.error.is_finite() && leader.error < best_error {
                        best_error = leader.error;
                        best_expr = leader.expr.clone();
                        best_generation = generation;
                        last_emit = Instant::now();
                        let _ = tx.send(AppEvent::Update(
                            generation,
                            best_error,
                            best_expr.to_string(&var_names),
                        ));
                    } else if last_emit.elapsed() >= Duration::from_millis(250) {
                        last_emit = Instant::now();
                        let _ = tx.send(AppEvent::Update(
                            generation,
                            best_error,
                            best_expr.to_string(&var_names),
                        ));
                    }
                    
                    // Update top 5 candidates every generation
                    let mut top_5: Vec<(String, f64)> = mo_population
                        .iter()
                        .map(|ind| (ind.expr.to_string(&var_names), ind.error))
                        .collect();
                    top_5.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));
                    let candidates: Vec<CandidateFormula> = top_5
                        .iter()
                        .take(5)
                        .enumerate()
                        .map(|(rank, (formula, rmse))| CandidateFormula {
                            rank: rank + 1,
                            formula: formula.clone(),
                            rmse: *rmse,
                        })
                        .collect();
                    let _ = tx.send(AppEvent::TopCandidates(candidates));
                }

                if best_error <= target_error {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Target RMSE {:.6} achieved at generation {}",
                        best_error, generation
                    )));
                    break;
                }

                if generation >= max_generations {
                    break;
                }

                // Constant optimization periodically (minimal logging)
                if config.constant_optimization_interval > 0 
                    && generation % (config.constant_optimization_interval as u64) == 0 
                    && generation > 0 {
                    let elite_count = config.elite_count.min(mo_population.len());
                    for i in 0..elite_count {
                        let optimized = optimize_constants(&mo_population[i].expr, &data, 20, 0.01);
                        let new_error = evaluate_error_only(&optimized, &data);
                        if new_error < mo_population[i].error {
                            mo_population[i].expr = optimized;
                            mo_population[i].error = new_error;
                            mo_population[i].size = mo_population[i].expr.size();
                        }
                    }
                }

                // Generate next generation
                let mut next_mo_population = Vec::with_capacity(config.population_size);
                
                // Elitism: Keep best individuals from rank 0
                let mut elites: Vec<MultiObjectiveIndividual> = mo_population
                    .iter()
                    .filter(|ind| ind.rank == 0)
                    .take(config.elite_count.min(mo_population.len()))
                    .cloned()
                    .collect();
                next_mo_population.append(&mut elites);

                while next_mo_population.len() < config.population_size {
                    let parent_a = nsga2_tournament_select(&mo_population, config.tournament_size, &mut rng);
                    
                    let mut child_expr = if rng.gen_bool(config.crossover_rate) {
                        let parent_b = nsga2_tournament_select(&mo_population, config.tournament_size, &mut rng);
                        crossover(&parent_a.expr, &parent_b.expr, &mut rng)
                    } else {
                        parent_a.expr.clone()
                    };

                    // Apply mutations
                    if rng.gen_bool(config.mutation_rate) {
                        child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth);
                    }
                    
                    // Hoist mutation for bloat control
                    if rng.gen_bool(config.hoist_mutation_rate) {
                        child_expr = hoist_mutation(&child_expr, &mut rng);
                    }

                    let child_error = evaluate_error_only(&child_expr, &data);
                    next_mo_population.push(MultiObjectiveIndividual::new(child_expr, child_error));
                }

                mo_population = next_mo_population;
                
            } else {
                // Single-objective optimization (legacy path with Tarpeian method)
                // Calculate average size for Tarpeian method
                let sizes: Vec<usize> = population.iter().map(|ind| ind.expr.size()).collect();
                let avg_size = average_size(&sizes);
                
                for individual in &mut population {
                    if !individual.fitness.is_finite() || individual.fitness == f64::MAX {
                        let error = evaluate_error_only(&individual.expr, &data);
                        let size = individual.expr.size();
                        
                        // Apply Tarpeian penalty
                        individual.fitness = tarpeian_penalty(
                            error,
                            size,
                            avg_size,
                            config.tarpeian_probability,
                            &mut rng,
                        );
                    }
                }

                population.sort_by(|a, b| match a.fitness.partial_cmp(&b.fitness) {
                    Some(ordering) => ordering,
                    None => Ordering::Equal,
                });

                if let Some(leader) = population.first() {
                    let actual_error = evaluate_error_only(&leader.expr, &data);
                    if actual_error.is_finite() && actual_error < best_error {
                        best_error = actual_error;
                        best_expr = leader.expr.clone();
                        best_generation = generation;
                        last_emit = Instant::now();
                        let _ = tx.send(AppEvent::Update(
                            generation,
                            best_error,
                            best_expr.to_string(&var_names),
                        ));
                    } else if last_emit.elapsed() >= Duration::from_millis(250) {
                        last_emit = Instant::now();
                        let _ = tx.send(AppEvent::Update(
                            generation,
                            best_error,
                            best_expr.to_string(&var_names),
                        ));
                    }
                }

                if best_error <= target_error {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Target RMSE {:.6} achieved at generation {}",
                        best_error, generation
                    )));
                    break;
                }

                if generation >= max_generations {
                    break;
                }

                let mut next_population = Vec::with_capacity(config.population_size);
                for elite in population.iter().take(config.elite_count.min(population.len())) {
                    next_population.push(Individual {
                        expr: elite.expr.clone(),
                        fitness: f64::MAX,
                    });
                }

                while next_population.len() < config.population_size {
                    let parent_a = tournament_select(&population, config.tournament_size, &mut rng);
                    
                    let mut child_expr = if rng.gen_bool(config.crossover_rate) {
                        let parent_b = tournament_select(&population, config.tournament_size, &mut rng);
                        crossover(&parent_a.expr, &parent_b.expr, &mut rng)
                    } else {
                        parent_a.expr.clone()
                    };
                    
                    if rng.gen_bool(config.mutation_rate) {
                        child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth);
                    }
                    
                    if rng.gen_bool(config.hoist_mutation_rate) {
                        child_expr = hoist_mutation(&child_expr, &mut rng);
                    }
                    
                    next_population.push(Individual {
                        expr: child_expr,
                        fitness: f64::MAX,
                    });
                }

                population = next_population;
            }
        } // End of generation loop for this attempt

        // Track best result from this attempt
        if best_error < global_best_error {
            global_best_error = best_error;
            global_best_expr = best_expr.clone();
            global_best_attempt = attempt + 1;
            global_best_generation = best_generation;
            let _ = tx.send(AppEvent::Log(format!(
                "New best found (Attempt {}): RMSE {:.6} at generation {}",
                attempt + 1, best_error, best_generation
            )));
        }

        // If target is reached, stop attempting
        if best_error <= job.target_error {
            let _ = tx.send(AppEvent::Log(format!(
                "Target RMSE {:.6} achieved in attempt {} at generation {}",
                best_error, attempt + 1, best_generation
            )));
            break;
        }
    } // End of attempt loop

    let duration_ms = start_time.elapsed().as_millis();
    let expression_text = global_best_expr.to_string(&var_names);
    let _ = tx.send(AppEvent::Log(format!(
        "Final result (Attempt {}): RMSE {:.6} at generation {} in {} ms",
        global_best_attempt, global_best_error, global_best_generation, duration_ms
    )));
    
    // Update UI with final best result
    let _ = tx.send(AppEvent::Update(
        global_best_generation,
        global_best_error,
        expression_text.clone(),
    ));

    if let Some(ref client) = client {
        if !job.job_id.is_nil() {
            let _ = tx.send(AppEvent::PhaseChange(Phase::Uploading));
            let submission = JobSubmission {
                job_id: job.job_id,
                worker_id,
                chunk_id: job.chunk_id,
                expression: expression_text.clone(),
                error: global_best_error,
                generation: global_best_generation,
                features: job.dataset.feature_names.clone(),
                duration_ms,
            };

            match client.submit_result(&submission) {
                Ok(()) => {
                    let _ = tx.send(AppEvent::Log("Submission accepted by server".into()));
                }
                Err(err) => {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Failed to submit result: {err}"
                    )));
                }
            }
        }
    } else {
        let _ = tx.send(AppEvent::Log(
            "Offline run completed; result kept locally.".into(),
        ));
    }

    let _ = tx.send(AppEvent::PhaseChange(Phase::Finished));
    let _ = tx.send(AppEvent::Finished);
}

/// Count how many step operators are present in an expression
fn count_step_ops(expr: &Expr) -> usize {
    match expr {
        Expr::Const(_) | Expr::Var(_) => 0,
        Expr::Unary { op, child } => {
            let op_count = if matches!(op, UnaryOp::Step) { 1 } else { 0 };
            op_count + count_step_ops(child)
        }
        Expr::Binary { left, right, .. } => {
            count_step_ops(left) + count_step_ops(right)
        }
    }
}

fn evaluate(expr: &Expr, data: &[(Vec<f64>, f64)]) -> f64 {
    let mut sum_sq: f64 = 0.0;
    for (vars, target) in data {
        let prediction = expr.eval(vars);
        if !prediction.is_finite() {
            return f64::MAX;
        }
        let diff = prediction - target;
        let contribution = diff * diff;
        if !contribution.is_finite() {
            return f64::MAX;
        }
        sum_sq += contribution;
        if !sum_sq.is_finite() {
            return f64::MAX;
        }
    }
    let rmse = crate::statistics::rmse(sum_sq, data.len());
    
    // Add parsimony pressure: penalize complex expressions
    // Each node adds 0.02 to the error (increased from 0.01 for stronger pressure)
    // This encourages the GA to prefer simpler, more interpretable solutions
    let complexity_penalty = expr.size() as f64 * 0.02;
    rmse + complexity_penalty
}

/// Evaluate expression without complexity penalty (for NSGA-II multi-objective)
fn evaluate_error_only(expr: &Expr, data: &[(Vec<f64>, f64)]) -> f64 {
    let mut sum_sq: f64 = 0.0;
    for (vars, target) in data {
        let prediction = expr.eval(vars);
        if !prediction.is_finite() {
            return f64::MAX;
        }
        let diff = prediction - target;
        let contribution = diff * diff;
        if !contribution.is_finite() {
            return f64::MAX;
        }
        sum_sq += contribution;
        if !sum_sq.is_finite() {
            return f64::MAX;
        }
    }
    crate::statistics::rmse(sum_sq, data.len())
}

/// Update top 5 candidates list in state
fn update_top_candidates(
    state: &mut SolverState,
    candidates: Vec<(String, f64)>,
) {
    use state::CandidateFormula;
    state.top_candidates.clear();
    for (rank, (formula, rmse)) in candidates.iter().enumerate().take(5) {
        state.top_candidates.push(CandidateFormula {
            rank: rank + 1,
            formula: formula.clone(),
            rmse: *rmse,
        });
    }
}

fn tournament_select<'a, R: Rng + ?Sized>(
    population: &'a [Individual],
    tournament_size: usize,
    rng: &mut R,
) -> &'a Individual {
    let size = population.len().max(1);
    let mut best_index = rng.gen_range(0..size);
    let mut best_fitness = population[best_index].fitness;

    for _ in 1..tournament_size {
        let candidate_index = rng.gen_range(0..size);
        let candidate_fitness = population[candidate_index].fitness;
        if candidate_fitness < best_fitness {
            best_index = candidate_index;
            best_fitness = candidate_fitness;
        }
    }

    &population[best_index]
}

fn synthetic_job() -> RemoteJob {
    let dataset = synthetic_dataset();
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

#[derive(Clone)]
struct Individual {
    expr: Expr,
    fitness: f64,
}

/// Save parameter sweep results to a JSON file and CSV summary.
/// Returns (Option<json_path>, Option<csv_path>) as strings for logging.
fn save_sweep_results(sweep_config: &SweepConfig) -> (Option<String>, Option<String>) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let filename = format!("sweep_results_{}.json", ts);

    let results_json = serde_json::json!({
        "total_iterations": sweep_config.total_iterations,
        "current_iteration": sweep_config.current_iteration,
        "parameters_swept": sweep_config.parameters_to_sweep,
        "best_error": sweep_config.best_error,
        "best_parameters": sweep_config.best_params,
        "refinement_enabled": sweep_config.refinement_enabled,
        "max_refinements": sweep_config.max_refinements,
        "refinement_factor": sweep_config.refinement_factor,
        "refinement_top_k": sweep_config.refinement_top_k,
        "all_results": sweep_config.detailed_results.clone()
    });

    let mut json_path_str: Option<String> = None;
    let mut csv_path_str: Option<String> = None;

    match std::env::current_dir() {
        Ok(dir) => {
            // Create an organized output directory: ./output/sweep_<ts>/
            let out_dir = dir.join("output").join(format!("sweep_{}", ts));
            let _ = std::fs::create_dir_all(&out_dir);
            let path = out_dir.join(&filename);
            match std::fs::write(&path, serde_json::to_string_pretty(&results_json).unwrap_or_default()) {
                Ok(_) => {
                    json_path_str = Some(path.display().to_string());
                }
                Err(_) => {
                    // ignore here; caller will not get path
                }
            }
            // Also write CSV summary into same output directory for easier analysis
            let csv_name = format!("sweep_results_{}.csv", ts);
            let csv_path = out_dir.join(&csv_name);
            csv_path_str = Some(csv_path.display().to_string());
            let mut wtr = match std::fs::OpenOptions::new().create(true).append(true).open(&csv_path) {
                Ok(f) => csv::Writer::from_writer(f),
                Err(_) => {
                    // fallback: create new file
                    match std::fs::File::create(&csv_path) {
                        Ok(f) => csv::Writer::from_writer(f),
                        Err(_) => return (json_path_str, None),
                    }
                }
            };
            // Write header
            let _ = wtr.write_record(&["iteration","parameters","mean_error","median_error","stddev_error","run_durations","histories_json"]);
            for (i, entry) in sweep_config.detailed_results.iter().enumerate() {
                let mean = entry.get("mean_error").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                let median = entry.get("median_error").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                let stddev = entry.get("stddev_error").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
                let params_json = entry.get("parameters").map(|v| v.to_string()).unwrap_or_default();
                let durations_json = entry.get("run_durations").map(|v| v.to_string()).unwrap_or_default();
                let histories_json = entry.get("histories").map(|v| v.to_string()).unwrap_or_default();
                let _ = wtr.write_record(&[i.to_string(), params_json, format!("{:.6}", mean), format!("{:.6}", median), format!("{:.6}", stddev), durations_json, histories_json]);
            }
            let _ = wtr.flush();
        }
        Err(_) => {
            // ignore
        }
    }

    (json_path_str, csv_path_str)
}
