/// Per-cluster optimization helpers
/// Manages data partitioning and result aggregation for cluster-based GA

use crate::solver::Expr;
use std::collections::HashMap;

/// Result of optimizing a single cluster
#[derive(Clone, Debug)]
pub struct ClusterOptimizationResult {
    pub cluster_id: usize,
    pub best_expr: Expr,
    pub best_error: f64,
    pub best_generation: u64,
    pub sample_count: usize,
    pub cluster_condition: String,
}

/// Struct to hold cluster optimization results from all clusters
#[derive(Clone, Debug)]
pub struct ClusterOptimizationResults {
    pub results: HashMap<usize, ClusterOptimizationResult>,
    pub global_best_expr: Expr,
    pub global_best_error: f64,
    pub global_best_cluster: Option<usize>,
}

impl ClusterOptimizationResults {
    pub fn new() -> Self {
        Self {
            results: HashMap::new(),
            global_best_expr: Expr::Const(0.0),
            global_best_error: f64::MAX,
            global_best_cluster: None,
        }
    }

    /// Update with a new cluster result, tracking global best
    pub fn update_from_cluster(&mut self, cluster_result: ClusterOptimizationResult) {
        if cluster_result.best_error < self.global_best_error {
            self.global_best_error = cluster_result.best_error;
            self.global_best_expr = cluster_result.best_expr.clone();
            self.global_best_cluster = Some(cluster_result.cluster_id);
        }
        self.results.insert(cluster_result.cluster_id, cluster_result);
    }

    /// Generate summary message for logging
    pub fn summary(&self) -> String {
        let mut msg = format!("Cluster optimization complete: {} clusters optimized\n", self.results.len());
        msg.push_str("Results per cluster:\n");
        
        let mut sorted_ids: Vec<_> = self.results.keys().collect();
        sorted_ids.sort();
        
        for cluster_id in sorted_ids {
            if let Some(result) = self.results.get(cluster_id) {
                msg.push_str(&format!(
                    "  Cluster {}: RMSE {:.6} ({} samples) | {}\n",
                    cluster_id, result.best_error, result.sample_count, result.cluster_condition
                ));
            }
        }
        
        if let Some(best_cluster) = self.global_best_cluster {
            msg.push_str(&format!(
                "Global best: Cluster {} with RMSE {:.6}",
                best_cluster, self.global_best_error
            ));
        }
        
        msg
    }
}
