//! Main optimization loop for genetic algorithm-based formula mining
//!
//! This module contains the core solver logic that orchestrates population
//! initialization, evolution, and result reporting.

use anyhow::Result;
use rand::prelude::*;
use rayon::prelude::*;
use std::{
    cmp::Ordering,
    collections::HashSet,
    sync::mpsc::Sender,
    sync::{Arc, Mutex},
    sync::atomic::AtomicBool,
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

use crate::solver::{crossover, mutate, Expr, GeneticConfig};
use crate::solver::smart_init::{DataStats, smart_init};
use crate::state::{AppEvent, JobSummary, Phase, CandidateFormula};
use crate::solver::nsga2::{MultiObjectiveIndividual, nsga2_selection, nsga2_tournament_select};
use crate::solver::bloat_control::{tarpeian_penalty, hoist_mutation, average_size};
use crate::solver::const_opt_adaptive::optimize_constants_adaptive;
use crate::engine::solver_helpers::{
    evaluate_error_only, evaluate_error_only_with_penalty, count_ops_in_expr,
};
use crate::evaluation::evaluate;
use crate::engine::synthetic_data::synthetic_job_with_config;
use crate::engine::selection::{Individual, tournament_select};
use crate::network::{JobSubmission, WorkerClient};
use crate::config::MinerConfig;
use crate::clustering::per_cluster_ga;

#[cfg(feature = "clustering")]
use crate::clustering;

/// Main solver loop: fetch job, run genetic algorithm, submit results
pub fn run_solver(
    worker_id: Uuid,
    tx: Sender<AppEvent>,
    shutdown: Arc<AtomicBool>,
    shared_config: Arc<Mutex<GeneticConfig>>,
    miner_config: Arc<Mutex<MinerConfig>>,
    duplicate_tracker: Arc<Mutex<crate::engine::duplicate_detection::DuplicateTracker>>,
    max_generations: u64,
    target_error: f64,
    correlation_threshold: f64,
) {
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

    // Snapshot miner config so we can use the selected synthetic dataset type if needed
    let miner_cfg_snapshot = miner_config.lock().unwrap().clone();

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
                    synthetic_job_with_config(&miner_cfg_snapshot)
                }
                Err(err) => {
                    let _ = tx.send(AppEvent::Log(format!(
                        "Unable to fetch job: {err}. Using synthetic dataset instead."
                    )));
                    synthetic_job_with_config(&miner_cfg_snapshot)
                }
            }
        } else {
            synthetic_job_with_config(&miner_cfg_snapshot)
        }
    };

    // If this is a synthetic job, provide a human-readable ground-truth expression
    let ground_truth = if job.job_id.is_nil() {
        // Produce a dataset-type-specific human-readable target expression so the UI
        // reflects the selected synthetic dataset type (A/B/C).
        match miner_cfg_snapshot.synthetic_data.dataset_type.as_str() {
            "A" | "a" => Some("dmg = max(atk - def, 1.0) + noise".to_string()),
            "B" | "b" => Some(
                "dmg = (max(atk - def, 0.0) * (if luck > crit_luck_threshold then crit_multiplier else 1.0)) * map_effect + noise".to_string(),
            ),
            _ => Some(
                "dmg = max(atk - def, 0.0) * (1.0 + (luck/100)^1.5) * (1.0 + (timestamp/samples)^0.5 * 0.2) + map_bias + heteroscedastic_noise".to_string(),
            ),
        }
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

    // Run clustering ONCE before multi-attempt loop
    // Cache the result so it's available for all optimization attempts
    #[cfg(feature = "clustering")]
    let cached_cluster_assignment: Option<clustering::ClusterAssignment> = {
        let miner_cfg = miner_config.lock().unwrap();
        if let Ok(config_toml) = miner_cfg.get_clustering_config() {
            if config_toml.enabled.to_lowercase() == "enabled" {
                let clustering_config = clustering::ClusteringConfig {
                    method: config_toml.method.clone(),
                    max_depth: config_toml.max_depth,
                    min_samples_leaf: config_toml.min_samples_leaf,
                    // Use provided num_clusters (0 means auto);
                    num_clusters: config_toml.num_clusters,
                    max_k: config_toml.max_k,
                    silhouette_threshold: config_toml.silhouette_threshold,
                    n_trees: config_toml.n_trees,
                };
                
                let _ = tx.send(AppEvent::Log(format!("Running clustering with method: {}...", clustering_config.method)));
                
                // Prepare features for clustering
                let features: Vec<Vec<f64>> = data.iter().map(|(x, _)| x.clone()).collect();
                let targets: Vec<f64> = data.iter().map(|(_, y)| *y).collect();
                
                match clustering::auto_cluster(&features, &targets, &clustering_config) {
                    Ok(cluster_assignment) => {
                        let num_clusters = cluster_assignment.num_clusters;
                        let _ = tx.send(AppEvent::Log(format!(
                            "Clustering complete: {} clusters, method: {}, quality: {:.3}",
                            num_clusters,
                            cluster_assignment.metadata.method,
                            cluster_assignment.metadata.quality_score
                        )));
                        
                        // Convert assignments to JSON object (sample_index -> cluster_id)
                        let mut assignments_map = serde_json::Map::new();
                        for (sample_idx, cluster_id) in cluster_assignment.assignments.iter().enumerate() {
                            assignments_map.insert(sample_idx.to_string(), serde_json::json!(cluster_id));
                        }
                        let assignments_json = serde_json::Value::Object(assignments_map);
                        eprintln!("[DEBUG] Sending ClusteringResults event. Assignments: {} entries", cluster_assignment.assignments.len());
                        
                        // Send cluster assignments (not metadata) to UI
                        let _ = tx.send(AppEvent::ClusteringResults(Some(assignments_json)));
                        Some(cluster_assignment)
                    }
                    Err(err) => {
                        let _ = tx.send(AppEvent::Log(format!("Clustering failed: {}", err)));
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        }
    };
    
    #[cfg(not(feature = "clustering"))]
    let cached_cluster_assignment: Option<clustering::ClusterAssignment> = None;

    let start_time = Instant::now();

    // Check cluster_mode to decide if we should run per_cluster_ga
    #[cfg(feature = "clustering")]
    let use_per_cluster_ga = if cached_cluster_assignment.is_some() {
        if let Ok(miner_cfg) = miner_config.lock() {
            if let Ok(cluster_cfg) = miner_cfg.get_clustering_config() {
                cluster_cfg.cluster_mode == "per_cluster_ga"
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };
    
    #[cfg(not(feature = "clustering"))]
    let use_per_cluster_ga = false;

    // If per_cluster_ga mode is enabled, run per-cluster GA in parallel
    #[cfg(feature = "clustering")]
    if use_per_cluster_ga {
        if let Some(ref cluster_assignment) = cached_cluster_assignment {
            let config = shared_config.lock().unwrap().clone();
            let _ = per_cluster_ga::run_per_cluster_ga(
                cluster_assignment,
                &data,
                &var_names,
                num_vars,
                max_generations,
                &config,
                job.target_error,
                start_time,
                &tx,
                &duplicate_tracker,
                &shutdown,
            );
            return;
        }
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
                    let penalty = config.duplicate_penalty;
                    let error = evaluate_error_only_with_penalty(&expr, &data, &duplicate_tracker, penalty);
                    MultiObjectiveIndividual::new(expr, error)
                })
                .collect();
            // Register initial population in duplicate tracker so we avoid re-exploring them
            for ind in &mo_population {
                duplicate_tracker.lock().unwrap().register(&ind.expr);
            }
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
            // Register initial single-objective population in duplicate tracker
            for ind in &population {
                duplicate_tracker.lock().unwrap().register(&ind.expr);
            }
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
                let err_a = evaluate_error_only_with_penalty(&a.expr, &data, &duplicate_tracker, config.duplicate_penalty);
                let err_b = evaluate_error_only_with_penalty(&b.expr, &data, &duplicate_tracker, config.duplicate_penalty);
                err_a.partial_cmp(&err_b).unwrap_or(Ordering::Equal)
            }).unwrap();
            let best_err = evaluate_error_only_with_penalty(&best.expr, &data, &duplicate_tracker, config.duplicate_penalty);
            (best.expr.clone(), best_err)
        };
        let _ = tx.send(AppEvent::Log(format!(
            "Initial best RMSE: {:.6}",
            best_error
        )));
        // Send initial Update event so UI can display progress
        let _ = tx.send(AppEvent::Update(
            0,
            max_generations,
            best_error,
            best_expr.to_string(&var_names),
        ));
        let mut best_generation = 0u64;
        let mut last_emit = Instant::now();
        // Cumulative operator counts over the run (used to compute percentages)
        let mut cumulative_counts_map: std::collections::HashMap<&'static str, usize> = std::collections::HashMap::new();

        // Use shared duplicate tracker (passed into run_solver) to track seen expressions
        // local per-run tracker removed in favor of shared `duplicate_tracker`

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
                            max_generations,
                            best_error,
                            best_expr.to_string(&var_names),
                        ));
                    } else if last_emit.elapsed() >= Duration::from_millis(250) {
                        last_emit = Instant::now();
                        let _ = tx.send(AppEvent::Update(
                            generation,
                            max_generations,
                            best_error,
                            best_expr.to_string(&var_names),
                        ));
                    }
                    
                    // Update top candidates every generation (with constant optimization)
                    let mut top_n: Vec<(Expr, f64)> = mo_population
                        .iter()
                        .map(|ind| (ind.expr.clone(), ind.error))
                        .collect();
                    top_n.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal));

                    // Apply constant optimization and deduplicate structurally before displaying
                    let mut seen = HashSet::new();
                    let mut candidates: Vec<CandidateFormula> = Vec::new();
                    for (expr, _) in top_n.iter() {
                        let optimized_expr = {
                            let miner_cfg = miner_config.lock().unwrap();
                            optimize_constants_adaptive(expr, &data, &miner_cfg.const_opt)
                        };
                        let canonical = crate::engine::duplicate_detection::expr_to_canonical_string(&optimized_expr);
                        if !seen.insert(canonical) {
                            continue;
                        }
                        let optimized_error = evaluate(&optimized_expr, &data);
                        let rank = candidates.len() + 1;
                        candidates.push(CandidateFormula {
                            rank,
                            formula: optimized_expr.to_string(&var_names),
                            rmse: optimized_error,
                        });
                        if candidates.len() >= 20 {
                            break;
                        }
                    }
                    let _ = tx.send(AppEvent::TopCandidates(candidates));

                    // Compute operator counts from the top individuals (AST-based, accurate)
                    let mut counts_map: std::collections::HashMap<&'static str, usize> = std::collections::HashMap::new();
                    // Include leader (best) and top 5 individuals
                    if let Some(leader) = rank0.iter().min_by(|a, b| {
                        a.error.partial_cmp(&b.error).unwrap_or(Ordering::Equal)
                    }) {
                        count_ops_in_expr(&leader.expr, &mut counts_map);
                    }
                    for ind in mo_population.iter().take(20) {
                        count_ops_in_expr(&ind.expr, &mut counts_map);
                    }

                    // Accumulate into cumulative map (so percentages reflect all selections seen so far)
                    for (k, v) in counts_map.iter() {
                        *cumulative_counts_map.entry(k).or_insert(0) += *v;
                    }
                    // Convert cumulative map into stable-order Vec<(String, usize)>
                    let ordered = vec!["+","-","*","/","min","max","step","log","sqrt","exp","floor","identity","pow"];
                    let mut counts_vec: Vec<(String, usize)> = Vec::new();
                    for op in ordered {
                        let c = *cumulative_counts_map.get(op).unwrap_or(&0);
                        counts_vec.push((op.to_string(), c));
                    }
                    let _ = tx.send(AppEvent::OperatorStats(counts_vec));
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
                        // Use adaptive constant optimizer configured via miner_config
                        if let Ok(miner_cfg) = miner_config.lock() {
                            let optimized = optimize_constants_adaptive(&mo_population[i].expr, &data, &miner_cfg.const_opt);
                            let new_error = evaluate_error_only_with_penalty(&optimized, &data, &duplicate_tracker, config.duplicate_penalty);
                            if new_error < mo_population[i].error {
                                mo_population[i].expr = optimized;
                                mo_population[i].error = new_error;
                                mo_population[i].size = mo_population[i].expr.size();
                            }
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
                        crossover(&parent_a.expr, &parent_b.expr, &mut rng, &mut cumulative_counts_map)
                    } else {
                        parent_a.expr.clone()
                    };

                    // Apply mutations
                    if rng.gen_bool(config.mutation_rate) {
                        child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth, &mut cumulative_counts_map);
                    }
                    
                    // Hoist mutation for bloat control
                    if rng.gen_bool(config.hoist_mutation_rate) {
                        child_expr = hoist_mutation(&child_expr, &mut rng);
                    }

                    // Duplicate checking with limited retries to escape exact duplicates
                    let mut dup_attempts = 0usize;
                    while duplicate_tracker.lock().unwrap().is_duplicate(&child_expr) && dup_attempts < 3 {
                        child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth, &mut cumulative_counts_map);
                        dup_attempts += 1;
                    }

                    if duplicate_tracker.lock().unwrap().is_duplicate(&child_expr) {
                        // Still duplicate after retries: skip adding this child
                        continue;
                    }

                    let child_error = evaluate_error_only_with_penalty(&child_expr, &data, &duplicate_tracker, config.duplicate_penalty);
                    // Register seen expression so we avoid returning it again
                    duplicate_tracker.lock().unwrap().register(&child_expr);
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
                        let error = evaluate_error_only_with_penalty(&individual.expr, &data, &duplicate_tracker, config.duplicate_penalty);
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
                    let actual_error = evaluate_error_only_with_penalty(&leader.expr, &data, &duplicate_tracker, config.duplicate_penalty);
                    if actual_error.is_finite() && actual_error < best_error {
                        best_error = actual_error;
                        best_expr = leader.expr.clone();
                        best_generation = generation;
                        last_emit = Instant::now();
                        let _ = tx.send(AppEvent::Update(
                            generation,
                            max_generations,
                            best_error,
                            best_expr.to_string(&var_names),
                        ));
                    } else if last_emit.elapsed() >= Duration::from_millis(250) {
                        last_emit = Instant::now();
                        let _ = tx.send(AppEvent::Update(
                            generation,
                            max_generations,
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
                        crossover(&parent_a.expr, &parent_b.expr, &mut rng, &mut cumulative_counts_map)
                    } else {
                        parent_a.expr.clone()
                    };
                    
                    if rng.gen_bool(config.mutation_rate) {
                        child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth, &mut cumulative_counts_map);
                    }
                    
                    if rng.gen_bool(config.hoist_mutation_rate) {
                        child_expr = hoist_mutation(&child_expr, &mut rng);
                    }
                    
                    // Duplicate checking: try a few times to mutate away from exact duplicates
                    let mut dup_attempts = 0usize;
                    while duplicate_tracker.lock().unwrap().is_duplicate(&child_expr) && dup_attempts < 3 {
                        child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth, &mut cumulative_counts_map);
                        dup_attempts += 1;
                    }

                    if duplicate_tracker.lock().unwrap().is_duplicate(&child_expr) {
                        // Skip this child and continue generating
                        continue;
                    }

                    // Register and push
                    duplicate_tracker.lock().unwrap().register(&child_expr);
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

    // Per-cluster evaluation: if clustering is available and enabled, evaluate final expression on each cluster
    #[cfg(feature = "clustering")]
    if let Some(cluster_assignment) = &cached_cluster_assignment {
        let _ = tx.send(AppEvent::Log("=== Per-Cluster Evaluation ===".into()));
        let _ = tx.send(AppEvent::Log(format!(
            "Parallel eval across {} clusters using rayon (multi-threaded)",
            cluster_assignment.num_clusters
        )));
        
        // Parallel per-cluster evaluation using rayon
        let cluster_results: Vec<Option<(usize, String, usize, f64)>> = (0..cluster_assignment.num_clusters)
            .into_par_iter()
            .map(|cluster_id| {
                // Extract data for this cluster
                let cluster_data: Vec<(Vec<f64>, f64)> = data
                    .iter()
                    .zip(cluster_assignment.assignments.iter())
                    .filter(|(_, &assignment)| assignment == cluster_id)
                    .map(|((features, target), _)| (features.clone(), *target))
                    .collect();
                
                if cluster_data.is_empty() {
                    return None;
                }
                
                // Evaluate best expression on this cluster
                let cluster_error = evaluate_error_only(&global_best_expr, &cluster_data);
                let cluster_size = cluster_data.len();
                
                let cluster_label = cluster_assignment
                    .metadata
                    .cluster_conditions
                    .get(cluster_id)
                    .cloned()
                    .unwrap_or_else(|| format!("Cluster {}", cluster_id));
                
                Some((cluster_id, cluster_label, cluster_size, cluster_error))
            })
            .collect();
        
        // Process results and send to UI
        for result in cluster_results.iter().flatten() {
            let (cluster_id, cluster_label, cluster_size, cluster_error) = result;
            let log_msg_with_label = format!(
                "  Cluster {} ('{}'): {} samples, RMSE: {:.6}",
                cluster_id, cluster_label, cluster_size, cluster_error
            );
            let _ = tx.send(AppEvent::CurrentClusterInfo(log_msg_with_label.clone()));
            let _ = tx.send(AppEvent::Log(log_msg_with_label));
        }
        
        let _ = tx.send(AppEvent::Log("=== End Per-Cluster Evaluation ===".into()));
    }

    let duration_ms = start_time.elapsed().as_millis();
    let expression_text = global_best_expr.to_string(&var_names);
    let _ = tx.send(AppEvent::Log(format!(
        "Final result (Attempt {}): RMSE {:.6} at generation {} in {} ms",
        global_best_attempt, global_best_error, global_best_generation, duration_ms
    )));
    
    // Update UI with final best result
    let _ = tx.send(AppEvent::Update(
        global_best_generation,
        max_generations,
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
