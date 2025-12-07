//! Selection operators for genetic algorithm

use rand::Rng;
use crate::solver::Expr;

/// Individual in the population
#[derive(Clone)]
pub struct Individual {
    pub expr: Expr,
    pub fitness: f64,
}

/// Tournament selection: choose best individual from random tournament
pub fn tournament_select<'a, R: Rng + ?Sized>(
    population: &'a [Individual],
    tournament_size: usize,
    rng: &mut R,
) -> &'a Individual {
    let size = population.len().max(1);
    let mut best_index = rng.gen_range(0..size);
    let mut best_fitness = population[best_index].fitness;
    
    for _ in 1..tournament_size {
        let index = rng.gen_range(0..size);
        let fitness = population[index].fitness;
        if fitness < best_fitness {
            best_fitness = fitness;
            best_index = index;
        }
    }
    
    &population[best_index]
}
