#[cfg(feature = "clustering")]
pub mod kmeans_impl {
    use crate::clustering::{ClusterAssignment, ClusterMetadata};
    use std::collections::HashMap;

    pub fn cluster_by_kmeans(
        features: &[Vec<f64>],
        _targets: &[f64],
        config: &crate::clustering::ClusteringConfig,
    ) -> anyhow::Result<ClusterAssignment> {
        if features.is_empty() {
            anyhow::bail!("Empty features");
        }

        if features[0].is_empty() {
            anyhow::bail!("Empty feature vectors");
        }

        let num_samples = features.len();
        let num_features = features[0].len();
        // Determine k: if num_clusters == 0, perform automatic k selection using silhouette score
        let k = if config.num_clusters == 0 {
            // auto-select k in range [1, max_k]
            let max_k = std::cmp::min(config.max_k, num_samples);
            if num_samples < 2 {
                1usize
            } else {
                // try k from 2..=max_k, compute silhouette, choose best; if best small, choose 1
                let mut best_k = 1usize;
                let mut best_score = f64::MIN;
                for cand_k in 2..=max_k {
                    if let Ok(assign) = try_kmeans_once(features, cand_k) {
                        let score = average_silhouette(features, &assign);
                        if score.is_finite() && score > best_score {
                            best_score = score;
                            best_k = cand_k;
                        }
                    }
                }
                // If best silhouette is low, fallback to 1 cluster
                if best_score < config.silhouette_threshold { 1usize } else { best_k }
            }
        } else {
            config.num_clusters.min(num_samples)
        };

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

    // Try running k-means once and return assignments (used for candidate evaluation)
    fn try_kmeans_once(features: &[Vec<f64>], num_clusters: usize) -> anyhow::Result<Vec<usize>> {
        // This is a lightweight k-means run: single init, limited iterations
        let num_samples = features.len();
        let num_features = features[0].len();
        let k = num_clusters.min(num_samples);
        let mut rng = 0u64;
        let mut centroids: Vec<Vec<f64>> = Vec::new();
        let mut used_indices = std::collections::HashSet::new();
        for _ in 0..k {
            let mut idx = ((rng * 2654435761) as usize) % num_samples;
            rng = rng.wrapping_add(1);
            while used_indices.contains(&idx) {
                idx = (idx + 1) % num_samples;
            }
            used_indices.insert(idx);
            centroids.push(features[idx].clone());
        }
        let mut assignments = vec![0; num_samples];
        const MAX_ITER: usize = 30;
        const EPSILON: f64 = 1e-6;
        for _iter in 0..MAX_ITER {
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
            if converged { break; }
        }
        Ok(assignments)
    }

    // Compute average silhouette score for the given assignments (range -1..1)
    fn average_silhouette(features: &[Vec<f64>], assignments: &[usize]) -> f64 {
        let n = features.len();
        if n == 0 { return 0.0; }
        // Build clusters
        let mut clusters: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
        for (i, &c) in assignments.iter().enumerate() {
            clusters.entry(c).or_insert_with(Vec::new).push(i);
        }
        if clusters.len() <= 1 { return 0.0; }

        // Precompute distances if small n; else compute on the fly
        let mut total_s = 0.0f64;
        for i in 0..n {
            let c_i = assignments[i];
            // a = average distance to other points in same cluster
            let in_cluster = &clusters[&c_i];
            let a = if in_cluster.len() <= 1 {
                0.0
            } else {
                let mut sum = 0.0;
                for &j in in_cluster.iter() {
                    if j == i { continue; }
                    sum += euclidean_distance(&features[i], &features[j]);
                }
                sum / ((in_cluster.len() - 1) as f64)
            };

            // b = min average distance to points in other clusters
            let mut b = f64::INFINITY;
            for (&c, members) in clusters.iter() {
                if c == c_i { continue; }
                let mut sum = 0.0;
                for &j in members.iter() {
                    sum += euclidean_distance(&features[i], &features[j]);
                }
                let avg = sum / (members.len() as f64);
                if avg < b { b = avg; }
            }

            let denom = a.max(b);
            let s = if denom == 0.0 { 0.0 } else { (b - a) / denom };
            total_s += s;
        }
        total_s / (n as f64)
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

/// Public re-export for kmeans clustering (adapter signature)
pub fn cluster_by_kmeans(
    features: &[Vec<f64>],
    targets: &[f64],
    config: &crate::clustering::ClusteringConfig,
) -> anyhow::Result<crate::clustering::ClusterAssignment> {
    kmeans_impl::cluster_by_kmeans(features, targets, config)
}
