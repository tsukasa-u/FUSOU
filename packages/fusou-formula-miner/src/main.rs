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
use solver::{crossover, mutate, Expr, GeneticConfig};
use smart_init::{DataStats, smart_init};
use state::{AppEvent, JobSummary, Phase, SolverState};
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

    // Spawn solver thread and pass shared config
    let solver_tx = tx.clone();
    let solver_shutdown = shutdown_flag.clone();
    let solver_config = shared_config.clone();
    thread::spawn(move || run_solver(worker_id, solver_tx, solver_shutdown, solver_config));

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
                }
                AppEvent::Online(is_online) => {
                    state.online = is_online;
                    let _ = tx.send(AppEvent::Log(format!("Mode: {}", if is_online { "Online" } else { "Offline" })));
                }
                AppEvent::Log(message) => push_log(&mut state, message),
                AppEvent::PhaseChange(phase) => {
                    state.phase = phase;
                }
                AppEvent::JobLoaded(summary) => {
                    state.job_id = summary.job_id;
                    state.chunk_id = summary.chunk_id;
                    state.sample_count = summary.sample_count;
                    state.selected_features = summary.feature_names;
                    state.max_generations = summary.max_generations;
                    state.target_error = summary.target_error;
                    state.correlation_threshold = summary.correlation_threshold;
                    state.target_formula = summary.ground_truth.clone();
                    state.generation = 0;
                    state.progress = 0.0;
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
    state.logs.push(message);
    if state.logs.len() > 200 {
        state.logs.drain(0..state.logs.len() - 200);
    }
    state.log_scroll_offset = 0;
}

fn run_solver(worker_id: Uuid, tx: Sender<AppEvent>, shutdown: Arc<AtomicBool>, shared_config: Arc<Mutex<GeneticConfig>>) {
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
        max_generations: job.max_generations,
        target_error: job.target_error,
        correlation_threshold: job.correlation_threshold,
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

    let (selected_indices, filter_logs) = job.dataset.filter_features(job.correlation_threshold);
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
            cfg.population_size, cfg.max_depth, job.max_generations
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
            attempt + 1, config.max_attempts, job.max_generations,
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

        let mut best_expr = if config.use_nsga2 {
            mo_population[0].expr.clone()
        } else {
            population[0].expr.clone()
        };
        let mut best_error = f64::MAX;
        let mut best_generation = 0u64;
        let mut last_emit = Instant::now();

        for generation in 0..=job.max_generations {
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
                }

                if best_error <= job.target_error {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Target RMSE {:.6} achieved at generation {}",
                        best_error, generation
                    )));
                    break;
                }

                if generation >= job.max_generations {
                    break;
                }

                // Constant optimization periodically
                if config.constant_optimization_interval > 0 
                    && generation % (config.constant_optimization_interval as u64) == 0 
                    && generation > 0 {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Optimizing constants at generation {}...", generation
                    )));
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

                if best_error <= job.target_error {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Target RMSE {:.6} achieved at generation {}",
                        best_error, generation
                    )));
                    break;
                }

                if generation >= job.max_generations {
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
