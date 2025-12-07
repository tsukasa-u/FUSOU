//! Parameter sweep result management

use crate::state::SweepConfig;
use std::io::Write;

/// Save sweep results to JSON and CSV files
pub fn save_sweep_results(sweep_config: &SweepConfig) -> (Option<String>, Option<String>) {
    use std::fs;
    
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    let json_path = format!("sweep_results_{}.json", timestamp);
    let csv_path = format!("sweep_results_{}.csv", timestamp);
    
    // Save detailed JSON results
    let json_result = if let Ok(json_str) = serde_json::to_string_pretty(&sweep_config.detailed_results) {
        fs::write(&json_path, json_str).ok().map(|_| json_path.clone())
    } else {
        None
    };
    
    // Save CSV summary
    let csv_result = if let Ok(mut file) = fs::File::create(&csv_path) {
        // Write CSV header
        let _ = writeln!(file, "iteration,population_size,max_depth,mutation_rate,crossover_rate,tournament_size,elite_count,use_nsga2,tarpeian_probability,hoist_mutation_rate,constant_optimization_interval,max_generations,target_error,correlation_threshold,mean_error,median_error,stddev_error");
        
        // Write data rows
        for (i, entry) in sweep_config.detailed_results.iter().enumerate() {
            if let Some(params) = entry.get("parameters") {
                let mean = entry.get("mean_error").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let median = entry.get("median_error").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let stddev = entry.get("stddev_error").and_then(|v| v.as_f64()).unwrap_or(0.0);
                
                let _ = writeln!(
                    file,
                    "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                    i + 1,
                    params.get("population_size").and_then(|v| v.as_u64()).unwrap_or(0),
                    params.get("max_depth").and_then(|v| v.as_u64()).unwrap_or(0),
                    params.get("mutation_rate").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    params.get("crossover_rate").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    params.get("tournament_size").and_then(|v| v.as_u64()).unwrap_or(0),
                    params.get("elite_count").and_then(|v| v.as_u64()).unwrap_or(0),
                    params.get("use_nsga2").and_then(|v| v.as_bool()).unwrap_or(false),
                    params.get("tarpeian_probability").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    params.get("hoist_mutation_rate").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    params.get("constant_optimization_interval").and_then(|v| v.as_u64()).unwrap_or(0),
                    params.get("max_generations").and_then(|v| v.as_u64()).unwrap_or(0),
                    params.get("target_error").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    params.get("correlation_threshold").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    mean,
                    median,
                    stddev
                );
            }
        }
        Some(csv_path.clone())
    } else {
        None
    };
    
    (json_result, csv_result)
}
