/// Duplicate/similar solution detection for genetic algorithm
/// 
/// Prevents the algorithm from repeatedly exploring the same or semantically
/// equivalent formula structures, encouraging exploration of new solution space.

use crate::solver::Expr;
use std::collections::HashSet;

/// Hash-based duplicate detection
/// Computes canonical string representation to identify exact duplicates
pub fn expr_to_canonical_string(expr: &Expr) -> String {
    match expr {
        Expr::Const(c) => {
            // Normalize floating point representation for stability
            format!("c:{:.6}", c)
        }
        Expr::Var(idx) => format!("v:{}", idx),
        Expr::Unary { op, child } => {
            let op_str = match op {
                crate::solver::UnaryOp::Identity => "id",
                crate::solver::UnaryOp::Floor => "floor",
                crate::solver::UnaryOp::Exp => "exp",
                crate::solver::UnaryOp::Pow => "pow",
                crate::solver::UnaryOp::Step => "step",
                crate::solver::UnaryOp::Log => "log",
                crate::solver::UnaryOp::Sqrt => "sqrt",
            };
            format!("u:{}({})", op_str, expr_to_canonical_string(child))
        }
        Expr::Binary { op, left, right } => {
            let op_str = match op {
                crate::solver::BinaryOp::Add => "+",
                crate::solver::BinaryOp::Sub => "-",
                crate::solver::BinaryOp::Mul => "*",
                crate::solver::BinaryOp::Div => "/",
                crate::solver::BinaryOp::Min => "min",
                crate::solver::BinaryOp::Max => "max",
            };
            format!(
                "b:{}({},{})",
                op_str,
                expr_to_canonical_string(left),
                expr_to_canonical_string(right)
            )
        }
    }
}

/// Compute a simple hash for the expression structure
/// Used for quick duplicate checking
pub fn expr_structural_hash(expr: &Expr) -> u64 {
    let canonical = expr_to_canonical_string(expr);
    // Use simple hash (in real scenario, consider using ahash or similar)
    let mut hash = 5381u64;
    for byte in canonical.bytes() {
        hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
    }
    hash
}

/// Track seen expressions to prevent duplicate exploration
#[derive(Clone, Debug)]
pub struct DuplicateTracker {
    /// Set of canonical string representations of seen expressions
    seen_expressions: HashSet<String>,
    /// Maximum number of unique expressions to track before pruning old entries
    max_history_size: usize,
}

impl DuplicateTracker {
    /// Create a new duplicate tracker with specified history size
    pub fn new(max_history_size: usize) -> Self {
        DuplicateTracker {
            seen_expressions: HashSet::new(),
            max_history_size,
        }
    }

    /// Check if an expression has been seen before
    pub fn is_duplicate(&self, expr: &Expr) -> bool {
        let canonical = expr_to_canonical_string(expr);
        self.seen_expressions.contains(&canonical)
    }

    /// Register an expression as seen
    pub fn register(&mut self, expr: &Expr) {
        let canonical = expr_to_canonical_string(expr);
        self.seen_expressions.insert(canonical);
        
        // Simple memory management: if too many entries, clear old ones
        // In practice, could implement LRU or other strategies
        if self.seen_expressions.len() > self.max_history_size * 2 {
            // Clear and restart to avoid unbounded memory growth
            self.seen_expressions.clear();
        }
    }

    /// Get number of tracked unique expressions
    pub fn tracked_count(&self) -> usize {
        self.seen_expressions.len()
    }

    /// Clear all tracked expressions (useful for resets)
    pub fn clear(&mut self) {
        self.seen_expressions.clear();
    }
}

impl Default for DuplicateTracker {
    fn default() -> Self {
        // Default history size: 10,000 unique expressions
        DuplicateTracker::new(10_000)
    }
}

/// Compute structural similarity between two expressions
/// Returns a value 0.0 (identical) to 1.0 (completely different)
/// 
/// This is a simplified version - a full implementation might use
/// tree edit distance or other sophisticated metrics
pub fn expr_similarity(expr1: &Expr, expr2: &Expr) -> f64 {
    let str1 = expr_to_canonical_string(expr1);
    let str2 = expr_to_canonical_string(expr2);
    
    // Simple similarity: Levenshtein distance normalized by length
    let dist = levenshtein_distance(&str1, &str2) as f64;
    let max_len = str1.len().max(str2.len()) as f64;
    
    if max_len == 0.0 {
        0.0 // identical empty strings
    } else {
        dist / max_len
    }
}

/// Compute Levenshtein distance between two strings
fn levenshtein_distance(s1: &str, s2: &str) -> usize {
    let len1 = s1.len();
    let len2 = s2.len();
    
    if len1 == 0 {
        return len2;
    }
    if len2 == 0 {
        return len1;
    }
    
    let mut matrix = vec![vec![0; len2 + 1]; len1 + 1];
    
    for i in 0..=len1 {
        matrix[i][0] = i;
    }
    for j in 0..=len2 {
        matrix[0][j] = j;
    }
    
    let s1_chars: Vec<char> = s1.chars().collect();
    let s2_chars: Vec<char> = s2.chars().collect();
    
    for i in 1..=len1 {
        for j in 1..=len2 {
            let cost = if s1_chars[i - 1] == s2_chars[j - 1] { 0 } else { 1 };
            matrix[i][j] = std::cmp::min(
                std::cmp::min(
                    matrix[i - 1][j] + 1,      // deletion
                    matrix[i][j - 1] + 1,      // insertion
                ),
                matrix[i - 1][j - 1] + cost,   // substitution
            );
        }
    }
    
    matrix[len1][len2]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_duplicate_detection() {
        let expr1 = Expr::Const(1.5);
        let expr2 = Expr::Const(1.5);
        let expr3 = Expr::Const(2.0);

        let mut tracker = DuplicateTracker::new(100);
        assert!(!tracker.is_duplicate(&expr1));
        
        tracker.register(&expr1);
        assert!(tracker.is_duplicate(&expr2)); // same structure and value
        assert!(!tracker.is_duplicate(&expr3)); // different value
    }

    #[test]
    fn test_similarity_calculation() {
        let expr1 = Expr::Const(1.0);
        let expr2 = Expr::Const(1.0);
        let expr3 = Expr::Const(2.0);
        
        let sim_same = expr_similarity(&expr1, &expr2);
        let sim_diff = expr_similarity(&expr1, &expr3);
        
        assert!(sim_same < sim_diff);
    }
}
