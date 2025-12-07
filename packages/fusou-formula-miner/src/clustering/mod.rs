/// Clustering and classification module for automatic data partitioning
///
/// This module provides a framework for data-driven partitioning using various
/// clustering/classification algorithms. The goal is to decompose complex data
/// into regions where simple formulas can be discovered independently.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod classifiers;

#[cfg(feature = "clustering")]
pub use classifiers::DecisionTreeClassifier;

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
    /// Number of trees for random forest
    pub n_trees: usize,
}

impl Default for ClusteringConfig {
    fn default() -> Self {
        Self {
            method: "decision_tree".to_string(),
            max_depth: 3,
            min_samples_leaf: 50,
            num_clusters: 3,
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
            config.num_clusters,
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
