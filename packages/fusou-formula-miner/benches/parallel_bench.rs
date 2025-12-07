/// Benchmarks for parallelization effectiveness (rayon parallelization)
use formula_miner::solver::Expr;
use std::time::Instant;

fn main() {
    println!("=== Parallelization Effectiveness Benchmarks ===\n");

    bench_sequential_evaluation();
    bench_parallel_evaluation();
    compare_sequential_vs_parallel();
}

fn bench_sequential_evaluation() {
    const NUM_TASKS: usize = 1000;
    let data_size = 100;
    let data: Vec<(Vec<f64>, f64)> = (0..data_size)
        .map(|i| (vec![i as f64], i as f64 * 2.0))
        .collect();

    let expressions: Vec<Expr> = (0..NUM_TASKS)
        .map(|i| {
            if i % 3 == 0 {
                Expr::Binary {
                    op: formula_miner::solver::BinaryOp::Add,
                    left: Box::new(Expr::Var(0)),
                    right: Box::new(Expr::Const(i as f64)),
                }
            } else if i % 3 == 1 {
                Expr::Binary {
                    op: formula_miner::solver::BinaryOp::Mul,
                    left: Box::new(Expr::Var(0)),
                    right: Box::new(Expr::Const(2.0)),
                }
            } else {
                Expr::Unary {
                    op: formula_miner::solver::UnaryOp::Floor,
                    child: Box::new(Expr::Var(0)),
                }
            }
        })
        .collect();

    let start = Instant::now();
    for expr in &expressions {
        let _ = formula_miner::engine::solver_helpers::evaluate_error_only(expr, &data);
    }
    let elapsed = start.elapsed();

    println!(
        "Sequential evaluation ({} expressions): {:.2}ms",
        NUM_TASKS,
        elapsed.as_secs_f64() * 1000.0
    );
    println!(
        "  Average per expression: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / NUM_TASKS as f64
    );
}

fn bench_parallel_evaluation() {
    const NUM_TASKS: usize = 1000;
    let data_size = 100;
    let data: Vec<(Vec<f64>, f64)> = (0..data_size)
        .map(|i| (vec![i as f64], i as f64 * 2.0))
        .collect();

    let expressions: Vec<Expr> = (0..NUM_TASKS)
        .map(|i| {
            if i % 3 == 0 {
                Expr::Binary {
                    op: formula_miner::solver::BinaryOp::Add,
                    left: Box::new(Expr::Var(0)),
                    right: Box::new(Expr::Const(i as f64)),
                }
            } else if i % 3 == 1 {
                Expr::Binary {
                    op: formula_miner::solver::BinaryOp::Mul,
                    left: Box::new(Expr::Var(0)),
                    right: Box::new(Expr::Const(2.0)),
                }
            } else {
                Expr::Unary {
                    op: formula_miner::solver::UnaryOp::Floor,
                    child: Box::new(Expr::Var(0)),
                }
            }
        })
        .collect();

    let start = Instant::now();
    use rayon::prelude::*;
    let _results: Vec<f64> = expressions
        .par_iter()
        .map(|expr| formula_miner::engine::solver_helpers::evaluate_error_only(expr, &data))
        .collect();
    let elapsed = start.elapsed();

    println!(
        "Parallel evaluation ({} expressions, rayon): {:.2}ms",
        NUM_TASKS,
        elapsed.as_secs_f64() * 1000.0
    );
    println!(
        "  Average per expression: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / NUM_TASKS as f64
    );
}

fn compare_sequential_vs_parallel() {
    println!("Speedup Analysis for Different Task Counts:\n");

    for num_tasks in [100, 500, 1000, 5000].iter() {
        let data_size = 100;
        let data: Vec<(Vec<f64>, f64)> = (0..data_size)
            .map(|i| (vec![i as f64], i as f64 * 2.0))
            .collect();

        let expressions: Vec<Expr> = (0..*num_tasks)
            .map(|i| {
                if i % 3 == 0 {
                    Expr::Binary {
                        op: formula_miner::solver::BinaryOp::Add,
                        left: Box::new(Expr::Var(0)),
                        right: Box::new(Expr::Const(i as f64)),
                    }
                } else if i % 3 == 1 {
                    Expr::Binary {
                        op: formula_miner::solver::BinaryOp::Mul,
                        left: Box::new(Expr::Var(0)),
                        right: Box::new(Expr::Const(2.0)),
                    }
                } else {
                    Expr::Unary {
                        op: formula_miner::solver::UnaryOp::Floor,
                        child: Box::new(Expr::Var(0)),
                    }
                }
            })
            .collect();

        // Sequential
        let start = Instant::now();
        for expr in &expressions {
            let _ = formula_miner::engine::solver_helpers::evaluate_error_only(expr, &data);
        }
        let sequential_ms = start.elapsed().as_secs_f64() * 1000.0;

        // Parallel
        let start = Instant::now();
        use rayon::prelude::*;
        let _results: Vec<f64> = expressions
            .par_iter()
            .map(|expr| formula_miner::engine::solver_helpers::evaluate_error_only(expr, &data))
            .collect();
        let parallel_ms = start.elapsed().as_secs_f64() * 1000.0;

        let speedup = sequential_ms / parallel_ms;
        println!(
            "Tasks={}: Sequential={:.2}ms, Parallel={:.2}ms, Speedup={:.2}x",
            num_tasks, sequential_ms, parallel_ms, speedup
        );
    }
    println!();
}
