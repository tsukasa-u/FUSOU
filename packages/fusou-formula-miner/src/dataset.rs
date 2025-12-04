use crate::statistics::{calculate_correlation, calculate_variance};

#[derive(Clone)]
pub struct Dataset {
    pub feature_names: Vec<String>,
    pub inputs: Vec<Vec<f64>>,
    pub targets: Vec<f64>,
}

impl Dataset {
    pub fn new(feature_names: Vec<String>) -> Self {
        Self {
            feature_names,
            inputs: Vec::new(),
            targets: Vec::new(),
        }
    }

    pub fn add_sample(&mut self, features: Vec<f64>, target: f64) {
        self.inputs.push(features);
        self.targets.push(target);
    }

    /// Filter features based on correlation threshold and variance
    /// Returns selected indices and log messages
    pub fn filter_features(&self, correlation_threshold: f64) -> (Vec<usize>, Vec<String>) {
        let mut selected_indices = Vec::new();
        let mut logs = Vec::new();

        for (i, name) in self.feature_names.iter().enumerate() {
            let feature_values: Vec<f64> = self.inputs.iter().map(|row| row[i]).collect();
            let variance = calculate_variance(&feature_values);
            if variance < 1e-9 {
                logs.push(format!("Excluded '{}' (zero variance)", name));
                continue;
            }
            let corr = calculate_correlation(&feature_values, &self.targets);
            if corr.abs() < correlation_threshold {
                logs.push(format!("Excluded '{}' (correlation: {:.3})", name, corr));
            } else {
                logs.push(format!("Selected '{}' (correlation: {:.3})", name, corr));
                selected_indices.push(i);
            }
        }

        (selected_indices, logs)
    }

    /// Create a new dataset with only selected features
    pub fn apply_selection(&self, indices: &[usize]) -> Dataset {
        let new_names = indices.iter().map(|&i| self.feature_names[i].clone()).collect();
        let new_inputs = self
            .inputs
            .iter()
            .map(|row| indices.iter().map(|&i| row[i]).collect())
            .collect();
        Dataset {
            feature_names: new_names,
            inputs: new_inputs,
            targets: self.targets.clone(),
        }
    }

    /// Convert to (inputs, target) pairs for solver
    pub fn to_pairs(&self) -> Vec<(Vec<f64>, f64)> {
        self.inputs
            .iter()
            .zip(self.targets.iter())
            .map(|(inp, &targ)| (inp.clone(), targ))
            .collect()
    }

    /// Get feature names as string slices
    pub fn feature_names_as_str(&self) -> Vec<&str> {
        self.feature_names.iter().map(|s| s.as_str()).collect()
    }
}
