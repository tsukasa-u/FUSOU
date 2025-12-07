use anyhow::Result;
use rand::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering as AtomicOrdering},
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

use formula_miner::{
    engine::dataset::synthetic_dataset,
    network::{RemoteJob, WorkerClient},
    solver::{crossover, mutate, random_expr, Expr, GeneticConfig},
    engine::statistics,
};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkerResult {
    pub worker_id: String,
    pub job_id: String,
    pub expression: String,
    pub error: f64,
    pub generation: u64,
    pub features: Vec<String>,
    pub duration_ms: u128,
    pub timestamp: String,
}

#[derive(Clone)]
struct Individual {
    expr: Expr,
    fitness: f64,
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    
    let worker_id = if args.len() > 1 {
        Uuid::parse_str(&args[1]).unwrap_or_else(|_| Uuid::new_v4())
    } else {
        Uuid::new_v4()
    };

    let results_dir = if args.len() > 2 {
        PathBuf::from(&args[2])
    } else {
        PathBuf::from("./worker_results")
    };

    fs::create_dir_all(&results_dir)?;

    eprintln!("[Worker {}] Started", worker_id);
    eprintln!("[Worker {}] Results directory: {}", worker_id, results_dir.display());

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    
    ctrlc::set_handler(move || {
        eprintln!("\n[Worker] SIGINT received - initiating graceful shutdown");
        shutdown_clone.store(true, AtomicOrdering::SeqCst);
    })
    .expect("Error setting SIGINT handler");

    run_solver(worker_id, &results_dir, &shutdown)?;

    eprintln!("[Worker {}] Shutdown complete", worker_id);
    Ok(())
}

fn run_solver(worker_id: Uuid, results_dir: &PathBuf, shutdown: &Arc<AtomicBool>) -> Result<()> {
    let mut rng = rand::thread_rng();

    let mut job = fetch_or_synthetic_job(&worker_id);

    if job.dataset.is_empty() {
        eprintln!("[Worker {}] ERROR: Dataset is empty", worker_id);
        return Err(anyhow::anyhow!("Empty dataset"));
    }

    // Preprocessing
    eprintln!("[Worker {}] Starting feature selection...", worker_id);
    let (selected_indices, _) = job.dataset.filter_features(job.correlation_threshold);
    let filtered_dataset = job.dataset.apply_selection(&selected_indices);
    eprintln!(
        "[Worker {}] Feature selection: {} -> {} columns",
        worker_id,
        job.dataset.feature_names.len(),
        filtered_dataset.feature_names.len()
    );
    job.dataset = filtered_dataset;

    let data = job.dataset.to_pairs();
    let var_names = job.dataset.feature_names_as_str();
    let num_vars = var_names.len();

    if num_vars == 0 {
        eprintln!("[Worker {}] ERROR: No usable features", worker_id);
        return Err(anyhow::anyhow!("No usable features"));
    }

    // Configure genetic algorithm
    let mut config = GeneticConfig::default();
    config.max_depth = (num_vars + 2).min(8);
    config.population_size = (num_vars.max(1) * 24).clamp(48, 256);
    config.elite_count = (config.population_size / 8).max(2);
    config.tournament_size = config.population_size.min(6).max(2);
    config.mutation_rate = (0.15 + (1.0 / num_vars as f64)).min(0.4);
    config.crossover_rate = 0.85;

    eprintln!(
        "[Worker {}] Solver configuration => population: {}, max_depth: {}, max_generations: {}",
        worker_id, config.population_size, config.max_depth, job.max_generations
    );

    let start_time = Instant::now();
    let mut population: Vec<Individual> = (0..config.population_size)
        .map(|_| {
            let mut counts = std::collections::HashMap::new();
            Individual {
                expr: random_expr(&mut rng, config.max_depth, num_vars, &mut counts),
                fitness: f64::MAX,
            }
        })
        .collect();

    let mut best_expr = population[0].expr.clone();
    let mut best_error = f64::MAX;
    let mut best_generation = 0u64;
    let mut last_log = Instant::now();

    for generation in 0..=job.max_generations {
        // Check for shutdown signal
        if shutdown.load(AtomicOrdering::SeqCst) {
            eprintln!(
                "[Worker {}] Shutdown signal received at generation {}",
                worker_id, generation
            );
            eprintln!(
                "[Worker {}] Best so far: RMSE {:.6} at generation {}",
                worker_id, best_error, best_generation
            );
            break;
        }

        // Evaluate population
        for individual in &mut population {
            if !individual.fitness.is_finite() || individual.fitness == f64::MAX {
                individual.fitness = evaluate(&individual.expr, &data);
            }
        }

        // Sort by fitness
        population.sort_by(|a, b| match a.fitness.partial_cmp(&b.fitness) {
            Some(ordering) => ordering,
            None => Ordering::Equal,
        });

        // Update best
        if let Some(leader) = population.first() {
            if leader.fitness.is_finite() && leader.fitness < best_error {
                best_error = leader.fitness;
                best_expr = leader.expr.clone();
                best_generation = generation;
            }
        }

        // Periodic logging
        if last_log.elapsed() >= Duration::from_millis(1000) {
            eprintln!(
                "[Worker {}] Generation {}/{} - Best RMSE: {:.6}",
                worker_id, generation, job.max_generations, best_error
            );
            last_log = Instant::now();
        }

        // Check target reached
        if best_error <= job.target_error {
            eprintln!(
                "[Worker {}] Target RMSE {:.6} achieved at generation {}",
                worker_id, best_error, generation
            );
            break;
        }

        // Create next generation
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
            let mut counts = std::collections::HashMap::new();
            if rng.gen_bool(config.crossover_rate) {
                let parent_b = tournament_select(&population, config.tournament_size, &mut rng);
                let mut child_expr = crossover(&parent_a.expr, &parent_b.expr, &mut rng, &mut counts);
                if rng.gen_bool(config.mutation_rate) {
                    child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth, &mut counts);
                }
                next_population.push(Individual {
                    expr: child_expr,
                    fitness: f64::MAX,
                });
            } else {
                let mut child_expr = parent_a.expr.clone();
                child_expr = mutate(&child_expr, &mut rng, num_vars, config.max_depth, &mut counts);
                next_population.push(Individual {
                    expr: child_expr,
                    fitness: f64::MAX,
                });
            }
        }

        population = next_population;
    }

    let duration_ms = start_time.elapsed().as_millis();
    let expression_text = best_expr.to_string(&var_names);

    eprintln!(
        "[Worker {}] Finished: Best RMSE {:.6} at generation {} in {} ms",
        worker_id, best_error, best_generation, duration_ms
    );

    // Save final result
    let result_data = WorkerResult {
        worker_id: worker_id.to_string(),
        job_id: job.job_id.to_string(),
        expression: expression_text,
        error: best_error,
        generation: best_generation,
        features: job.dataset.feature_names,
        duration_ms,
        timestamp: chrono::Local::now().to_rfc3339(),
    };

    fs::write(
        results_dir.join("result.json"),
        serde_json::to_string_pretty(&result_data)?,
    )?;

    eprintln!("[Worker {}] Result saved to result.json", worker_id);

    Ok(())
}

fn fetch_or_synthetic_job(worker_id: &Uuid) -> RemoteJob {
    match WorkerClient::new_from_env() {
        Ok(client) => {
            eprintln!("[Worker {}] Connected to server", worker_id);
            match client.fetch_job() {
                Ok(Some(job)) => {
                    eprintln!("[Worker {}] Fetched job {}", worker_id, job.job_id);
                    job
                }
                Ok(None) => {
                    eprintln!("[Worker {}] No job available; using synthetic dataset", worker_id);
                    synthetic_job()
                }
                Err(err) => {
                    eprintln!(
                        "[Worker {}] Failed to fetch job: {}. Using synthetic dataset.",
                        worker_id, err
                    );
                    synthetic_job()
                }
            }
        }
        Err(err) => {
            eprintln!(
                "[Worker {}] Failed to connect: {}. Using synthetic dataset.",
                worker_id, err
            );
            synthetic_job()
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
    statistics::rmse(sum_sq, data.len())
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
