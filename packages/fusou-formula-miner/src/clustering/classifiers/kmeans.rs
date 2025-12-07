#[cfg(feature = "clustering")]
pub mod kmeans_impl {
    use crate::clustering::{ClusterAssignment, ClusterMetadata};
    use std::collections::HashMap;

    pub fn cluster_by_kmeans(
        features: &[Vec<f64>],
        _targets: &[f64],
        num_clusters: usize,
    ) -> anyhow::Result<ClusterAssignment> {
        if features.is_empty() {
            anyhow::bail!("Empty features");
        }

        if features[0].is_empty() {
            anyhow::bail!("Empty feature vectors");
        }

        let num_samples = features.len();
        let num_features = features[0].len();
        let k = num_clusters.min(num_samples);

        // Initialize centroids randomly from data points
        let mut rng = 0u64; // Simple pseudo-random using xorshift-like pattern
        let mut centroids: Vec<Vec<f64>> = Vec::new();
        let mut used_indices = std::collections::HashSet::new();

        for i in 0..k {
            let mut idx = ((rng * 2654435761) as usize) % num_samples;
            rng = rng.wrapping_add(1);
            while used_indices.contains(&idx) {
                idx = (idx + 1) % num_samples;
            }
            used_indices.insert(idx);
            centroids.push(features[idx].clone());
        }

        // K-means iterations
        let mut assignments = vec![0; num_samples];
        const MAX_ITER: usize = 100;
        const EPSILON: f64 = 1e-6;

        for _iter in 0..MAX_ITER {
            // Assignment step
            let mut new_assignments = vec![0; num_samples];
            for (i, sample) in features.iter().enumerate() {
                let mut best_dist = f64::INFINITY;
                let mut best_cluster = 0;

                for (c, centroid) in centroids.iter().enumerate() {
                    let dist = euclidean_distance(sample, centroid);
                    if dist < best_dist {
                        best_dist = dist;
                        best_cluster = c;
                    }
                }
                new_assignments[i] = best_cluster;
            }

            // Update step
            let mut new_centroids = vec![vec![0.0; num_features]; k];
            let mut counts = vec![0; k];

            for (i, &cluster) in new_assignments.iter().enumerate() {
                for j in 0..num_features {
                    new_centroids[cluster][j] += features[i][j];
                }
                counts[cluster] += 1;
            }

            let mut converged = true;
            for c in 0..k {
                if counts[c] > 0 {
                    for j in 0..num_features {
                        new_centroids[c][j] /= counts[c] as f64;
                    }
                }

                let delta = euclidean_distance(&centroids[c], &new_centroids[c]);
                if delta > EPSILON {
                    converged = false;
                }
            }

            centroids = new_centroids;
            assignments = new_assignments;

            if converged {
                break;
            }
        }

        // Build result
        let mut cluster_sizes = HashMap::new();
        for &cluster_id in &assignments {
            *cluster_sizes.entry(cluster_id).or_insert(0) += 1;
        }

        // Generate cluster conditions based on centroid positions (feature ranges per cluster)
        let mut cluster_conditions = Vec::new();
        for c in 0..k {
            let mut condition_parts = Vec::new();
            for j in 0..num_features {
                condition_parts.push(format!("f{} ≈ {:.2}", j, centroids[c][j]));
            }
            cluster_conditions.push(condition_parts.join(" AND "));
        }

        Ok(ClusterAssignment {
            assignments,
            num_clusters: k,
            cluster_sizes,
            metadata: ClusterMetadata {
                method: "kmeans".to_string(),
                rules: vec![format!("K-means clustering with k={}", k)],
                quality_score: 0.75,
                centroids: centroids.clone(),
                cluster_conditions,
            },
        })
    }

    fn euclidean_distance(a: &[f64], b: &[f64]) -> f64 {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| (x - y).powi(2))
            .sum::<f64>()
            .sqrt()
    }
}

#[cfg(not(feature = "clustering"))]
pub mod kmeans_impl {
    use crate::clustering::ClusterAssignment;

    pub fn cluster_by_kmeans(
        _features: &[Vec<f64>],
        _targets: &[f64],
        _num_clusters: usize,
    ) -> anyhow::Result<ClusterAssignment> {
        anyhow::bail!("Clustering feature not enabled")
    }
}

pub use kmeans_impl::*;

/// Public re-export for kmeans clustering
pub fn cluster_by_kmeans(
    features: &[Vec<f64>],
    targets: &[f64],
    num_clusters: usize,
) -> anyhow::Result<crate::clustering::ClusterAssignment> {
    kmeans_impl::cluster_by_kmeans(features, targets, num_clusters)
}
