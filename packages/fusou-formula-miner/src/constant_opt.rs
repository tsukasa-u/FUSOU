/// Constant optimization for symbolic regression
/// 
/// Implements simple gradient descent and Nelder-Mead like optimization
/// for fine-tuning numerical constants in evolved expressions

use crate::solver::Expr;

/// Extract all constant values from an expression
pub fn extract_constants(expr: &Expr) -> Vec<f64> {
    let mut constants = Vec::new();
    extract_constants_recursive(expr, &mut constants);
    constants
}

fn extract_constants_recursive(expr: &Expr, constants: &mut Vec<f64>) {
    match expr {
        Expr::Const(c) => constants.push(*c),
        Expr::Unary { child, .. } => extract_constants_recursive(child, constants),
        Expr::Binary { left, right, .. } => {
            extract_constants_recursive(left, constants);
            extract_constants_recursive(right, constants);
        }
        _ => {}
    }
}

/// Replace constants in an expression with new values
pub fn replace_constants(expr: &Expr, constants: &[f64], index: &mut usize) -> Expr {
    match expr {
        Expr::Const(_) => {
            if *index < constants.len() {
                let c = constants[*index];
                *index += 1;
                Expr::Const(c)
            } else {
                expr.clone()
            }
        }
        Expr::Var(_) => expr.clone(),
        Expr::Unary { op, child } => Expr::Unary {
            op: *op,
            child: Box::new(replace_constants(child, constants, index)),
        },
        Expr::Binary { op, left, right } => Expr::Binary {
            op: *op,
            left: Box::new(replace_constants(left, constants, index)),
            right: Box::new(replace_constants(right, constants, index)),
        },
    }
}

/// Optimize constants using simple coordinate descent
/// 
/// # Arguments
/// * `expr` - Expression with constants to optimize
/// * `data` - Training data (features, target) pairs
/// * `iterations` - Number of optimization iterations
/// * `learning_rate` - Step size for gradient descent
/// 
/// # Returns
/// Expression with optimized constants
pub fn optimize_constants(
    expr: &Expr,
    data: &[(Vec<f64>, f64)],
    iterations: usize,
    learning_rate: f64,
) -> Expr {
    let mut constants = extract_constants(expr);
    
    if constants.is_empty() {
        return expr.clone();
    }
    
    let n_constants = constants.len();
    
    // Simple coordinate descent
    for _ in 0..iterations {
        for i in 0..n_constants {
            let original = constants[i];
            
            // Evaluate current error
            let mut idx = 0;
            let current_expr = replace_constants(expr, &constants, &mut idx);
            let current_error = evaluate_rmse(&current_expr, data);
            
            // Try small perturbation
            constants[i] = original + learning_rate;
            idx = 0;
            let new_expr = replace_constants(expr, &constants, &mut idx);
            let forward_error = evaluate_rmse(&new_expr, data);
            
            constants[i] = original - learning_rate;
            idx = 0;
            let new_expr = replace_constants(expr, &constants, &mut idx);
            let backward_error = evaluate_rmse(&new_expr, data);
            
            // Move in direction of improvement
            if forward_error < current_error && forward_error <= backward_error {
                constants[i] = original + learning_rate;
            } else if backward_error < current_error {
                constants[i] = original - learning_rate;
            } else {
                constants[i] = original;
            }
        }
    }
    
    let mut idx = 0;
    replace_constants(expr, &constants, &mut idx)
}

/// Calculate RMSE for an expression on given data
fn evaluate_rmse(expr: &Expr, data: &[(Vec<f64>, f64)]) -> f64 {
    let mut sum_sq = 0.0;
    let mut count = 0;
    
    for (vars, target) in data {
        let prediction = expr.eval(vars);
        if prediction.is_finite() {
            let diff = prediction - target;
            sum_sq += diff * diff;
            count += 1;
        }
    }
    
    if count == 0 {
        return f64::MAX;
    }
    
    (sum_sq / count as f64).sqrt()
}

/// Simplified Nelder-Mead optimization for constants
/// More robust than coordinate descent but slower
pub fn nelder_mead_optimize(
    expr: &Expr,
    data: &[(Vec<f64>, f64)],
    max_iterations: usize,
) -> Expr {
    let mut constants = extract_constants(expr);
    
    if constants.is_empty() || data.is_empty() {
        return expr.clone();
    }
    
    let n = constants.len();
    
    // Initialize simplex: n+1 points
    let mut simplex: Vec<Vec<f64>> = Vec::new();
    simplex.push(constants.clone());
    
    for i in 0..n {
        let mut point = constants.clone();
        point[i] += 0.1; // Small perturbation
        simplex.push(point);
    }
    
    // Parameters
    let alpha = 1.0;  // Reflection
    let gamma = 2.0;  // Expansion
    let rho = 0.5;    // Contraction
    let sigma = 0.5;  // Shrink
    
    for _ in 0..max_iterations {
        // Evaluate all points
        let mut errors: Vec<(f64, usize)> = simplex
            .iter()
            .enumerate()
            .map(|(idx, point)| {
                let mut i = 0;
                let test_expr = replace_constants(expr, point, &mut i);
                let error = evaluate_rmse(&test_expr, data);
                (error, idx)
            })
            .collect();
        
        errors.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        
        let best_idx = errors[0].1;
        let worst_idx = errors[n].1;
        let second_worst_idx = errors[n - 1].1;
        
        // Calculate centroid (excluding worst point)
        let mut centroid = vec![0.0; n];
        for i in 0..=n {
            if i != worst_idx {
                for j in 0..n {
                    centroid[j] += simplex[i][j];
                }
            }
        }
        for j in 0..n {
            centroid[j] /= n as f64;
        }
        
        // Reflection
        let mut reflected = vec![0.0; n];
        for j in 0..n {
            reflected[j] = centroid[j] + alpha * (centroid[j] - simplex[worst_idx][j]);
        }
        
        let mut i = 0;
        let reflected_expr = replace_constants(expr, &reflected, &mut i);
        let reflected_error = evaluate_rmse(&reflected_expr, data);
        
        if errors[0].0 <= reflected_error && reflected_error < errors[n - 1].0 {
            simplex[worst_idx] = reflected;
            continue;
        }
        
        // Expansion
        if reflected_error < errors[0].0 {
            let mut expanded = vec![0.0; n];
            for j in 0..n {
                expanded[j] = centroid[j] + gamma * (reflected[j] - centroid[j]);
            }
            
            let mut i = 0;
            let expanded_expr = replace_constants(expr, &expanded, &mut i);
            let expanded_error = evaluate_rmse(&expanded_expr, data);
            
            if expanded_error < reflected_error {
                simplex[worst_idx] = expanded;
            } else {
                simplex[worst_idx] = reflected;
            }
            continue;
        }
        
        // Contraction
        let mut contracted = vec![0.0; n];
        for j in 0..n {
            contracted[j] = centroid[j] + rho * (simplex[worst_idx][j] - centroid[j]);
        }
        
        let mut i = 0;
        let contracted_expr = replace_constants(expr, &contracted, &mut i);
        let contracted_error = evaluate_rmse(&contracted_expr, data);
        
        if contracted_error < errors[n].0 {
            simplex[worst_idx] = contracted;
            continue;
        }
        
        // Shrink
        for i in 0..=n {
            if i != best_idx {
                for j in 0..n {
                    simplex[i][j] = simplex[best_idx][j] + sigma * (simplex[i][j] - simplex[best_idx][j]);
                }
            }
        }
    }
    
    // Return expression with best constants
    let mut errors: Vec<(f64, Vec<f64>)> = simplex
        .iter()
        .map(|point| {
            let mut i = 0;
            let test_expr = replace_constants(expr, point, &mut i);
            let error = evaluate_rmse(&test_expr, data);
            (error, point.clone())
        })
        .collect();
    
    errors.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    
    let mut idx = 0;
    replace_constants(expr, &errors[0].1, &mut idx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::{Expr, BinaryOp};

    #[test]
    fn test_extract_constants() {
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Const(2.0)),
            right: Box::new(Expr::Binary {
                op: BinaryOp::Mul,
                left: Box::new(Expr::Const(3.0)),
                right: Box::new(Expr::Var(0)),
            }),
        };
        
        let constants = extract_constants(&expr);
        assert_eq!(constants, vec![2.0, 3.0]);
    }

    #[test]
    fn test_replace_constants() {
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Const(2.0)),
            right: Box::new(Expr::Const(3.0)),
        };
        
        let new_constants = vec![5.0, 7.0];
        let mut idx = 0;
        let new_expr = replace_constants(&expr, &new_constants, &mut idx);
        
        let result = new_expr.eval(&[]);
        assert_eq!(result, 12.0);  // 5.0 + 7.0
    }

    #[test]
    fn test_optimize_constants_simple() {
        // Expression: c1 * x + c2, should optimize to 2*x + 3
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Binary {
                op: BinaryOp::Mul,
                left: Box::new(Expr::Const(1.0)),  // Should optimize to ~2
                right: Box::new(Expr::Var(0)),
            }),
            right: Box::new(Expr::Const(0.0)),  // Should optimize to ~3
        };
        
        // Data: y = 2*x + 3
        let data: Vec<(Vec<f64>, f64)> = vec![
            (vec![0.0], 3.0),
            (vec![1.0], 5.0),
            (vec![2.0], 7.0),
            (vec![3.0], 9.0),
        ];
        
        let optimized = optimize_constants(&expr, &data, 100, 0.1);
        let error = evaluate_rmse(&optimized, &data);
        
        // Should achieve low error
        assert!(error < 0.5, "Optimization should reduce error significantly");
    }
}
