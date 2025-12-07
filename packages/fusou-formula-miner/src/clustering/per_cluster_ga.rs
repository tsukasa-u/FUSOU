/// Per-cluster NSGA-II genetic algorithm implementation
/// Runs independent NSGA-II on each cluster in parallel using rayon
#[cfg(feature = "clustering")]
use crate::clustering::ClusterAssignment;
use crate::solver::nsga2::MultiObjectiveIndividual;
use crate::solver::Expr;
use crate::state::AppEvent;
use crate::engine::solver_helpers::count_ops_in_expr;
use rand::Rng;
use std::sync::mpsc::Sender;
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(feature = "clustering")]
pub fn run_per_cluster_ga(
    cluster_assignment: &ClusterAssignment,
    data: &[(Vec<f64>, f64)],
    var_names: &[&str],
    num_vars: usize,
    max_generations: u64,
    config: &crate::solver::GeneticConfig,
    job_target_error: f64,
    start_time: std::time::Instant,
    tx: &Sender<AppEvent>,
    duplicate_tracker: &Arc<Mutex<crate::engine::duplicate_detection::DuplicateTracker>>,
    shutdown: &Arc<std::sync::atomic::AtomicBool>,
) -> (Expr, f64) {
    let _ = tx.send(AppEvent::Log(
        "=== Starting Per-Cluster GA Mode (Parallel NSGA-II) ===".into(),
    ));
    let _ = tx.send(AppEvent::Log(format!(
        "Running NSGA-II independently on {} clusters using rayon parallelization",
        cluster_assignment.num_clusters
    )));

    // Calculate total work for progress tracking
    let num_clusters = cluster_assignment.num_clusters;
    let total_work = (num_clusters as u64) * max_generations;

    // Shared state for tracking progress across parallel clusters
    let total_generations_completed = Arc::new(AtomicU64::new(0));
    let global_best_error_atomic = Arc::new(Mutex::new(f64::MAX));
    let global_best_expr_atomic = Arc::new(Mutex::new(Expr::Const(0.0)));
    
    // Cumulative operator counts across all clusters
    let cumulative_operator_counts: Arc<Mutex<HashMap<&'static str, usize>>> = Arc::new(Mutex::new(HashMap::new()));
    
    // Run per-cluster GA in parallel
    let cluster_results: Vec<Option<(usize, String, Expr, f64, u64)>> =
        (0..cluster_assignment.num_clusters)
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

                // Get cluster label from metadata
                let cluster_label = cluster_assignment
                    .metadata
                    .cluster_conditions
                    .get(cluster_id)
                    .cloned()
                    .unwrap_or_else(|| format!("Cluster {}", cluster_id));

                // Announce current cluster start so UI shows which cluster is being processed
                let _ = tx.send(AppEvent::CurrentClusterInfo(format!(
                    "Starting Cluster {} ('{}')",
                    cluster_id, cluster_label
                )));

                // Run NSGA-II on this cluster independently (removed .min(50) limit!)
                let (best_expr, best_error, best_generation) =
                    run_nsga2_on_cluster(
                        cluster_id,
                        &cluster_label,
                        &cluster_data,
                        num_vars,
                        max_generations,
                        config,
                        job_target_error,
                        tx,
                        &total_generations_completed,
                        &global_best_error_atomic,
                        &global_best_expr_atomic,
                        var_names,
                        duplicate_tracker,
                        shutdown,
                        total_work,
                        &cumulative_operator_counts,
                    );

                Some((cluster_id, cluster_label, best_expr, best_error, best_generation))
            })
            .collect();

    // Process results and find global best
    let mut global_best_expr = Expr::Const(0.0);
    let mut global_best_error = f64::MAX;
    let mut max_generation_seen = 0u64;

    for result in cluster_results.iter().flatten() {
        let (cluster_id, cluster_label, best_expr, best_error, best_generation) = result;
        let _ = tx.send(AppEvent::Log(format!(
            "Cluster {} ('{}'): RMSE {:.6} at generation {}",
            cluster_id, cluster_label, best_error, best_generation
        )));
        let _ = tx.send(AppEvent::CurrentClusterInfo(format!(
            "Cluster {} ('{}'): RMSE {:.6}",
            cluster_id, cluster_label, best_error
        )));

        // Also publish final per-cluster best so UI can display it independently
        let cluster_label_short = format!("C{}", cluster_id);
        let _ = tx.send(AppEvent::PerClusterBest(cluster_label_short.clone(), *best_error, best_expr.to_string(var_names), *best_generation));

        if *best_error < global_best_error {
            global_best_error = *best_error;
            global_best_expr = best_expr.clone();
        }
        
        // Track max generation across all clusters for progress reporting
        if *best_generation > max_generation_seen {
            max_generation_seen = *best_generation;
        }
    }

    let duration_ms = start_time.elapsed().as_millis();
    let expression_text = global_best_expr.to_string(var_names);
    let _ = tx.send(AppEvent::Log(format!(
        "Per-Cluster GA Complete: Best RMSE {:.6} in {} ms",
        global_best_error, duration_ms
    )));
    let _ = tx.send(AppEvent::Log("=== Per-Cluster GA Finished ===".into()));
    let _ = tx.send(AppEvent::PhaseChange(crate::state::Phase::Finished));

    // Update UI with final result - use total work completed
    let completed_total = total_generations_completed.load(Ordering::Relaxed).min(total_work);
    let _ = tx.send(AppEvent::Update(completed_total, total_work, global_best_error, expression_text));

    // Clear current cluster info and signal finished to event loop
    let _ = tx.send(AppEvent::CurrentClusterInfo("Idle".into()));
    let _ = tx.send(AppEvent::Finished);

    (global_best_expr, global_best_error)
}

/// Run NSGA-II on a single cluster
fn run_nsga2_on_cluster(
    cluster_id: usize,
    cluster_label: &str,
    cluster_data: &[(Vec<f64>, f64)],
    num_vars: usize,
    max_generations: u64,
    config: &crate::solver::GeneticConfig,
    job_target_error: f64,
    tx: &Sender<AppEvent>,
    total_generations: &Arc<AtomicU64>,
    global_best_error: &Arc<Mutex<f64>>,
    global_best_expr: &Arc<Mutex<Expr>>,
    var_names: &[&str],
    duplicate_tracker: &Arc<Mutex<crate::engine::duplicate_detection::DuplicateTracker>>,
    shutdown: &Arc<std::sync::atomic::AtomicBool>,
    total_work: u64,
    cumulative_operator_counts: &Arc<Mutex<HashMap<&'static str, usize>>>,
) -> (Expr, f64, u64) {
    use crate::solver::random_expr;
    use crate::solver::nsga2::nsga2_selection;
    use std::time::{Duration, Instant};

    let mut best_expr = Expr::Const(0.0);
    let mut best_error = f64::MAX;
    let mut best_generation = 0u64;
    let mut last_ui_update = Instant::now();

    let mut rng = rand::thread_rng();
    let mut cumulative_counts = HashMap::new();

    // Create initial population
    let mut mo_population: Vec<MultiObjectiveIndividual> = (0..config.population_size)
        .map(|_| {
            let expr = random_expr(&mut rng, config.max_depth, num_vars, &mut cumulative_counts);
            // Apply duplicate penalty during evaluation
            let error = crate::engine::solver_helpers::evaluate_error_only_with_penalty(
                &expr, 
                cluster_data, 
                duplicate_tracker, 
                config.duplicate_penalty
            );
            MultiObjectiveIndividual::new(expr, error)
        })
        .collect();

    // Run NSGA-II generations
    for generation in 0..max_generations {
        // Check shutdown flag
        if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        
        // Perform NSGA-II selection and sorting
        nsga2_selection(&mut mo_population);

        // Track best rank-0 individual
        for ind in mo_population.iter().filter(|ind| ind.rank == 0) {
            if ind.error < best_error {
                best_error = ind.error;
                best_expr = ind.expr.clone();
                best_generation = generation;
                
                // Register this expression in duplicate tracker
                if let Ok(mut tracker) = duplicate_tracker.lock() {
                    tracker.register(&best_expr);
                }
                
                // Update global best
                if let Ok(mut global_err) = global_best_error.lock() {
                    if best_error < *global_err {
                        *global_err = best_error;
                        if let Ok(mut global_expr) = global_best_expr.lock() {
                            *global_expr = best_expr.clone();
                        }
                    }
                }
            }
        }
        
        // Track overall generation count across all parallel clusters
        let completed = total_generations.fetch_add(1, Ordering::Relaxed) + 1;
        // Calculate UI progress based on total work (num_clusters × max_generations)
        
        // Send periodic UI updates (every 250ms)
        if last_ui_update.elapsed() >= Duration::from_millis(250) {
            last_ui_update = Instant::now();
            
            let current_best_error = global_best_error.lock().ok().map(|e| *e).unwrap_or(best_error);
            let current_best_expr = global_best_expr.lock().ok()
                .map(|e| e.to_string(var_names))
                .unwrap_or_else(|| best_expr.to_string(var_names));
            
            let _ = tx.send(AppEvent::CurrentClusterInfo(format!(
                "Cluster {} ('{}'): generation {}",
                cluster_id,
                cluster_label,
                generation + 1
            )));
            let _ = tx.send(AppEvent::Update(completed, total_work, current_best_error, current_best_expr.clone()));
            
            // Send top candidates (without filtering duplicates - show actual population state)
            let mut top_n: Vec<_> = mo_population.iter()
                .map(|ind| (ind.expr.clone(), ind.error))
                .collect();
            top_n.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            
            use crate::state::CandidateFormula;
            let candidates: Vec<CandidateFormula> = top_n.iter().take(20).enumerate()
                .map(|(rank, (expr, error))| CandidateFormula {
                    rank: rank + 1,
                    formula: expr.to_string(var_names),
                    rmse: *error,
                })
                .collect();
            let _ = tx.send(AppEvent::TopCandidates(candidates));
            
            // Compute and accumulate operator counts
            let mut local_counts: HashMap<&'static str, usize> = HashMap::new();
            // Count operators from top 5 candidates
            for (expr, _) in top_n.iter().take(20) {
                count_ops_in_expr(expr, &mut local_counts);
            }
            
            // Accumulate into cumulative map
            if let Ok(mut cumulative) = cumulative_operator_counts.lock() {
                for (op, count) in local_counts.iter() {
                    *cumulative.entry(op).or_insert(0) += *count;
                }
                
                // Send cumulative operator stats
                let ordered = vec!["+", "-", "*", "/", "min", "max", "step", "log", "sqrt", "exp", "floor", "identity", "pow"];
                let mut counts_vec: Vec<(String, usize)> = Vec::new();
                for op in ordered {
                    let c = *cumulative.get(op).unwrap_or(&0);
                    counts_vec.push((op.to_string(), c));
                }
                let _ = tx.send(AppEvent::OperatorStats(counts_vec));
            }

            // Publish per-cluster best so UI can maintain cluster-specific best formulas
            let cluster_best_text = best_expr.to_string(var_names);
            let cluster_label_short = format!("C{}", cluster_id);
            let _ = tx.send(AppEvent::PerClusterBest(cluster_label_short.clone(), best_error, cluster_best_text, generation));
        }

        if best_error <= job_target_error || generation >= max_generations - 1 {
            break;
        }

        // Selection and crossover
        let mut next_population = Vec::new();

        // Elitism: keep rank 0 individuals
        for ind in mo_population
            .iter()
            .filter(|ind| ind.rank == 0)
            .take(config.elite_count)
        {
            next_population.push(ind.clone());
        }

        // Generate offspring
        use crate::solver::{crossover, mutate};
        let mut cumulative_counts_local = HashMap::new();
        while next_population.len() < config.population_size {
            let parent_a = select_nsga2_tournament(&mo_population, config.tournament_size, &mut rng);
            let parent_b = select_nsga2_tournament(&mo_population, config.tournament_size, &mut rng);

            let mut child_expr = if rng.gen_bool(config.crossover_rate) {
                crossover(
                    &parent_a.expr,
                    &parent_b.expr,
                    &mut rng,
                    &mut cumulative_counts_local,
                )
            } else {
                parent_a.expr.clone()
            };

            if rng.gen_bool(config.mutation_rate) {
                child_expr = mutate(
                    &child_expr,
                    &mut rng,
                    num_vars,
                    config.max_depth,
                    &mut cumulative_counts_local,
                );
            }

            // Apply duplicate penalty during offspring evaluation
            let error = crate::engine::solver_helpers::evaluate_error_only_with_penalty(
                &child_expr,
                cluster_data,
                duplicate_tracker,
                config.duplicate_penalty
            );
            next_population.push(MultiObjectiveIndividual::new(child_expr, error));
        }

        mo_population = next_population
            .into_iter()
            .take(config.population_size)
            .collect();
    }

    (best_expr, best_error, best_generation)
}

/// NSGA-II tournament selection for per-cluster GA
fn select_nsga2_tournament<'a, R: Rng + ?Sized>(
    population: &'a [MultiObjectiveIndividual],
    tournament_size: usize,
    rng: &mut R,
) -> &'a MultiObjectiveIndividual {
    let mut best = &population[rng.gen_range(0..population.len())];
    for _ in 1..tournament_size {
        let idx = rng.gen_range(0..population.len());
        let candidate = &population[idx];
        if candidate.rank < best.rank
            || (candidate.rank == best.rank && candidate.crowding_distance > best.crowding_distance)
        {
            best = candidate;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use crate::solver::nsga2::MultiObjectiveIndividual;
    use crate::solver::Expr;
    use std::collections::HashMap;

    #[test]
    #[cfg(feature = "clustering")]
    fn test_run_nsga2_on_cluster_basic() {
        use std::sync::mpsc;
        use std::sync::{Arc, Mutex};
        use std::sync::atomic::AtomicU64;
        
        // Create simple test data
        let cluster_data = vec![
            (vec![1.0, 2.0], 3.0),
            (vec![2.0, 3.0], 5.0),
            (vec![3.0, 4.0], 7.0),
        ];

        let mut config = crate::solver::GeneticConfig::default();
        config.population_size = 10;
        config.tournament_size = 2;
        config.elite_count = 2;
        config.mutation_rate = 0.5;
        config.crossover_rate = 0.8;
        config.max_depth = 4;

        let (tx, _rx) = mpsc::channel();
        let total_gen = Arc::new(AtomicU64::new(0));
        let global_error = Arc::new(Mutex::new(f64::MAX));
        let global_expr = Arc::new(Mutex::new(crate::solver::Expr::Const(0.0)));
        let var_names = vec!["x", "y"];
        let dup_tracker = Arc::new(Mutex::new(crate::engine::duplicate_detection::DuplicateTracker::default()));
        let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let total_work = 2 * 5; // 2 clusters × 5 generations
        let cumulative_counts = Arc::new(Mutex::new(HashMap::new()));

        let (_, best_error, best_generation) =
            super::run_nsga2_on_cluster(0, "Cluster 0", &cluster_data, 2, 5, &config, 0.1, &tx, &total_gen, &global_error, &global_expr, &var_names, &dup_tracker, &shutdown, total_work, &cumulative_counts);

        // Verify that we got valid results
        assert!(best_error.is_finite());
        assert!(best_error >= 0.0);
        assert!(best_generation < 5);
    }

    #[test]
    fn test_select_nsga2_tournament_selects_lower_rank() {
        let mut population = vec![];

        // Create individuals with different ranks
        let ind_rank0 = MultiObjectiveIndividual {
            expr: Expr::Const(1.0),
            error: 0.5,
            size: 1,
            rank: 0,
            crowding_distance: 1.0,
        };
        let ind_rank1 = MultiObjectiveIndividual {
            expr: Expr::Const(2.0),
            error: 1.0,
            size: 1,
            rank: 1,
            crowding_distance: 1.0,
        };
        let ind_rank2 = MultiObjectiveIndividual {
            expr: Expr::Const(3.0),
            error: 2.0,
            size: 1,
            rank: 2,
            crowding_distance: 1.0,
        };

        population.push(ind_rank0);
        population.push(ind_rank1);
        population.push(ind_rank2);

        let mut rng = rand::thread_rng();
        
        // Run tournament multiple times - should tend to select rank 0
        let mut rank0_count = 0;
        for _ in 0..100 {
            let selected = super::select_nsga2_tournament(&population, 3, &mut rng);
            if selected.rank == 0 {
                rank0_count += 1;
            }
        }

        // Statistically, rank 0 should be selected more often than lower ranks
        assert!(rank0_count > 30);
    }

    #[test]
    fn test_select_nsga2_tournament_same_rank_uses_crowding_distance() {
        let mut population = vec![];

        // Create individuals with same rank but different crowding distances
        let ind_close = MultiObjectiveIndividual {
            expr: Expr::Const(1.0),
            error: 0.5,
            size: 1,
            rank: 0,
            crowding_distance: 0.5,
        };
        let ind_far = MultiObjectiveIndividual {
            expr: Expr::Const(2.0),
            error: 1.0,
            size: 1,
            rank: 0,
            crowding_distance: 10.0,
        };

        population.push(ind_close);
        population.push(ind_far);

        let mut rng = rand::thread_rng();
        
        // Tournament should tend to select ind_far due to higher crowding distance
        let mut far_count = 0;
        for _ in 0..100 {
            let selected = super::select_nsga2_tournament(&population, 2, &mut rng);
            if selected.crowding_distance > 5.0 {
                far_count += 1;
            }
        }

        // Should select far individual more often due to crowding distance
        assert!(far_count > 30);
    }

    #[test]
    fn test_select_nsga2_tournament_single_individual() {
        let ind = MultiObjectiveIndividual {
            expr: Expr::Const(1.0),
            error: 0.5,
            size: 1,
            rank: 0,
            crowding_distance: 1.0,
        };
        let population = vec![ind];
        let mut rng = rand::thread_rng();

        let selected = super::select_nsga2_tournament(&population, 2, &mut rng);
        assert_eq!(selected.error, 0.5);
        assert_eq!(selected.rank, 0);
    }
}
