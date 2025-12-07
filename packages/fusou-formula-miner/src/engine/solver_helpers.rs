/// Helper functions for genetic algorithm evaluation, selection, and utilities.
use crate::solver::Expr;
use crate::engine::duplicate_detection::DuplicateTracker;
use std::sync::Mutex;
use std::sync::Arc;

/// Evaluate expression error on dataset and apply duplicate penalty
pub fn evaluate_error_only_with_penalty(
    expr: &Expr,
    data: &[(Vec<f64>, f64)],
    duplicate_tracker: &Arc<Mutex<DuplicateTracker>>,
    penalty: f64,
) -> f64 {
    let mut error = evaluate_error_only(expr, data);
    if duplicate_tracker.lock().unwrap().is_duplicate(expr) {
        error += penalty;
    }
    error
}

/// Evaluate expression error only (RMSE)
pub fn evaluate_error_only(expr: &Expr, data: &[(Vec<f64>, f64)]) -> f64 {
    if data.is_empty() {
        return f64::INFINITY;
    }
    
    let simplified = expr.simplify();
    
    let mut sum_sq: f64 = 0.0;
    for (features, target) in data {
        let prediction = simplified.eval(features);
        if !prediction.is_finite() {
            return f64::INFINITY;
        }
        let diff = prediction - target;
        let contribution = diff * diff;
        if !contribution.is_finite() {
            return f64::INFINITY;
        }
        sum_sq += contribution;
        if !sum_sq.is_finite() {
            return f64::INFINITY;
        }
    }
    
    crate::engine::statistics::rmse(sum_sq, data.len())
}

/// Count occurrences of operators in an expression tree
pub fn count_ops_in_expr(expr: &Expr, counts: &mut std::collections::HashMap<&'static str, usize>) {
    use crate::solver::UnaryOp;
    
    match expr {
        Expr::Const(_) | Expr::Var(_) => {}
        Expr::Unary { op, child } => {
            match op {
                UnaryOp::Floor => *counts.entry("floor").or_insert(0) += 1,
                UnaryOp::Exp => *counts.entry("exp").or_insert(0) += 1,
                UnaryOp::Pow => *counts.entry("pow").or_insert(0) += 1,
                UnaryOp::Step => *counts.entry("step").or_insert(0) += 1,
                UnaryOp::Log => *counts.entry("log").or_insert(0) += 1,
                UnaryOp::Sqrt => *counts.entry("sqrt").or_insert(0) += 1,
                _ => {}
            }
            count_ops_in_expr(child, counts);
        }
        Expr::Binary { op, left, right } => {
            match op {
                crate::solver::BinaryOp::Add => *counts.entry("+").or_insert(0) += 1,
                crate::solver::BinaryOp::Sub => *counts.entry("-").or_insert(0) += 1,
                crate::solver::BinaryOp::Mul => *counts.entry("*").or_insert(0) += 1,
                crate::solver::BinaryOp::Div => *counts.entry("/").or_insert(0) += 1,
                crate::solver::BinaryOp::Min => *counts.entry("min").or_insert(0) += 1,
                crate::solver::BinaryOp::Max => *counts.entry("max").or_insert(0) += 1,
            }
            count_ops_in_expr(left, counts);
            count_ops_in_expr(right, counts);
        }
    }
}

/// Count STEP operations in an expression
pub fn count_step_ops(expr: &Expr) -> usize {
    use crate::solver::UnaryOp;
    
    match expr {
        Expr::Const(_) | Expr::Var(_) => 0,
        Expr::Unary { op, child } => {
            let count = if matches!(op, UnaryOp::Step) { 1 } else { 0 };
            count + count_step_ops(child)
        }
        Expr::Binary { left, right, .. } => count_step_ops(left) + count_step_ops(right),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::{Expr, UnaryOp, BinaryOp};
    
    #[test]
    fn test_evaluate_error_only_empty_data() {
        let expr = Expr::Const(1.0);
        let result = evaluate_error_only(&expr, &[]);
        assert!(result.is_infinite());
    }
    
    #[test]
    fn test_evaluate_error_only_perfect_prediction() {
        let expr = Expr::Const(5.0);
        let data = vec![(vec![1.0], 5.0), (vec![2.0], 5.0), (vec![3.0], 5.0)];
        let result = evaluate_error_only(&expr, &data);
        assert!(result.is_finite());
        assert!(result < 0.01); // Should be very small
    }
    
    #[test]
    fn test_evaluate_error_only_with_vars() {
        // expr: x + 2
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Var(0)),
            right: Box::new(Expr::Const(2.0)),
        };
        let data = vec![(vec![1.0], 3.0), (vec![2.0], 4.0), (vec![3.0], 5.0)];
        let result = evaluate_error_only(&expr, &data);
        assert!(result.is_finite());
        assert!(result < 0.01); // Perfect fit
    }
    
    #[test]
    fn test_evaluate_error_only_with_mismatch() {
        // expr: 10 * x with data expecting x
        let expr = Expr::Binary {
            op: BinaryOp::Mul,
            left: Box::new(Expr::Var(0)),
            right: Box::new(Expr::Const(10.0)),
        };
        let data = vec![
            (vec![1.0], 1.0),
            (vec![2.0], 2.0),
            (vec![3.0], 3.0),
        ];
        let result = evaluate_error_only(&expr, &data);
        assert!(result.is_finite());
        assert!(result > 0.0); // Should have error since 10*x != x
    }
    
    #[test]
    fn test_count_ops_in_expr_single_add() {
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Var(0)),
            right: Box::new(Expr::Const(1.0)),
        };
        let mut counts = std::collections::HashMap::new();
        count_ops_in_expr(&expr, &mut counts);
        assert_eq!(counts.get("+"), Some(&1));
        assert_eq!(counts.len(), 1);
    }
    
    #[test]
    fn test_count_ops_in_expr_nested() {
        // (x + y) * (a - b)
        let expr = Expr::Binary {
            op: BinaryOp::Mul,
            left: Box::new(Expr::Binary {
                op: BinaryOp::Add,
                left: Box::new(Expr::Var(0)),
                right: Box::new(Expr::Var(1)),
            }),
            right: Box::new(Expr::Binary {
                op: BinaryOp::Sub,
                left: Box::new(Expr::Var(2)),
                right: Box::new(Expr::Var(3)),
            }),
        };
        let mut counts = std::collections::HashMap::new();
        count_ops_in_expr(&expr, &mut counts);
        assert_eq!(counts.get("+"), Some(&1));
        assert_eq!(counts.get("-"), Some(&1));
        assert_eq!(counts.get("*"), Some(&1));
        assert_eq!(counts.len(), 3);
    }
    
    #[test]
    fn test_count_ops_in_expr_unary() {
        // floor(x)
        let expr = Expr::Unary {
            op: UnaryOp::Floor,
            child: Box::new(Expr::Var(0)),
        };
        let mut counts = std::collections::HashMap::new();
        count_ops_in_expr(&expr, &mut counts);
        assert_eq!(counts.get("floor"), Some(&1));
        assert_eq!(counts.len(), 1);
    }
    
    #[test]
    fn test_count_ops_in_expr_all_unary() {
        // exp(floor(log(sqrt(x))))
        let expr = Expr::Unary {
            op: UnaryOp::Exp,
            child: Box::new(Expr::Unary {
                op: UnaryOp::Floor,
                child: Box::new(Expr::Unary {
                    op: UnaryOp::Log,
                    child: Box::new(Expr::Unary {
                        op: UnaryOp::Sqrt,
                        child: Box::new(Expr::Var(0)),
                    }),
                }),
            }),
        };
        let mut counts = std::collections::HashMap::new();
        count_ops_in_expr(&expr, &mut counts);
        assert_eq!(counts.get("exp"), Some(&1));
        assert_eq!(counts.get("floor"), Some(&1));
        assert_eq!(counts.get("log"), Some(&1));
        assert_eq!(counts.get("sqrt"), Some(&1));
        assert_eq!(counts.len(), 4);
    }
    
    #[test]
    fn test_count_step_ops_no_step() {
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Var(0)),
            right: Box::new(Expr::Const(1.0)),
        };
        let result = count_step_ops(&expr);
        assert_eq!(result, 0);
    }
    
    #[test]
    fn test_count_step_ops_single_step() {
        let expr = Expr::Unary {
            op: UnaryOp::Step,
            child: Box::new(Expr::Var(0)),
        };
        let result = count_step_ops(&expr);
        assert_eq!(result, 1);
    }
    
    #[test]
    fn test_count_step_ops_nested() {
        // (step(x) + step(y)) * z
        let expr = Expr::Binary {
            op: BinaryOp::Mul,
            left: Box::new(Expr::Binary {
                op: BinaryOp::Add,
                left: Box::new(Expr::Unary {
                    op: UnaryOp::Step,
                    child: Box::new(Expr::Var(0)),
                }),
                right: Box::new(Expr::Unary {
                    op: UnaryOp::Step,
                    child: Box::new(Expr::Var(1)),
                }),
            }),
            right: Box::new(Expr::Var(2)),
        };
        let result = count_step_ops(&expr);
        assert_eq!(result, 2);
    }
    
    #[test]
    fn test_evaluate_error_only_with_penalty() {
        let expr = Expr::Const(5.0);
        let data = vec![(vec![1.0], 5.0)];
        
        // Create a duplicate tracker with history size of 1000
        let tracker = Arc::new(Mutex::new(DuplicateTracker::new(1000)));
        
        let result = evaluate_error_only_with_penalty(&expr, &data, &tracker, 1.0);
        assert!(result.is_finite());
        assert!(result < 0.01); // Perfect fit, no penalty
    }
}
