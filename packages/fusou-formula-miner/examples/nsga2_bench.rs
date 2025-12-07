/// Benchmarks for NSGA-II operations (sorting and ranking)
use formula_miner::solver::Expr;
use formula_miner::solver::nsga2::{MultiObjectiveIndividual, non_dominated_sort};

fn main() {
    println!("=== NSGA-II Operations Benchmarks ===\n");

    bench_non_dominated_sort_small();
    bench_non_dominated_sort_medium();
    bench_non_dominated_sort_large();
    bench_crowding_distance_calculation();
}

fn bench_non_dominated_sort_small() {
    const POP_SIZE: usize = 50;
    let population = create_test_population(POP_SIZE);

    let start = std::time::Instant::now();
    let iterations = 1000;
    for _ in 0..iterations {
        let _ = non_dominated_sort(&population);
    }
    let elapsed = start.elapsed();

    println!(
        "non_dominated_sort(population_size={}): {:.2}ms for {} iterations",
        POP_SIZE,
        elapsed.as_secs_f64() * 1000.0,
        iterations
    );
    println!(
        "  Average per call: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}

fn bench_non_dominated_sort_medium() {
    const POP_SIZE: usize = 200;
    let population = create_test_population(POP_SIZE);

    let start = std::time::Instant::now();
    let iterations = 100;
    for _ in 0..iterations {
        let _ = non_dominated_sort(&population);
    }
    let elapsed = start.elapsed();

    println!(
        "non_dominated_sort(population_size={}): {:.2}ms for {} iterations",
        POP_SIZE,
        elapsed.as_secs_f64() * 1000.0,
        iterations
    );
    println!(
        "  Average per call: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}

fn bench_non_dominated_sort_large() {
    const POP_SIZE: usize = 500;
    let population = create_test_population(POP_SIZE);

    let start = std::time::Instant::now();
    let iterations = 10;
    for _ in 0..iterations {
        let _ = non_dominated_sort(&population);
    }
    let elapsed = start.elapsed();

    println!(
        "non_dominated_sort(population_size={}): {:.2}ms for {} iterations",
        POP_SIZE,
        elapsed.as_secs_f64() * 1000.0,
        iterations
    );
    println!(
        "  Average per call: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}

fn bench_crowding_distance_calculation() {
    // Simulate crowding distance calculation on sorted fronts
    const POP_SIZE: usize = 200;
    let population = create_test_population(POP_SIZE);
    let fronts = non_dominated_sort(&population);

    let start = std::time::Instant::now();
    let iterations = 100;
    for _ in 0..iterations {
        for front in &fronts {
            // Simulate crowding distance calculation
            for &i in front.iter() {
                // Simple distance approximation
                let _dist = (population[i].error + population[i].size as f64) / 2.0;
            }
        }
    }
    let elapsed = start.elapsed();

    println!(
        "crowding_distance(population_size={}, fronts={}): {:.2}ms for {} iterations",
        POP_SIZE,
        fronts.len(),
        elapsed.as_secs_f64() * 1000.0,
        iterations
    );
    println!(
        "  Average per call: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}

fn create_test_population(size: usize) -> Vec<MultiObjectiveIndividual> {
    let mut rng = rand::thread_rng();
    use rand::Rng;

    (0..size)
        .map(|_| {
            let error = rng.gen_range(0.0..10.0);
            let size_val = rng.gen_range(1..100);
            MultiObjectiveIndividual {
                expr: Expr::Const(0.0),
                error,
                size: size_val,
                rank: 0,
                crowding_distance: 0.0,
            }
        })
        .collect()
}
