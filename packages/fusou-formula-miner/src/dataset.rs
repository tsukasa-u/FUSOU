use crate::statistics::{calculate_correlation, calculate_variance};
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

/// In-memory dataset representation shared by the preprocessing and solver stages.
#[derive(Clone, Debug)]
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

    pub fn len(&self) -> usize {
        self.targets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.targets.is_empty()
    }

    /// Filter features based on absolute correlation threshold and variance.
    /// Ensures that at least one feature survives (fallbacks to top correlated feature otherwise).
    pub fn filter_features(&self, correlation_threshold: f64) -> (Vec<usize>, Vec<String>) {
        let mut stats = Vec::with_capacity(self.feature_names.len());
        let mut logs = Vec::new();

        for (i, name) in self.feature_names.iter().enumerate() {
            let feature_values: Vec<f64> = self.inputs.iter().map(|row| row[i]).collect();
            let variance = calculate_variance(&feature_values);
            if variance < 1e-12 {
                logs.push(format!("Excluded '{}' (zero variance)", name));
                continue;
            }
            let corr = calculate_correlation(&feature_values, &self.targets);
            stats.push((i, name.clone(), corr));
        }

        stats.sort_by(|a, b| {
            b.2.abs()
                .partial_cmp(&a.2.abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut selected_indices = Vec::new();
        for (idx, name, corr) in &stats {
            if corr.abs() >= correlation_threshold {
                logs.push(format!("Selected '{}' (correlation: {:.3})", name, corr));
                selected_indices.push(*idx);
            } else {
                logs.push(format!("Excluded '{}' (correlation: {:.3})", name, corr));
            }
        }

        if selected_indices.is_empty() {
            if let Some((idx, name, corr)) = stats.first() {
                logs.push(format!(
                    "Selected '{}' despite low correlation (best available {:.3})",
                    name, corr
                ));
                selected_indices.push(*idx);
            }
        }

        (selected_indices, logs)
    }

    pub fn apply_selection(&self, indices: &[usize]) -> Dataset {
        let new_names = indices
            .iter()
            .map(|&i| self.feature_names[i].clone())
            .collect();
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

    pub fn to_pairs(&self) -> Vec<(Vec<f64>, f64)> {
        self.inputs
            .iter()
            .zip(self.targets.iter())
            .map(|(inp, &targ)| (inp.clone(), targ))
            .collect()
    }

    pub fn feature_names_as_str(&self) -> Vec<&str> {
        self.feature_names.iter().map(|s| s.as_str()).collect()
    }
}

/// Raw job payload returned by the coordination server.
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteJobPayload {
    pub job_id: Uuid,
    #[serde(default)]
    pub chunk_id: Option<Uuid>,
    #[serde(default)]
    pub max_generations: Option<u64>,
    #[serde(default)]
    pub target_error: Option<f64>,
    #[serde(default = "RemoteJobPayload::default_correlation_threshold")]
    pub correlation_threshold: f64,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub samples: Vec<RemoteJobSample>,
}

impl RemoteJobPayload {
    const fn default_correlation_threshold() -> f64 {
        0.1
    }

    pub fn ensure_dataset(&self) -> Result<Dataset> {
        if self.samples.is_empty() {
            bail!("job payload contained no samples");
        }

        let feature_order = self.compute_feature_order()?;
        let mut dataset = Dataset::new(feature_order.clone());

        for sample in &self.samples {
            let row = sample
                .materialize_row(&feature_order)
                .with_context(|| "failed to build feature vector from sample")?;
            dataset.add_sample(row, sample.target);
        }

        Ok(dataset)
    }

    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }

    fn compute_feature_order(&self) -> Result<Vec<String>> {
        if !self.features.is_empty() {
            return Ok(self.features.clone());
        }

        // Derive feature names from payload data.
        let mut derived_names: BTreeSet<String> = BTreeSet::new();
        let mut max_vector_len = 0usize;

        for sample in &self.samples {
            if !sample.inputs.is_empty() {
                max_vector_len = max_vector_len.max(sample.inputs.len());
            }
            for key in sample
                .build_feature_map()
                .with_context(|| "failed to prepare feature map")?
                .keys()
            {
                derived_names.insert(key.clone());
            }
        }

        if !derived_names.is_empty() {
            return Ok(derived_names.into_iter().collect());
        }

        if max_vector_len == 0 {
            bail!("unable to infer feature names from job payload");
        }

        Ok((0..max_vector_len).map(|i| format!("x{}", i)).collect())
    }
}

/// Remote sample representation supporting both flattened vectors and nested JSON objects.
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteJobSample {
    #[serde(default)]
    pub inputs: Vec<f64>,
    #[serde(default)]
    pub target: f64,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub features: BTreeMap<String, f64>,
}

impl RemoteJobSample {
    fn materialize_row(&self, feature_names: &[String]) -> Result<Vec<f64>> {
        if !self.inputs.is_empty() {
            if self.inputs.len() != feature_names.len() {
                bail!(
                    "payload vector length {} did not match feature list length {}",
                    self.inputs.len(),
                    feature_names.len()
                );
            }
            return Ok(self.inputs.clone());
        }

        let feature_map = self.build_feature_map()?;
        let row = feature_names
            .iter()
            .map(|name| *feature_map.get(name).unwrap_or(&0.0))
            .collect();
        Ok(row)
    }

    fn build_feature_map(&self) -> Result<BTreeMap<String, f64>> {
        if !self.features.is_empty() {
            return Ok(self.features.clone());
        }

        let mut map = BTreeMap::new();
        if !self.input.is_null() {
            flatten_value(None, &self.input, &mut map);
        }

        if map.is_empty() && self.inputs.is_empty() {
            bail!("sample did not contain any numeric features");
        }

        Ok(map)
    }
}

fn flatten_value(prefix: Option<&str>, value: &Value, out: &mut BTreeMap<String, f64>) {
    match value {
        Value::Number(num) => {
            if let Some(v) = num.as_f64() {
                let key = prefix
                    .map(String::from)
                    .unwrap_or_else(|| "value".to_string());
                out.insert(key, v);
            }
        }
        Value::Bool(flag) => {
            let key = prefix
                .map(String::from)
                .unwrap_or_else(|| "flag".to_string());
            out.insert(key, if *flag { 1.0 } else { 0.0 });
        }
        Value::Array(arr) => {
            for (idx, item) in arr.iter().enumerate() {
                let key = match prefix {
                    Some(p) => format!("{}[{}]", p, idx),
                    None => format!("[{}]", idx),
                };
                flatten_value(Some(&key), item, out);
            }
        }
        Value::Object(obj) => {
            for (key, val) in obj.iter() {
                let next = match prefix {
                    Some(p) => format!("{}.{}", p, key),
                    None => key.clone(),
                };
                flatten_value(Some(&next), val, out);
            }
        }
        Value::Null => {}
        Value::String(_) => {}
    }
}

/// Convenience helper used by tests and the synthetic fallback dataset.
/// Generate a synthetic dataset for the requested dataset `kind`.
/// Supported kinds: "A" (simple linear), "B" (moderate nonlinear/step), "C" (more complex interactions + noise)
pub fn synthetic_dataset_for(kind: &str, cfg: &crate::config::SyntheticDataConfig) -> Dataset {
    use rand::Rng;

    let mut rng = rand::thread_rng();
    let mut dataset = Dataset::new(vec![
        "Atk".into(),
        "Def".into(),
        "Luck".into(),
        "MapID".into(),
        "Timestamp".into(),
    ]);

    let samples = cfg.sample_count;
    for i in 0..samples {
        let atk = rng.gen_range(cfg.atk_min..cfg.atk_max);
        let def = rng.gen_range(cfg.def_min..cfg.def_max);
        let luck = rng.gen_range(cfg.luck_min..cfg.luck_max);
        let map_id_i = rng.gen_range(0..cfg.map_id_max);
        let map_id = map_id_i as f64;
        let timestamp = i as f64;

        let target = match kind {
            "A" | "a" => {
                // Type A: very simple linear relation with small noise
                let base = (atk - def).max(cfg.min_damage);
                let noise = rng.gen_range(-0.5..0.5);
                (base + noise).max(cfg.min_damage)
            }
            "B" | "b" => {
                // Type B: moderate nonlinearity with step-based crit and a small map effect
                let diff = (atk - def).max(0.0);
                let crit = if luck > cfg.crit_luck_threshold { diff * cfg.crit_multiplier } else { diff };
                let map_effect = 1.0 + (map_id_i % 3) as f64 * 0.05; // small multiplier per map
                let noise = rng.gen_range(-1.0..1.0);
                ((crit.max(cfg.min_damage)) * map_effect + noise).max(cfg.min_damage)
            }
            _ => {
                // Type C: more complex interactions, multiplicative terms, timestamp trend and heteroscedastic noise
                let diff = (atk - def).max(0.0);
                // non-linear interaction between atk and luck
                let luck_factor = 1.0 + (luck / 100.0).powf(1.5);
                let time_trend = 1.0 + (timestamp / (samples as f64)).powf(0.5) * 0.2;
                let map_bias = ((map_id_i % 5) as f64 - 2.0) * 0.1; // positive/negative offsets
                let base = (diff * luck_factor * time_trend).max(cfg.min_damage) + map_bias;
                // Heteroscedastic noise proportional to base magnitude
                let noise = rng.gen_range(-0.05..0.05) * base.abs();
                (base + noise).max(cfg.min_damage)
            }
        };

        dataset.add_sample(vec![atk, def, luck, map_id, timestamp], target);
    }

    dataset
}

// Backwards-compatible simple synthetic_dataset that uses default config A
pub fn synthetic_dataset() -> Dataset {
    let cfg = crate::config::MinerConfig::default().synthetic_data;
    synthetic_dataset_for(&cfg.dataset_type, &cfg)
}
