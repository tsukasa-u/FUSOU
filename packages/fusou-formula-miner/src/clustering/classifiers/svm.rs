#[cfg(feature = "clustering")]
pub mod svm_impl {
    use crate::clustering::{ClusterAssignment, ClusterMetadata};
    use std::collections::HashMap;

    pub fn cluster_by_svm(
        features: &[Vec<f64>],
        targets: &[f64],
    ) -> anyhow::Result<ClusterAssignment> {
        if features.is_empty() || targets.is_empty() {
            anyhow::bail!("Empty features or targets");
        }

        // Simple SVM-inspired clustering: use target values to partition
        // In a real SVM, we would use kernel methods and optimization.
        // Here we use a simple heuristic: threshold targets at median.

        let num_samples = targets.len();
        let mut sorted_targets: Vec<(f64, usize)> = targets
            .iter()
            .copied()
            .enumerate()
            .map(|(i, t)| (t, i))
            .collect();
        sorted_targets.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        let median = if num_samples % 2 == 0 {
            (sorted_targets[num_samples / 2 - 1].0 + sorted_targets[num_samples / 2].0) / 2.0
        } else {
            sorted_targets[num_samples / 2].0
        };

        let mut assignments = vec![0; num_samples];
        let mut cluster_sizes = HashMap::new();

        for (i, &t) in targets.iter().enumerate() {
            let cluster = if t < median { 0 } else { 1 };
            assignments[i] = cluster;
            *cluster_sizes.entry(cluster).or_insert(0) += 1;
        }

        let num_clusters = 2;

        Ok(ClusterAssignment {
            assignments,
            num_clusters,
            cluster_sizes,
            metadata: ClusterMetadata {
                method: "svm".to_string(),
                rules: vec![format!("SVM-inspired binary split at target median: {}", median)],
                quality_score: 0.7,
            },
        })
    }
}

#[cfg(not(feature = "clustering"))]
pub mod svm_impl {
    use crate::clustering::ClusterAssignment;

    pub fn cluster_by_svm(
        _features: &[Vec<f64>],
        _targets: &[f64],
    ) -> anyhow::Result<ClusterAssignment> {
        anyhow::bail!("Clustering feature not enabled")
    }
}

pub use svm_impl::*;

/// Public re-export for SVM clustering
pub fn cluster_by_svm(
    features: &[Vec<f64>],
    targets: &[f64],
) -> anyhow::Result<crate::clustering::ClusterAssignment> {
    svm_impl::cluster_by_svm(features, targets)
}
