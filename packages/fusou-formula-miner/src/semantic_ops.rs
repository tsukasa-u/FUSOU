/// Semantic crossover and mutation operators for symbolic regression
/// 
/// These operators work on the expression's semantics (output behavior)
/// rather than just structure, improving locality and convergence.

use crate::solver::Expr;
use rand::Rng;

/// Semantic crossover: Create a child that is semantically between the parents
/// Uses geometric semantic crossover (GSC): child = (parent1 * TR) + (parent2 * (1 - TR))
/// where TR is a random expression in [0, 1]
/// 
/// This ensures the child's output is always between the parents' outputs,
/// improving search locality
pub fn semantic_crossover<R: Rng + ?Sized>(
    parent1: &Expr,
    parent2: &Expr,
    rng: &mut R,
    num_vars: usize,
    max_depth: usize,
) -> Expr {
    use crate::solver::{BinaryOp, UnaryOp};
    
    // Generate a random expression TR that produces values in [0, 1]
    // We use sigmoid-like transformation: 1 / (1 + exp(-x))
    let mut _tmp_counts = std::collections::HashMap::new();
    let random_tree = crate::solver::random_expr(rng, max_depth.min(2), num_vars, &mut _tmp_counts);
    let tr = Expr::Binary {
        op: BinaryOp::Div,
        left: Box::new(Expr::Const(1.0)),
        right: Box::new(Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Const(1.0)),
            right: Box::new(Expr::Unary {
                op: UnaryOp::Exp,
                child: Box::new(Expr::Unary {
                    op: UnaryOp::Identity,
                    child: Box::new(random_tree),
                }),
            }),
        }),
    };
    
    // Compute: parent1 * TR + parent2 * (1 - TR)
    let term1 = Expr::Binary {
        op: BinaryOp::Mul,
        left: Box::new(parent1.clone()),
        right: Box::new(tr.clone()),
    };
    
    let one_minus_tr = Expr::Binary {
        op: BinaryOp::Sub,
        left: Box::new(Expr::Const(1.0)),
        right: Box::new(tr),
    };
    
    let term2 = Expr::Binary {
        op: BinaryOp::Mul,
        left: Box::new(parent2.clone()),
        right: Box::new(one_minus_tr),
    };
    
    Expr::Binary {
        op: BinaryOp::Add,
        left: Box::new(term1),
        right: Box::new(term2),
    }.simplify()
}

/// Semantic mutation: Mutate based on output similarity
/// Creates a mutation that's semantically close to the original
pub fn semantic_mutation<R: Rng + ?Sized>(
    expr: &Expr,
    rng: &mut R,
    num_vars: usize,
    max_depth: usize,
    mutation_step: f64,
) -> Expr {
    use crate::solver::BinaryOp;
    
    // Generate two random trees
    let mut _tmp_counts1 = std::collections::HashMap::new();
    let mut _tmp_counts2 = std::collections::HashMap::new();
    let random_tree1 = crate::solver::random_expr(rng, max_depth.min(2), num_vars, &mut _tmp_counts1);
    let random_tree2 = crate::solver::random_expr(rng, max_depth.min(2), num_vars, &mut _tmp_counts2);
    
    // Compute: expr + mutation_step * (random_tree1 - random_tree2)
    let diff = Expr::Binary {
        op: BinaryOp::Sub,
        left: Box::new(random_tree1),
        right: Box::new(random_tree2),
    };
    
    let scaled_diff = Expr::Binary {
        op: BinaryOp::Mul,
        left: Box::new(Expr::Const(mutation_step)),
        right: Box::new(diff),
    };
    
    Expr::Binary {
        op: BinaryOp::Add,
        left: Box::new(expr.clone()),
        right: Box::new(scaled_diff),
    }.simplify()
}

/// Calculate semantic similarity between two expressions on given data
/// Returns a value in [0, 1] where 1 means identical outputs
pub fn semantic_similarity(expr1: &Expr, expr2: &Expr, data: &[(Vec<f64>, f64)]) -> f64 {
    if data.is_empty() {
        return 0.0;
    }
    
    let mut sum_sq_diff = 0.0;
    let mut sum_sq1 = 0.0;
    let mut count = 0;
    
    for (vars, _) in data {
        let out1 = expr1.eval(vars);
        let out2 = expr2.eval(vars);
        
        if out1.is_finite() && out2.is_finite() {
            let diff = out1 - out2;
            sum_sq_diff += diff * diff;
            sum_sq1 += out1 * out1;
            count += 1;
        }
    }
    
    if count == 0 || sum_sq1 < 1e-10 {
        return 0.0;
    }
    
    // Return normalized similarity: 1 - (RMSE / norm)
    let rmse = (sum_sq_diff / count as f64).sqrt();
    let norm = (sum_sq1 / count as f64).sqrt();
    
    (1.0 - (rmse / (norm + 1e-10))).max(0.0).min(1.0)
}

/// Approximate point crossover: Exchange subtrees with similar semantics
/// This preserves good building blocks by ensuring swapped subtrees have similar behavior
pub fn approximate_point_crossover<R: Rng + ?Sized>(
    parent1: &Expr,
    parent2: &Expr,
    data: &[(Vec<f64>, f64)],
    rng: &mut R,
    similarity_threshold: f64,
) -> Expr {
    // Collect subtrees from both parents
    let subtrees1 = collect_all_subtrees(parent1);
    let subtrees2 = collect_all_subtrees(parent2);
    
    // Try to find semantically similar subtrees
    for _ in 0..10 {  // Limited attempts
        if subtrees1.is_empty() || subtrees2.is_empty() {
            break;
        }
        
        let idx1 = rng.gen_range(0..subtrees1.len());
        let idx2 = rng.gen_range(0..subtrees2.len());
        
        let similarity = semantic_similarity(&subtrees1[idx1], &subtrees2[idx2], data);
        
        if similarity >= similarity_threshold {
            // Found similar subtrees - perform swap
            let mut child = parent1.clone();
            if let Some(target) = find_and_replace(&mut child, &subtrees1[idx1], &subtrees2[idx2]) {
                return target.simplify();
            }
        }
    }
    
    // Fallback to standard crossover if no good match found
    let mut _tmp_counts = std::collections::HashMap::new();
    crate::solver::crossover(parent1, parent2, rng, &mut _tmp_counts)
}

/// Collect all subtrees from an expression
fn collect_all_subtrees(expr: &Expr) -> Vec<Expr> {
    let mut result = vec![expr.clone()];
    
    match expr {
        Expr::Unary { child, .. } => {
            result.extend(collect_all_subtrees(child));
        }
        Expr::Binary { left, right, .. } => {
            result.extend(collect_all_subtrees(left));
            result.extend(collect_all_subtrees(right));
        }
        _ => {}
    }
    
    result
}

/// Find a subtree and replace it with a new one
fn find_and_replace(expr: &mut Expr, old: &Expr, new: &Expr) -> Option<Expr> {
    // Simple structural equality check for demonstration
    if format!("{:?}", expr) == format!("{:?}", old) {
        *expr = new.clone();
        return Some(expr.clone());
    }
    
    match expr {
        Expr::Unary { child, .. } => {
            find_and_replace(child, old, new)
        }
        Expr::Binary { left, right, .. } => {
            find_and_replace(left, old, new)
                .or_else(|| find_and_replace(right, old, new))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::{Expr, BinaryOp};

    #[test]
    fn test_semantic_crossover() {
        let mut rng = rand::thread_rng();
        let parent1 = Expr::Var(0);
        let parent2 = Expr::Binary {
            op: BinaryOp::Mul,
            left: Box::new(Expr::Const(2.0)),
            right: Box::new(Expr::Var(0)),
        };
        
        let child = semantic_crossover(&parent1, &parent2, &mut rng, 1, 3);
        
        // Child should be a valid expression
        assert!(matches!(child, Expr::Binary { .. }));
    }

    #[test]
    fn test_semantic_similarity() {
        let expr1 = Expr::Var(0);
        let expr2 = Expr::Var(0);
        let data = vec![
            (vec![1.0], 1.0),
            (vec![2.0], 2.0),
            (vec![3.0], 3.0),
        ];
        
        let similarity = semantic_similarity(&expr1, &expr2, &data);
        assert!(similarity > 0.99, "Identical expressions should have similarity ~1.0");
    }

    #[test]
    fn test_semantic_mutation() {
        let mut rng = rand::thread_rng();
        let expr = Expr::Var(0);
        let mutated = semantic_mutation(&expr, &mut rng, 1, 3, 0.1);
        
        // Mutated expression should be different but related
        assert!(matches!(mutated, Expr::Binary { .. }));
    }
}
