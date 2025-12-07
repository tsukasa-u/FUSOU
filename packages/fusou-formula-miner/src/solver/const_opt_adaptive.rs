/// Unified constant optimization interface
/// Supports multiple optimization methods: coordinate descent, Newton's method, Nelder-Mead
use crate::solver::Expr;
use crate::solver::constant_opt;
use crate::config::ConstOptConfig;

/// Optimize constants in an expression using the configured method
pub fn optimize_constants_adaptive(
    expr: &Expr,
    data: &[(Vec<f64>, f64)],
    config: &ConstOptConfig,
) -> Expr {
    match config.method.as_str() {
        "newton_method" => {
            // Use Newton's method (faster, more efficient for smooth functions)
            constant_opt::newton_method_optimize(
                expr,
                data,
                config.learning_rate,
                config.default_max_iterations,
                config.newton_epsilon,
            )
        }
        "nelder_mead" => {
            // Use Nelder-Mead (more robust, handles non-smooth problems)
            constant_opt::nelder_mead_optimize(expr, data, config.default_max_iterations)
        }
        "coordinate_descent" | _ => {
            // Default to coordinate descent (legacy, slower)
            constant_opt::optimize_constants(
                expr,
                data,
                config.default_max_iterations,
                config.learning_rate,
            )
        }
    }
}

/// Quick constants optimization (fewer iterations, for real-time optimization)
pub fn optimize_constants_quick(
    expr: &Expr,
    data: &[(Vec<f64>, f64)],
    config: &ConstOptConfig,
) -> Expr {
    // Use fewer iterations for quick optimization
    let quick_iterations = (config.default_max_iterations / 2).max(5);
    
    match config.method.as_str() {
        "newton_method" => {
            constant_opt::newton_method_optimize(
                expr,
                data,
                config.learning_rate,
                quick_iterations,
                config.newton_epsilon,
            )
        }
        "nelder_mead" => {
            constant_opt::nelder_mead_optimize(expr, data, quick_iterations)
        }
        "coordinate_descent" | _ => {
            constant_opt::optimize_constants(expr, data, quick_iterations, config.learning_rate)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::MinerConfig;

    #[test]
    fn test_adaptive_optimization() {
        let expr = Expr::Const(1.5);
        let data: Vec<(Vec<f64>, f64)> = vec![
            (vec![], 1.5),
            (vec![], 1.5),
        ];

        let mut config = MinerConfig::default();
        config.const_opt.method = "newton_method".to_string();

        let result = optimize_constants_adaptive(&expr, &data, &config.const_opt);
        match result {
            Expr::Const(c) => assert!((c - 1.5).abs() < 1e-9),
            other => panic!("Expected constant, got {}", other.to_string(&[])),
        }
    }
}
