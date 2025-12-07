//! Fitness evaluation functions

use crate::solver::Expr;

/// Evaluate expression fitness with RMSE and complexity penalty
pub fn evaluate(expr: &Expr, data: &[(Vec<f64>, f64)]) -> f64 {
    // Simplify expression to remove redundant patterns like exp(log(x)) = x
    let simplified = expr.simplify();
    
    let mut sum_sq: f64 = 0.0;
    for (vars, target) in data {
        let prediction = simplified.eval(vars);
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
    let rmse = crate::engine::statistics::rmse(sum_sq, data.len());
    
    // Add parsimony pressure: penalize complex expressions
    // Each node adds 0.02 to the error (increased from 0.01 for stronger pressure)
    // This encourages the GA to prefer simpler, more interpretable solutions
    let complexity_penalty = simplified.size() as f64 * 0.02;
    rmse + complexity_penalty
}
