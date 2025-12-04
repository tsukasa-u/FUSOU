/// Calculate Pearson correlation coefficient between two vectors
pub fn calculate_correlation(x: &[f64], y: &[f64]) -> f64 {
    if x.len() != y.len() || x.is_empty() {
        return 0.0;
    }
    let n = x.len() as f64;
    let mean_x: f64 = x.iter().sum::<f64>() / n;
    let mean_y: f64 = y.iter().sum::<f64>() / n;
    let cov: f64 = x
        .iter()
        .zip(y.iter())
        .map(|(xi, yi)| (xi - mean_x) * (yi - mean_y))
        .sum();
    let var_x: f64 = x.iter().map(|xi| (xi - mean_x).powi(2)).sum();
    let var_y: f64 = y.iter().map(|yi| (yi - mean_y).powi(2)).sum();
    if var_x < 1e-9 || var_y < 1e-9 {
        return 0.0;
    }
    cov / (var_x.sqrt() * var_y.sqrt())
}

/// Calculate variance of a vector
pub fn calculate_variance(x: &[f64]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    let mean: f64 = x.iter().sum::<f64>() / x.len() as f64;
    x.iter().map(|xi| (xi - mean).powi(2)).sum::<f64>() / x.len() as f64
}
