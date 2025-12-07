/// Residual learning module (Approach 3: Boosting-like residual fitting)
/// 
/// Instead of trying to fit the entire dataset at once, this approach:
/// 1. Find a simple model that fits most of the data well
/// 2. Calculate residuals (y - predicted_y)
/// 3. Try to fit a model to these residuals
/// 4. Combine: final_prediction = model1(x) + model2(x)

use crate::engine::dataset::Dataset;
use crate::solver::Expr;

#[derive(Clone, Debug)]
pub struct ResidualDataset {
    /// The original dataset
    pub base_dataset: Dataset,
    /// Current residuals to fit
    pub residuals: Vec<f64>,
    /// Number of boosting iterations completed
    pub iteration: usize,
}

impl ResidualDataset {
    /// Create residual dataset from original dataset
    pub fn new(dataset: Dataset) -> Self {
        let residuals = dataset.targets.clone();
        Self {
            base_dataset: dataset,
            residuals,
            iteration: 0,
        }
    }

    /// Update residuals after fitting a model
    /// Returns new ResidualDataset with residuals for next iteration
    pub fn with_residuals(&self, predictions: &[f64]) -> Self {
        let mut new_residuals = self.residuals.clone();
        for (i, &pred) in predictions.iter().enumerate() {
            if i < new_residuals.len() {
                new_residuals[i] -= pred;
            }
        }

        Self {
            base_dataset: self.base_dataset.clone(),
            residuals: new_residuals,
            iteration: self.iteration + 1,
        }
    }

    /// Convert to pairs for solver use
    pub fn to_pairs(&self) -> Vec<(Vec<f64>, f64)> {
        self.base_dataset
            .inputs
            .iter()
            .zip(self.residuals.iter())
            .map(|(inp, &res)| (inp.clone(), res))
            .collect()
    }
}

/// Ensembles multiple expressions by adding them (for residual combination)
#[derive(Clone, Debug)]
pub struct ExpressionEnsemble {
    pub expressions: Vec<Expr>,
}

impl ExpressionEnsemble {
    pub fn new() -> Self {
        Self {
            expressions: Vec::new(),
        }
    }

    pub fn add(&mut self, expr: Expr) {
        self.expressions.push(expr);
    }

    /// Evaluate ensemble by summing predictions from all expressions
    pub fn eval(&self, vars: &[f64]) -> f64 {
        self.expressions
            .iter()
            .map(|expr| expr.eval(vars))
            .sum::<f64>()
            .clamp(-1_000_000.0, 1_000_000.0)
    }

    /// Get size (total nodes) across all expressions
    pub fn size(&self) -> usize {
        self.expressions.iter().map(|expr| expr.size()).sum()
    }

    /// Convert to readable string (shows all expressions)
    pub fn to_string(&self, var_names: &[&str]) -> String {
        if self.expressions.is_empty() {
            return "0.0".into();
        }

        let expr_strs: Vec<String> = self
            .expressions
            .iter()
            .map(|expr| expr.to_string(var_names))
            .collect();

        expr_strs.join(" + ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_residual_dataset() {
        let dataset = Dataset::new(vec!["x".into()]);
        let mut res_ds = ResidualDataset::new(dataset);
        res_ds.residuals = vec![10.0, 20.0, 30.0];

        let predictions = vec![3.0, 5.0, 7.0];
        let new_ds = res_ds.with_residuals(&predictions);

        assert_eq!(new_ds.residuals, vec![7.0, 15.0, 23.0]);
        assert_eq!(new_ds.iteration, 1);
    }
}
