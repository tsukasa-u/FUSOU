/// Bloat control mechanisms for genetic programming
/// 
/// Implements:
/// 1. Tarpeian method: Probabilistically punish oversized individuals
/// 2. Hoist mutation: Promote subtrees to reduce expression size
/// 3. Double tournament: Separate fitness and size tournaments

use crate::solver::Expr;
use rand::Rng;

/// Tarpeian method: Apply severe fitness penalty to individuals larger than average
/// Named after the Tarpeian Rock in ancient Rome
/// 
/// # Arguments
/// * `fitness` - Original fitness value
/// * `size` - Individual's size (number of nodes)
/// * `avg_size` - Population's average size
/// * `penalty_probability` - Probability of applying penalty (typically 0.5)
/// * `rng` - Random number generator
/// 
/// # Returns
/// Modified fitness value (possibly very large if penalty applied)
pub fn tarpeian_penalty<R: Rng + ?Sized>(
    fitness: f64,
    size: usize,
    avg_size: f64,
    penalty_probability: f64,
    rng: &mut R,
) -> f64 {
    if size as f64 > avg_size && rng.gen_bool(penalty_probability) {
        // Apply severe penalty: make fitness extremely bad
        f64::MAX
    } else {
        fitness
    }
}

/// Hoist mutation: Select a random subtree and promote it to be the new root
/// This reduces the overall size of the expression
/// 
/// # Arguments
/// * `expr` - The expression to mutate
/// * `rng` - Random number generator
/// 
/// # Returns
/// A new expression that is a subtree of the original
pub fn hoist_mutation<R: Rng + ?Sized>(expr: &Expr, rng: &mut R) -> Expr {
    // Collect all possible subtrees
    let subtrees = collect_subtrees(expr);
    
    if subtrees.is_empty() || subtrees.len() == 1 {
        // If only root exists, return a clone
        return expr.clone();
    }
    
    // Select a random subtree (excluding the root itself for variety)
    let idx = rng.gen_range(1..subtrees.len());
    subtrees[idx].clone()
}

/// Collect all subtrees of an expression (including the root)
fn collect_subtrees(expr: &Expr) -> Vec<Expr> {
    let mut subtrees = vec![expr.clone()];
    
    match expr {
        Expr::Unary { child, .. } => {
            subtrees.extend(collect_subtrees(child));
        }
        Expr::Binary { left, right, .. } => {
            subtrees.extend(collect_subtrees(left));
            subtrees.extend(collect_subtrees(right));
        }
        _ => {}
    }
    
    subtrees
}

/// Double tournament selection: First tournament by fitness, second by size
/// 
/// # Arguments
/// * `population` - The population with fitness values
/// * `fitness_tournament_size` - Size of fitness tournament
/// * `size_tournament_size` - Size of parsimony tournament
/// * `rng` - Random number generator
/// 
/// # Returns
/// Index of the selected individual
pub fn double_tournament_select<R: Rng + ?Sized>(
    population: &[(f64, usize)],  // (fitness, size) pairs
    fitness_tournament_size: usize,
    size_tournament_size: usize,
    rng: &mut R,
) -> usize {
    let pop_size = population.len();
    
    // First tournament: Select candidates based on fitness
    let mut candidates = Vec::new();
    for _ in 0..fitness_tournament_size {
        let idx = rng.gen_range(0..pop_size);
        candidates.push(idx);
    }
    
    // Find best fitness among candidates
    candidates.sort_by(|&a, &b| {
        population[a].0.partial_cmp(&population[b].0).unwrap()
    });
    
    // Take top performers for size tournament
    let size_tournament_count = size_tournament_size.min(candidates.len());
    let finalists: Vec<usize> = candidates.into_iter().take(size_tournament_count).collect();
    
    // Second tournament: Select smallest among finalists
    finalists.into_iter()
        .min_by_key(|&idx| population[idx].1)
        .unwrap()
}

/// Calculate average size of population
pub fn average_size(population: &[usize]) -> f64 {
    if population.is_empty() {
        return 0.0;
    }
    let sum: usize = population.iter().sum();
    sum as f64 / population.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::{Expr, BinaryOp};

    #[test]
    fn test_tarpeian_penalty() {
        let mut rng = rand::thread_rng();
        let fitness = 0.5;
        let size = 100;
        let avg_size = 50.0;
        
        // With probability, should sometimes return MAX
        let mut got_penalty = false;
        for _ in 0..100 {
            let result = tarpeian_penalty(fitness, size, avg_size, 0.5, &mut rng);
            if result == f64::MAX {
                got_penalty = true;
                break;
            }
        }
        assert!(got_penalty, "Should have applied penalty at least once");
    }

    #[test]
    fn test_hoist_mutation() {
        let mut rng = rand::thread_rng();
        let expr = Expr::Binary {
            op: BinaryOp::Add,
            left: Box::new(Expr::Var(0)),
            right: Box::new(Expr::Binary {
                op: BinaryOp::Mul,
                left: Box::new(Expr::Const(2.0)),
                right: Box::new(Expr::Var(1)),
            }),
        };
        
        let original_size = expr.size();
        let hoisted = hoist_mutation(&expr, &mut rng);
        let hoisted_size = hoisted.size();
        
        // Hoisted expression should be smaller or equal
        assert!(hoisted_size <= original_size);
    }

    #[test]
    fn test_double_tournament() {
        let mut rng = rand::thread_rng();
        let population = vec![
            (0.5, 10),  // Good fitness, medium size
            (0.3, 20),  // Best fitness, large size
            (0.7, 5),   // Worse fitness, smallest size
            (0.6, 15),  // Medium on both
        ];
        
        let selected = double_tournament_select(&population, 3, 2, &mut rng);
        
        // Should select from top performers
        assert!(selected < population.len());
        
        // Verify it tends to select smaller among good performers
        let mut small_count = 0;
        for _ in 0..100 {
            let idx = double_tournament_select(&population, 3, 2, &mut rng);
            if population[idx].1 <= 10 {
                small_count += 1;
            }
        }
        assert!(small_count > 30, "Should prefer smaller expressions");
    }

    #[test]
    fn test_average_size() {
        let sizes = vec![5, 10, 15, 20];
        assert_eq!(average_size(&sizes), 12.5);
        
        let empty: Vec<usize> = vec![];
        assert_eq!(average_size(&empty), 0.0);
    }
}
