/// Clustering and classification module for automatic data partitioning
///
/// This module provides a framework for data-driven partitioning using various
/// clustering/classification algorithms. The goal is to decompose complex data
/// into regions where simple formulas can be discovered independently.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod classifiers;
pub mod per_cluster_ga;
pub mod cluster_optimizer;

#[cfg(feature = "clustering")]
pub use classifiers::DecisionTreeClassifier;
pub use per_cluster_ga::*;
pub use cluster_optimizer::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusteringConfig {
    /// Which clustering method to use: "decision_tree", "random_forest", "kmeans", "svm"
    pub method: String,
    /// Maximum depth for tree-based methods
    pub max_depth: u16,
    /// Minimum samples per leaf
    pub min_samples_leaf: usize,
    /// Number of clusters for k-means
    pub num_clusters: usize,
    /// Maximum candidate k to try when `num_clusters == 0` (auto-estimate)
    pub max_k: usize,
    /// Silhouette score threshold below which we consider data as single cluster
    pub silhouette_threshold: f64,
    /// Number of trees for random forest
    pub n_trees: usize,
}

impl Default for ClusteringConfig {
    fn default() -> Self {
        Self {
            method: "kmeans".to_string(), // Changed to kmeans for better default
            max_depth: 3,
            min_samples_leaf: 50,
            // 0 means: auto-estimate cluster count (use silhouette-based heuristic)
            num_clusters: 0,
            max_k: 6,
            silhouette_threshold: -0.2, // Much lower threshold to allow clustering when beneficial
            n_trees: 10,
        }
    }
}

/// Result of clustering: each sample is assigned a group/cluster ID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterAssignment {
    /// Cluster ID for each sample
    pub assignments: Vec<usize>,
    /// Number of distinct clusters
    pub num_clusters: usize,
    /// Size of each cluster
    pub cluster_sizes: HashMap<usize, usize>,
    /// Metadata about the clustering (e.g., decision rules, centroids)
    pub metadata: ClusterMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterMetadata {
    /// Method used
    pub method: String,
    /// Optional rule descriptions (for tree-based methods)
    pub rules: Vec<String>,
    /// Cluster quality metric (0.0 - 1.0)
    pub quality_score: f64,
    /// Mean feature vectors for each cluster
    pub centroids: Vec<Vec<f64>>,
    /// Human-readable conditions like "x > 0.5 AND y < 2.0"
    pub cluster_conditions: Vec<String>,
}

impl ClusterAssignment {
    /// Get samples belonging to cluster `cluster_id`
    pub fn get_cluster_samples(&self, cluster_id: usize) -> Vec<usize> {
        self.assignments
            .iter()
            .enumerate()
            .filter(|(_, &c)| c == cluster_id)
            .map(|(idx, _)| idx)
            .collect()
    }
}

/// Public interface: simple clustering given features and targets
#[cfg(feature = "clustering")]
pub fn auto_cluster(
    features: &[Vec<f64>],
    targets: &[f64],
    config: &ClusteringConfig,
) -> anyhow::Result<ClusterAssignment> {
    match config.method.as_str() {
        "decision_tree" => classifiers::decision_tree::cluster_by_tree(
            features,
            targets,
            config.max_depth,
            config.min_samples_leaf,
        ),
        "random_forest" => {
            // Fallback to decision tree for now; full RF support can be added later
            classifiers::decision_tree::cluster_by_tree(
                features,
                targets,
                config.max_depth,
                config.min_samples_leaf,
            )
        }
        "kmeans" => classifiers::kmeans::cluster_by_kmeans(
            features,
            targets,
            config,
        ),
        "svm" => classifiers::svm::cluster_by_svm(features, targets),
        _ => anyhow::bail!("Unknown clustering method: {}", config.method),
    }
}

#[cfg(not(feature = "clustering"))]
pub fn auto_cluster(
    _features: &[Vec<f64>],
    _targets: &[f64],
    _config: &ClusteringConfig,
) -> anyhow::Result<ClusterAssignment> {
    anyhow::bail!("Clustering feature not enabled. Build with --features clustering")
}
