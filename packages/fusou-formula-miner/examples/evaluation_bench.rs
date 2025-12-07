/// Benchmarks for evaluation functions in solver_helpers
use formula_miner::solver::Expr;
use formula_miner::engine::solver_helpers;

fn main() {
    println!("=== Evaluation Function Benchmarks ===\n");

    bench_evaluate_error_only_constant();
    bench_evaluate_error_only_variable();
    bench_evaluate_error_only_scaled_data();
    bench_evaluate_error_only_complex_expr();
}

fn bench_evaluate_error_only_constant() {
    const DATASET_SIZE: usize = 100;
    let expr = Expr::Const(5.0);
    let data: Vec<(Vec<f64>, f64)> = (0..DATASET_SIZE)
        .map(|i| (vec![i as f64], i as f64 * 2.0))
        .collect();

    let start = std::time::Instant::now();
    let iterations = 10000;
    for _ in 0..iterations {
        let _ = solver_helpers::evaluate_error_only(&expr, &data);
    }
    let elapsed = start.elapsed();

    println!(
        "evaluate_error_only(constant expression, {} samples): {:.2}ms for {} iterations",
        DATASET_SIZE,
        elapsed.as_secs_f64() * 1000.0,
        iterations
    );
    println!(
        "  Average per call: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}

fn bench_evaluate_error_only_variable() {
    const DATASET_SIZE: usize = 100;
    // x + 1
    let expr = Expr::Binary {
        op: formula_miner::solver::BinaryOp::Add,
        left: Box::new(Expr::Var(0)),
        right: Box::new(Expr::Const(1.0)),
    };
    let data: Vec<(Vec<f64>, f64)> = (0..DATASET_SIZE)
        .map(|i| (vec![i as f64], (i as f64) + 1.0))
        .collect();

    let start = std::time::Instant::now();
    let iterations = 10000;
    for _ in 0..iterations {
        let _ = solver_helpers::evaluate_error_only(&expr, &data);
    }
    let elapsed = start.elapsed();

    println!(
        "evaluate_error_only(x + 1, {} samples): {:.2}ms for {} iterations",
        DATASET_SIZE,
        elapsed.as_secs_f64() * 1000.0,
        iterations
    );
    println!(
        "  Average per call: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}

fn bench_evaluate_error_only_scaled_data() {
    // Test with varying dataset sizes
    for dataset_size in [10, 100, 1000, 10000].iter() {
        let expr = Expr::Binary {
            op: formula_miner::solver::BinaryOp::Add,
            left: Box::new(Expr::Var(0)),
            right: Box::new(Expr::Const(1.0)),
        };
        let data: Vec<(Vec<f64>, f64)> = (0..*dataset_size)
            .map(|i| (vec![i as f64], (i as f64) + 1.0))
            .collect();

        let start = std::time::Instant::now();
        let iterations = 1000;
        for _ in 0..iterations {
            let _ = solver_helpers::evaluate_error_only(&expr, &data);
        }
        let elapsed = start.elapsed();

        let avg_per_call = elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64;
        println!(
            "evaluate_error_only(dataset_size={}): {:.4}μs average per call",
            dataset_size, avg_per_call
        );
    }
    println!();
}

fn bench_evaluate_error_only_complex_expr() {
    const DATASET_SIZE: usize = 100;
    // (x * y) + (floor(x) / (y + 1))
    let expr = Expr::Binary {
        op: formula_miner::solver::BinaryOp::Add,
        left: Box::new(Expr::Binary {
            op: formula_miner::solver::BinaryOp::Mul,
            left: Box::new(Expr::Var(0)),
            right: Box::new(Expr::Var(1)),
        }),
        right: Box::new(Expr::Binary {
            op: formula_miner::solver::BinaryOp::Div,
            left: Box::new(Expr::Unary {
                op: formula_miner::solver::UnaryOp::Floor,
                child: Box::new(Expr::Var(0)),
            }),
            right: Box::new(Expr::Binary {
                op: formula_miner::solver::BinaryOp::Add,
                left: Box::new(Expr::Var(1)),
                right: Box::new(Expr::Const(1.0)),
            }),
        }),
    };
    let data: Vec<(Vec<f64>, f64)> = (1..=DATASET_SIZE)
        .map(|i| {
            let x = i as f64;
            let y = i as f64 * 1.5;
            let target = (x * y) + ((x.floor()) / (y + 1.0));
            (vec![x, y], target)
        })
        .collect();

    let start = std::time::Instant::now();
    let iterations = 1000;
    for _ in 0..iterations {
        let _ = solver_helpers::evaluate_error_only(&expr, &data);
    }
    let elapsed = start.elapsed();

    println!(
        "evaluate_error_only(complex expression, {} samples): {:.2}ms for {} iterations",
        DATASET_SIZE,
        elapsed.as_secs_f64() * 1000.0,
        iterations
    );
    println!(
        "  Average per call: {:.4}μs\n",
        elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
    );
}
