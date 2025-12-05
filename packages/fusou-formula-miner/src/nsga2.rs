/// NSGA-II (Non-dominated Sorting Genetic Algorithm II) implementation
/// for multi-objective optimization in symbolic regression.
/// 
/// Objectives:
/// 1. Minimize prediction error (RMSE)
/// 2. Minimize model complexity (expression size)

use crate::solver::Expr;

#[derive(Clone, Debug)]
pub struct MultiObjectiveIndividual {
    pub expr: Expr,
    pub error: f64,        // First objective: prediction error
    pub size: usize,       // Second objective: model complexity
    pub rank: usize,       // Pareto rank (0 = non-dominated front)
    pub crowding_distance: f64,  // Crowding distance for diversity
}

impl MultiObjectiveIndividual {
    pub fn new(expr: Expr, error: f64) -> Self {
        let size = expr.size();
        Self {
            expr,
            error,
            size,
            rank: 0,
            crowding_distance: 0.0,
        }
    }

    /// Check if this individual dominates another
    /// Returns true if this is better or equal in all objectives and strictly better in at least one
    pub fn dominates(&self, other: &Self) -> bool {
        let better_or_equal = self.error <= other.error && self.size <= other.size;
        let strictly_better = self.error < other.error || self.size < other.size;
        better_or_equal && strictly_better
    }
}

/// Perform non-dominated sorting on a population
/// Returns vector of fronts (each front is a vector of indices)
pub fn non_dominated_sort(population: &[MultiObjectiveIndividual]) -> Vec<Vec<usize>> {
    let n = population.len();
    let mut domination_count = vec![0; n];  // Number of individuals that dominate i
    let mut dominated_solutions = vec![Vec::new(); n];  // Indices dominated by i
    let mut fronts: Vec<Vec<usize>> = vec![Vec::new()];

    // Calculate domination relationships
    for i in 0..n {
        for j in 0..n {
            if i == j {
                continue;
            }
            if population[i].dominates(&population[j]) {
                dominated_solutions[i].push(j);
            } else if population[j].dominates(&population[i]) {
                domination_count[i] += 1;
            }
        }
        
        // If not dominated by anyone, it's in the first front
        if domination_count[i] == 0 {
            fronts[0].push(i);
        }
    }

    // Build subsequent fronts
    let mut current_front = 0;
    while !fronts[current_front].is_empty() {
        let mut next_front = Vec::new();
        
        for &i in &fronts[current_front] {
            for &j in &dominated_solutions[i] {
                domination_count[j] -= 1;
                if domination_count[j] == 0 {
                    next_front.push(j);
                }
            }
        }
        
        if !next_front.is_empty() {
            fronts.push(next_front);
        }
        current_front += 1;
    }

    fronts
}

/// Calculate crowding distance for individuals in a front
/// Higher distance means the individual is more isolated (better for diversity)
pub fn calculate_crowding_distance(
    population: &mut [MultiObjectiveIndividual],
    front_indices: &[usize],
) {
    let n = front_indices.len();
    if n <= 2 {
        // Boundary solutions get infinite distance
        for &idx in front_indices {
            population[idx].crowding_distance = f64::INFINITY;
        }
        return;
    }

    // Initialize distances to 0
    for &idx in front_indices {
        population[idx].crowding_distance = 0.0;
    }

    // Sort by each objective and assign distances
    // Objective 1: error
    let mut sorted_by_error: Vec<usize> = front_indices.to_vec();
    sorted_by_error.sort_by(|&a, &b| {
        population[a].error.partial_cmp(&population[b].error).unwrap()
    });

    // Boundary solutions get infinite distance
    population[sorted_by_error[0]].crowding_distance = f64::INFINITY;
    population[sorted_by_error[n - 1]].crowding_distance = f64::INFINITY;

    // Calculate distance for middle solutions (error objective)
    let error_range = population[sorted_by_error[n - 1]].error - population[sorted_by_error[0]].error;
    if error_range > 1e-10 {
        for i in 1..(n - 1) {
            let prev_error = population[sorted_by_error[i - 1]].error;
            let next_error = population[sorted_by_error[i + 1]].error;
            population[sorted_by_error[i]].crowding_distance += (next_error - prev_error) / error_range;
        }
    }

    // Objective 2: size
    let mut sorted_by_size: Vec<usize> = front_indices.to_vec();
    sorted_by_size.sort_by_key(|&idx| population[idx].size);

    // Boundary solutions already have infinite distance
    if population[sorted_by_size[0]].crowding_distance != f64::INFINITY {
        population[sorted_by_size[0]].crowding_distance = f64::INFINITY;
    }
    if population[sorted_by_size[n - 1]].crowding_distance != f64::INFINITY {
        population[sorted_by_size[n - 1]].crowding_distance = f64::INFINITY;
    }

    // Calculate distance for middle solutions (size objective)
    let size_range = (population[sorted_by_size[n - 1]].size as f64) - (population[sorted_by_size[0]].size as f64);
    if size_range > 1e-10 {
        for i in 1..(n - 1) {
            if population[sorted_by_size[i]].crowding_distance != f64::INFINITY {
                let prev_size = population[sorted_by_size[i - 1]].size as f64;
                let next_size = population[sorted_by_size[i + 1]].size as f64;
                population[sorted_by_size[i]].crowding_distance += (next_size - prev_size) / size_range;
            }
        }
    }
}

/// Perform NSGA-II selection: assign ranks and crowding distances
pub fn nsga2_selection(population: &mut Vec<MultiObjectiveIndividual>) {
    let fronts = non_dominated_sort(population);
    
    // Assign ranks
    for (rank, front) in fronts.iter().enumerate() {
        for &idx in front {
            population[idx].rank = rank;
        }
        
        // Calculate crowding distance for this front
        calculate_crowding_distance(population, front);
    }
}

/// Compare two individuals for NSGA-II tournament selection
/// Returns true if 'a' is better than 'b'
pub fn nsga2_compare(a: &MultiObjectiveIndividual, b: &MultiObjectiveIndividual) -> bool {
    if a.rank != b.rank {
        // Lower rank is better (closer to Pareto front)
        a.rank < b.rank
    } else {
        // Same rank: prefer higher crowding distance (more diverse)
        a.crowding_distance > b.crowding_distance
    }
}

/// Tournament selection using NSGA-II criteria
pub fn nsga2_tournament_select<'a, R: rand::Rng + ?Sized>(
    population: &'a [MultiObjectiveIndividual],
    tournament_size: usize,
    rng: &mut R,
) -> &'a MultiObjectiveIndividual {
    let size = population.len().max(1);
    let mut best_index = rng.gen_range(0..size);

    for _ in 1..tournament_size {
        let candidate_index = rng.gen_range(0..size);
        if nsga2_compare(&population[candidate_index], &population[best_index]) {
            best_index = candidate_index;
        }
    }

    &population[best_index]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::Expr;

    #[test]
    fn test_dominance() {
        let a = MultiObjectiveIndividual::new(Expr::Const(1.0), 0.5);  // error=0.5, size=1
        let b = MultiObjectiveIndividual::new(
            Expr::Binary {
                op: crate::solver::BinaryOp::Add,
                left: Box::new(Expr::Const(1.0)),
                right: Box::new(Expr::Const(2.0)),
            },
            0.8,  // error=0.8, size=3
        );
        
        // a dominates b (better in both objectives)
        assert!(a.dominates(&b));
        assert!(!b.dominates(&a));
    }

    #[test]
    fn test_non_dominated_sort() {
        let individuals = vec![
            MultiObjectiveIndividual::new(Expr::Const(1.0), 0.5),  // Best error, smallest
            MultiObjectiveIndividual::new(Expr::Const(2.0), 0.3),  // Better error, same size
            MultiObjectiveIndividual::new(Expr::Const(3.0), 0.9),  // Worse on both
        ];
        
        let fronts = non_dominated_sort(&individuals);
        assert_eq!(fronts.len(), 2);  // Two fronts
        assert_eq!(fronts[0].len(), 2);  // Two non-dominated solutions
        assert_eq!(fronts[1].len(), 1);  // One dominated solution
    }
}
