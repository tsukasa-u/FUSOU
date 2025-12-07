/// Smart initialization module for genetic algorithm
/// Implements intelligent seeding based on data analysis

use crate::dataset::Dataset;
use crate::solver::{Expr, BinaryOp, UnaryOp};
use rand::prelude::*;

#[derive(Clone, Debug)]
pub struct DataStats {
    /// Linear regression coefficients: y = a * x + b
    pub linear_coeff: f64,
    pub linear_intercept: f64,
    pub linear_r_squared: f64,

    /// Power law parameters: y = a * x^b
    pub power_coeff: f64,
    pub power_exponent: f64,
    pub power_r_squared: f64,

    /// Correlation coefficients for each feature (for weighted variable selection)
    pub feature_correlations: Vec<f64>,
}

impl DataStats {
    /// Analyze dataset and extract statistical properties
    pub fn analyze(dataset: &Dataset) -> Self {
        let data_pairs = dataset.to_pairs();

        // Calculate linear regression (y = a*x + b)
        let (linear_coeff, linear_intercept, linear_r2) =
            Self::linear_regression(&data_pairs);

        // Calculate power law fit (y = a*x^b)
        let (power_coeff, power_exponent, power_r2) =
            Self::power_fit(&data_pairs);

        // Calculate correlation for each feature
        let feature_correlations = Self::calculate_feature_correlations(dataset);

        Self {
            linear_coeff,
            linear_intercept,
            linear_r_squared: linear_r2,
            power_coeff,
            power_exponent,
            power_r_squared: power_r2,
            feature_correlations,
        }
    }

    /// Linear regression: y = a*x + b
    /// Uses first feature (Atk) as X for simplicity
    fn linear_regression(data: &[(Vec<f64>, f64)]) -> (f64, f64, f64) {
        if data.is_empty() {
            return (0.0, 0.0, 0.0);
        }

        let n = data.len() as f64;
        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut sum_xy = 0.0;
        let mut sum_x2 = 0.0;
        let mut sum_y2 = 0.0;

        for (features, y) in data {
            if let Some(&x) = features.first() {
                sum_x += x;
                sum_y += y;
                sum_xy += x * y;
                sum_x2 += x * x;
                sum_y2 += y * y;
            }
        }

        let mean_x = sum_x / n;
        let mean_y = sum_y / n;

        let numerator = sum_xy - n * mean_x * mean_y;
        let denominator = sum_x2 - n * mean_x * mean_x;

        if denominator.abs() < 1e-10 {
            return (0.0, mean_y, 0.0);
        }

        let a = numerator / denominator;
        let b = mean_y - a * mean_x;

        // Calculate R²
        let ss_res: f64 = data
            .iter()
            .map(|(features, y)| {
                let pred = a * features.first().copied().unwrap_or(0.0) + b;
                (y - pred).powi(2)
            })
            .sum();

        let ss_tot = sum_y2 - n * mean_y * mean_y;
        let r_squared = if ss_tot.abs() > 1e-10 {
            1.0 - (ss_res / ss_tot)
        } else {
            0.0
        };

        (a, b, r_squared.max(0.0))
    }

    /// Power law fit: y = a*x^b using log transform
    fn power_fit(data: &[(Vec<f64>, f64)]) -> (f64, f64, f64) {
        // Filter valid points (x > 0, y > 0)
        let valid_points: Vec<_> = data
            .iter()
            .filter(|(features, y)| {
                features.first().copied().unwrap_or(0.0) > 0.1 && *y > 0.1
            })
            .collect();

        if valid_points.len() < 3 {
            return (1.0, 1.0, 0.0);
        }

        let n = valid_points.len() as f64;
        let mut sum_logx = 0.0;
        let mut sum_logy = 0.0;
        let mut sum_logxy = 0.0;
        let mut sum_logx2 = 0.0;
        let mut sum_logy2 = 0.0;

        for (features, y) in &valid_points {
            if let Some(&x) = features.first() {
                let logx = x.ln();
                let logy = y.ln();
                sum_logx += logx;
                sum_logy += logy;
                sum_logxy += logx * logy;
                sum_logx2 += logx * logx;
                sum_logy2 += logy * logy;
            }
        }

        let mean_logx = sum_logx / n;
        let mean_logy = sum_logy / n;

        let numerator = sum_logxy - n * mean_logx * mean_logy;
        let denominator = sum_logx2 - n * mean_logx * mean_logx;

        if denominator.abs() < 1e-10 {
            return (1.0, 0.0, 0.0);
        }

        let b = numerator / denominator; // exponent
        let loga = mean_logy - b * mean_logx;
        let a = loga.exp();

        // Calculate R² for power fit
        let ss_res: f64 = valid_points
            .iter()
            .map(|(features, y)| {
                let x = features.first().copied().unwrap_or(1.0);
                let pred = a * x.powf(b);
                (y - pred).powi(2)
            })
            .sum();

        let ss_tot = sum_logy2 - n * mean_logy * mean_logy;
        let r_squared = if ss_tot.abs() > 1e-10 {
            1.0 - (ss_res / ss_tot)
        } else {
            0.0
        };

        (a, b, r_squared.max(0.0))
    }

    /// Calculate Pearson correlation for each feature
    fn calculate_feature_correlations(dataset: &Dataset) -> Vec<f64> {
        let data_pairs = dataset.to_pairs();
        let mut correlations = Vec::new();

        for feature_idx in 0..dataset.feature_names.len() {
            let values: Vec<f64> = data_pairs.iter().map(|(f, _)| f[feature_idx]).collect();
            let targets: Vec<f64> = data_pairs.iter().map(|(_, t)| *t).collect();

            let corr = Self::pearson_correlation(&values, &targets);
            correlations.push(corr.abs()); // Use absolute correlation
        }

        correlations
    }

    /// Calculate Pearson correlation coefficient
    fn pearson_correlation(x: &[f64], y: &[f64]) -> f64 {
        if x.len() != y.len() || x.is_empty() {
            return 0.0;
        }

        let n = x.len() as f64;
        let mean_x = x.iter().sum::<f64>() / n;
        let mean_y = y.iter().sum::<f64>() / n;

        let covariance: f64 = x
            .iter()
            .zip(y.iter())
            .map(|(&xi, &yi)| (xi - mean_x) * (yi - mean_y))
            .sum::<f64>()
            / n;

        let var_x: f64 = x.iter().map(|&xi| (xi - mean_x).powi(2)).sum::<f64>() / n;
        let var_y: f64 = y.iter().map(|&yi| (yi - mean_y).powi(2)).sum::<f64>() / n;

        if var_x.sqrt() * var_y.sqrt() > 1e-10 {
            covariance / (var_x.sqrt() * var_y.sqrt())
        } else {
            0.0
        }
    }
}

/// Smart initialization: creates population with informed guesses
use std::sync::mpsc::Sender;
use crate::state::AppEvent;

pub fn smart_init<R: Rng + ?Sized>(
    _dataset: &Dataset,
    stats: &DataStats,
    population_size: usize,
    max_depth: usize,
    num_vars: usize,
    rng: &mut R,
    progress_tx: Option<&Sender<AppEvent>>,
) -> Vec<Expr> {
    let mut population = Vec::new();

    // Approach 1: Add linear regression candidates if good fit
    if stats.linear_r_squared > 0.7 {
        if let Some(tx) = progress_tx {
            let _ = tx.send(AppEvent::Log(format!("Smart-init: linear pattern detected (R²: {:.3})", stats.linear_r_squared)));
        }
        let expr = create_linear_expr(0, stats.linear_coeff, stats.linear_intercept);
        population.push(expr.clone());
        {
            let mut _tmp_counts = std::collections::HashMap::new();
            population.push(crate::solver::mutate(&expr, rng, num_vars, max_depth, &mut _tmp_counts));
        }

        if population.len() < population_size {
            let expr2 = create_linear_expr(1, stats.linear_coeff * 0.5, stats.linear_intercept);
            population.push(expr2.clone());
            if population.len() < population_size {
                {
                    let mut _tmp_counts = std::collections::HashMap::new();
                    population.push(crate::solver::mutate(&expr2, rng, num_vars, max_depth, &mut _tmp_counts));
                }
            }
        }
    }

    // Add power law candidates if good fit
    if stats.power_r_squared > 0.7 && stats.power_exponent.abs() < 3.0 {
        if let Some(tx) = progress_tx {
            let _ = tx.send(AppEvent::Log(format!("Smart-init: power-law pattern detected (R²: {:.3})", stats.power_r_squared)));
        }
        let expr = create_power_expr(0, stats.power_coeff, stats.power_exponent);
        population.push(expr.clone());
        if population.len() < population_size {
                {
                    let mut _tmp_counts = std::collections::HashMap::new();
                    population.push(crate::solver::mutate(&expr, rng, num_vars, max_depth, &mut _tmp_counts));
                }
        }
    }

    // Fill remaining with weighted random expressions (Approach 2)
    // Fill remaining with weighted random expressions (Approach 2)
    let mut generated = 0usize;
    while population.len() < population_size {
        let expr = random_expr_weighted(rng, max_depth, num_vars, &stats.feature_correlations);
        population.push(expr);
        generated += 1;
        if let Some(tx) = progress_tx {
            // Send periodic progress every 10 generated or on completion
            if generated % 10 == 0 || population.len() == population_size {
                let _ = tx.send(AppEvent::Log(format!("Smart-init: generated {}/{} initial individuals", population.len(), population_size)));
            }
        }
    }

    population
}

/// Create linear expression: a*Var(idx) + b
fn create_linear_expr(var_idx: usize, coeff: f64, intercept: f64) -> Expr {
    Expr::Binary {
        op: BinaryOp::Add,
        left: Box::new(Expr::Binary {
            op: BinaryOp::Mul,
            left: Box::new(Expr::Var(var_idx)),
            right: Box::new(Expr::Const(coeff.clamp(-100.0, 100.0))),
        }),
        right: Box::new(Expr::Const(intercept.clamp(-100.0, 100.0))),
    }
}

/// Create power expression: a * Var(idx)^b
fn create_power_expr(var_idx: usize, coeff: f64, exponent: f64) -> Expr {
    // exponent currently not directly encoded as a numeric power node; use Pow unary op as placeholder
    let base = Expr::Var(var_idx);
    let pow_expr = Expr::Unary {
        op: UnaryOp::Pow,
        child: Box::new(base),
    };
    Expr::Binary {
        op: BinaryOp::Mul,
        left: Box::new(Expr::Const(coeff.clamp(-10.0, 10.0))),
        right: Box::new(pow_expr),
    }
}

/// Generate random expression weighted by feature correlation
/// Higher correlation features are selected with higher probability
fn random_expr_weighted<R: Rng + ?Sized>(
    rng: &mut R,
    max_depth: usize,
    num_vars: usize,
    correlations: &[f64],
) -> Expr {
    if max_depth == 0 {
        return random_leaf_weighted(rng, num_vars, correlations);
    }

    match rng.gen_range(0..5) {
        0 | 1 => Expr::Binary {
            op: random_binary_op(rng),
            left: Box::new(random_expr_weighted(
                rng,
                max_depth - 1,
                num_vars,
                correlations,
            )),
            right: Box::new(random_expr_weighted(
                rng,
                max_depth - 1,
                num_vars,
                correlations,
            )),
        },
        2 => Expr::Unary {
            op: random_unary_op(rng),
            child: Box::new(random_expr_weighted(
                rng,
                max_depth - 1,
                num_vars,
                correlations,
            )),
        },
        _ => random_leaf_weighted(rng, num_vars, correlations),
    }
}

/// Select leaf node with correlation-weighted probability
fn random_leaf_weighted<R: Rng + ?Sized>(
    rng: &mut R,
    num_vars: usize,
    correlations: &[f64],
) -> Expr {
    if num_vars > 0 && correlations.len() >= num_vars {
        // Weighted choice: higher correlation = higher probability
        if let Some(idx) = weighted_choice(rng, &correlations[..num_vars]) {
            return Expr::Var(idx);
        }
    }

    // Fallback to constant
    Expr::Const(random_constant(rng))
}

/// Weighted random choice based on probabilities
fn weighted_choice<R: Rng + ?Sized>(rng: &mut R, weights: &[f64]) -> Option<usize> {
    let sum: f64 = weights.iter().sum();
    if sum <= 0.0 {
        return None;
    }

    let normalized: Vec<f64> = weights.iter().map(|w| w / sum).collect();
    let mut cumulative = 0.0;
    let r = rng.gen::<f64>();

    for (idx, &prob) in normalized.iter().enumerate() {
        cumulative += prob;
        if r < cumulative {
            return Some(idx);
        }
    }

    Some(weights.len() - 1)
}

fn random_binary_op<R: Rng + ?Sized>(rng: &mut R) -> BinaryOp {
    match rng.gen_range(0..6) {
        0 => BinaryOp::Add,
        1 => BinaryOp::Sub,
        2 => BinaryOp::Mul,
        3 => BinaryOp::Div,
        4 => BinaryOp::Min,
        _ => BinaryOp::Max,
    }
}

fn random_unary_op<R: Rng + ?Sized>(rng: &mut R) -> UnaryOp {
    // Include all unary operators to allow step, log, sqrt to be discovered
    match rng.gen_range(0..7) {
        0 => UnaryOp::Identity,
        1 => UnaryOp::Floor,
        2 => UnaryOp::Exp,
        3 => UnaryOp::Pow,
        4 => UnaryOp::Step,
        5 => UnaryOp::Log,
        _ => UnaryOp::Sqrt,
    }
}

fn random_constant<R: Rng + ?Sized>(rng: &mut R) -> f64 {
    let base = rng.gen_range(-5.0..5.0);
    let jitter = rng.gen_range(-0.25..0.25);
    (base + jitter) as f64
}
