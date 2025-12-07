use crate::state::SolverState;
use crate::dataset::synthetic_dataset;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, MouseEvent, MouseEventKind};
use std::sync::{Arc, atomic::Ordering};
use std::thread;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusedPanel {
    BestSolution,
    OperatorStats,
    Logs,
}

const COMMANDS: &[(&str, &str)] = &[
    ("/help", "Show available commands (type /help <command> for details)"),
    ("/version", "Show package name and version"),
    ("/best", "Show current best formula"),
    ("/clear", "Clear all logs"),
    ("/copylogs", "Write logs to file and copy to clipboard if possible"),
    ("/quit", "Exit the application"),
    ("/stop", "Stop current solver/sweep run"),
    ("/start-formula", "Start formula optimization with current parameters"),
    ("/start-sweep", "Start parameter sweep (must be configured with /sweep first)"),
    ("/start", "[deprecated] Use /start-formula or /start-sweep"),
    ("/set", "Set runtime config: /set <param> <value>"),
    ("/dump", "Export solver state and results to JSON"),
    ("/export-params", "Export current parameters to JSON file"),
    ("/import-params", "Import parameters from JSON file: /import-params <file>"),
    ("/sweep", "Configure parameter sweep: /sweep [default|all] or /sweep <param1=min:max:step> ..."),
    ("/verify-synthetic", "Verify synthetic dataset targets match ground-truth formula"),
    ("/load-config", "Load miner configuration from file: /load-config [path] (default: miner_config.toml)"),
    ("/save-config", "Save current miner configuration to file: /save-config [path] (default: miner_config.toml)"),
    ("/set-dataset", "Select synthetic dataset type: /set-dataset A|B|C (default A)"),
    ("/help clustering", "Show help for clustering feature (type /help clustering)"),
];
const SET_PARAMETERS: &[&str] = &[
    "population_size",
    "max_depth",
    "mutation_rate",
    "crossover_rate",
    "tournament_size",
    "elite_count",
    "use_nsga2",
    "tarpeian_probability",
    "hoist_mutation_rate",
    "constant_optimization_interval",
    "max_generations",
];

const SWEEP_PARAMETERS: &[&str] = &[
    "population_size",
    "max_depth",
    "mutation_rate",
    "crossover_rate",
    "tournament_size",
    "elite_count",
    "tarpeian_probability",
    "hoist_mutation_rate",
    "constant_optimization_interval",
    "max_generations",
];

// Handle simple commands from the user keyboard while the TUI runs.
// Public API: returns `true` when the caller should exit the app.
pub fn handle_key_event(key: KeyEvent, state: &mut SolverState) -> bool {
    // Only act on Key presses (not repeats / releases)
    if key.kind != KeyEventKind::Press {
        return false;
    }

    match key.code {
        KeyCode::Left => {
            // Move focus left: Logs -> OperatorStats -> BestSolution
            state.focused_panel = match state.focused_panel {
                FocusedPanel::Logs => FocusedPanel::OperatorStats,
                FocusedPanel::OperatorStats => FocusedPanel::BestSolution,
                _ => FocusedPanel::BestSolution,
            };
        }
        KeyCode::Right => {
            // Move focus right: BestSolution -> OperatorStats -> Logs
            state.focused_panel = match state.focused_panel {
                FocusedPanel::BestSolution => FocusedPanel::OperatorStats,
                FocusedPanel::OperatorStats => FocusedPanel::Logs,
                _ => FocusedPanel::Logs,
            };
        }
        KeyCode::Up => {
            scroll_focused_up(state);
        }
        KeyCode::Down => {
            scroll_focused_down(state);
        }
        KeyCode::Char(c) => {
            state.input_buffer.push(c);
            // Detect if input contains non-ASCII characters (Japanese/IME mode indicator)
            state.ime_mode_active = state.input_buffer.chars().any(|ch| !ch.is_ascii());
            update_suggestions(state);
        }
        KeyCode::Backspace => {
            state.input_buffer.pop();
            // Re-check IME mode after backspace
            state.ime_mode_active = state.input_buffer.chars().any(|ch| !ch.is_ascii());
            update_suggestions(state);
        }
        KeyCode::Tab => {
            // If there are suggestions, accept the first one (complete the command)
            if !state.command_suggestions.is_empty() {
                let completion = state.command_suggestions[0].clone();
                state.input_buffer = completion;
                state.command_suggestions.clear();
                state.suggestion_selected = None;
            }
        }
        KeyCode::Enter => {
            let cmd = state.input_buffer.trim().to_string();
            state.input_buffer.clear();
            state.command_suggestions.clear();
            state.suggestion_selected = None;
            return execute_command(&cmd, state);
        }
        KeyCode::Esc => {
            state.input_buffer.clear();
            state.command_suggestions.clear();
            state.suggestion_selected = None;
        }
        _ => {}
    }

    false
}

fn update_suggestions(state: &mut SolverState) {
    state.command_suggestions.clear();
    if state.input_buffer.is_empty() {
        state.suggestion_selected = None;
        return;
    }

    // Handle /set parameter suggestions
    if state.input_buffer.starts_with("/set ") {
        let rest = &state.input_buffer[5..]; // Skip "/set "
        let parts: Vec<&str> = rest.split_whitespace().collect();
        
        // If only parameter name being typed (no value yet)
        if parts.len() == 1 {
            let partial = parts[0];
            for param in SET_PARAMETERS {
                if param.starts_with(partial) {
                    state.command_suggestions.push(format!("/set {}", param));
                }
            }
        }
        // If parameter already entered, just show completion with space
        else if parts.len() > 1 {
            if let Some(param) = parts.first() {
                state.command_suggestions.push(format!("/set {} ", param));
            }
        }
    } else if state.input_buffer.starts_with("/sweep ") {
        let rest = &state.input_buffer[7..]; // Skip "/sweep "
        let parts: Vec<&str> = rest.split_whitespace().collect();
        
        // Show suggestions for preset options first
        if rest.is_empty() {
            state.command_suggestions.push("/sweep default".to_string());
            state.command_suggestions.push("/sweep all".to_string());
        } else if "default".starts_with(rest) && !rest.is_empty() {
            state.command_suggestions.push("/sweep default".to_string());
        } else if "all".starts_with(rest) && !rest.is_empty() {
            state.command_suggestions.push("/sweep all".to_string());
        } else {
            // Show parameter suggestions for custom ranges
            let partial = if rest.contains('=') {
                rest.split('=').next().unwrap_or(rest)
            } else {
                rest.split_whitespace().last().unwrap_or(rest)
            };
            
            for param in SWEEP_PARAMETERS {
                if param.starts_with(partial) && !rest.contains(&format!("{}=", param)) {
                    let suggestion = if rest.is_empty() {
                        format!("/sweep {}=min:max:step", param)
                    } else if rest.ends_with(' ') {
                        format!("{} {}=min:max:step", state.input_buffer, param)
                    } else {
                        format!("/sweep {}=min:max:step", param)
                    };
                    state.command_suggestions.push(suggestion);
                }
            }
        }
    } else if state.input_buffer.starts_with('/') {
        // Handle command suggestions
        for (cmd, _) in COMMANDS {
            if cmd.starts_with(&state.input_buffer) {
                state.command_suggestions.push(cmd.to_string());
            }
        }
    }
    
    // Start selection at the first suggestion when available
    state.suggestion_selected = if state.command_suggestions.is_empty() {
        None
    } else {
        Some(0)
    };
}

fn execute_command(cmd: &str, state: &mut SolverState) -> bool {
    // Support runtime configuration via: /set <param> <value>
    if let Some(rest) = cmd.strip_prefix("/set ") {
        let mut parts = rest.split_whitespace();
        if let (Some(key), Some(val)) = (parts.next(), parts.next()) {
            let lower = key.to_lowercase();
            
            // Handle max_generations separately (it's in state, not shared_config)
            if lower == "max_generations" {
                if let Ok(value) = val.parse::<u64>() {
                    state.max_generations = value;
                    push_log(state, format!("Config updated: {} = {}", key, val));
                } else {
                    push_log(state, format!("Invalid value for {}: {}", key, val));
                }
                return false;
            }
            
            // Handle shared_config parameters
            let cfg_arc_opt = state.shared_config.clone();
            if let Some(cfg_arc) = cfg_arc_opt {
                match cfg_arc.lock() {
                    Ok(mut cfg) => {
                        let res = match lower.as_str() {
                            "population_size" => { cfg.population_size = val.parse().unwrap_or(cfg.population_size); true }
                            "max_depth" => { cfg.max_depth = val.parse().unwrap_or(cfg.max_depth); true }
                            "mutation_rate" => { cfg.mutation_rate = val.parse().unwrap_or(cfg.mutation_rate); true }
                            "crossover_rate" => { cfg.crossover_rate = val.parse().unwrap_or(cfg.crossover_rate); true }
                            "tournament_size" => { cfg.tournament_size = val.parse().unwrap_or(cfg.tournament_size); true }
                            "elite_count" => { cfg.elite_count = val.parse().unwrap_or(cfg.elite_count); true }
                            "use_nsga2" => { cfg.use_nsga2 = val.parse().unwrap_or(cfg.use_nsga2); true }
                            "tarpeian_probability" => { cfg.tarpeian_probability = val.parse().unwrap_or(cfg.tarpeian_probability); true }
                            "hoist_mutation_rate" => { cfg.hoist_mutation_rate = val.parse().unwrap_or(cfg.hoist_mutation_rate); true }
                            "constant_optimization_interval" => { cfg.constant_optimization_interval = val.parse().unwrap_or(cfg.constant_optimization_interval); true }
                            _ => false,
                        };
                        drop(cfg); // release lock before mutating state
                        if res {
                            push_log(state, format!("Config updated: {} = {}", key, val));
                        } else {
                            push_log(state, format!("Unknown config key: {}", key));
                        }
                    }
                    Err(_) => {
                        push_log(state, "Failed to acquire config lock".into());
                    }
                }
            } else {
                push_log(state, "No shared configuration available".into());
            }
        } else {
            push_log(state, "Usage: /set <param> <value>".into());
        }
        return false;
    }

    match cmd {
        "/quit" => return true,
        "/stop" => {
            if let Some(flag) = &state.shutdown_flag {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                push_log(state, "Stop requested: signalling solver to stop...".into());
            } else {
                push_log(state, "No running solver to stop.".into());
            }
            return false;
        }
        "/start" | "/start-formula" => {
            start_formula_optimization(state);
            return false;
        }
        "/start-sweep" => {
            start_parameter_sweep(state);
            return false;
        }
        "/version" => {
            let v = format!("{} v{}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
            push_log(state, v);
        }
        "/verify-synthetic" => {
            // Regenerate synthetic dataset and verify targets against formula implementation
            let ds = if let Ok(mc) = state.miner_config.lock() {
                crate::dataset::synthetic_dataset_for(&mc.synthetic_data.dataset_type, &mc.synthetic_data)
            } else {
                // fallback
                crate::dataset::synthetic_dataset()
            };
            let mut mismatches: Vec<(usize, f64, f64)> = Vec::new();
            let mut acc_sq_err = 0.0f64;
            let mut acc_count = 0usize;
            for (i, pair) in ds.to_pairs().iter().enumerate() {
                let features = &pair.0;
                let target = pair.1;
                let atk = features[0];
                let def = features[1];
                let luck = features[2];
                let diff = atk - def;
                let base = if diff > 1.0_f64 { diff } else { 1.0_f64 };
                let crit = if luck > 80.0 { base * 1.5 } else { base };
                let expected = if crit > 1.0_f64 { crit } else { 1.0_f64 };
                let err = expected - target;
                acc_sq_err += err * err;
                acc_count += 1;
                if err.abs() > 1e-9 {
                    mismatches.push((i, expected, target));
                }
            }
            // compute RMSE
            let rmse = if acc_count > 0 { (acc_sq_err / (acc_count as f64)).sqrt() } else { 0.0 };
            push_log(state, format!("Synthetic dataset verification: RMSE = {:.6}", rmse));
            if mismatches.is_empty() {
                push_log(state, "All targets exactly match the expected formula (within 1e-9)".into());
            } else {
                push_log(state, format!("{} mismatches found (showing up to 10 examples):", mismatches.len()));
                for (i, exp, act) in mismatches.iter().take(10) {
                    push_log(state, format!("  idx={} expected={:.6} actual={:.6}", i, exp, act));
                }
                if mismatches.len() > 10 {
                    push_log(state, "  ... (first 10 shown)".into());
                }
            }
        }
        "/load-config" => {
            let path_str = cmd.strip_prefix("/load-config").unwrap_or("").trim().to_string();
            let config_path = if path_str.is_empty() { "miner_config.toml".to_string() } else { path_str };
            let config = crate::config::MinerConfig::load_or_default(&config_path);
            let msg = if let Ok(mut mc) = state.miner_config.lock() {
                *mc = config;
                format!("Configuration loaded from: {}", config_path)
            } else {
                "Error: Failed to acquire config lock".to_string()
            };
            push_log(state, msg);
        }
        _ if cmd.starts_with("/set-dataset") => {
            // Usage: /set-dataset A
            let rest = cmd.strip_prefix("/set-dataset").unwrap_or("").trim();
            let choice = if rest.is_empty() { None } else { Some(rest.to_string()) };
            if let Some(val) = choice {
                let up = val.to_uppercase();
                if up == "A" || up == "B" || up == "C" {
                    let msg = if let Ok(mut mc) = state.miner_config.lock() {
                        mc.synthetic_data.dataset_type = up.clone();
                        format!("Synthetic dataset type set to {}", up)
                    } else {
                        "Error: Failed to acquire config lock".to_string()
                    };
                    push_log(state, msg);
                } else {
                    push_log(state, "Invalid dataset type. Use A, B, or C.".into());
                }
            } else {
                // show current selection
                let msg = if let Ok(mc) = state.miner_config.lock() {
                    format!("Current synthetic dataset type: {}", mc.synthetic_data.dataset_type)
                } else {
                    "Error: Failed to acquire config lock".to_string()
                };
                push_log(state, msg);
            }
            return false;
        }
        "/save-config" => {
            let path_str = cmd.strip_prefix("/save-config").unwrap_or("").trim().to_string();
            let config_path = if path_str.is_empty() { "miner_config.toml".to_string() } else { path_str };
            let msg = if let Ok(mc) = state.miner_config.lock() {
                match mc.save(&config_path) {
                    Ok(_) => format!("Configuration saved to: {}", config_path),
                    Err(e) => format!("Error saving config: {}", e),
                }
            } else {
                "Error: Failed to acquire config lock".to_string()
            };
            push_log(state, msg);
        }
        _ if cmd.starts_with("/help ") => {
            if let Some(help_topic) = cmd.strip_prefix("/help ") {
                show_detailed_help(state, help_topic);
            } else {
                show_general_help(state);
            }
        }
        "/help" => {
            show_general_help(state);
        }
        "/best" => {
            push_log(state, format!("Best formula: {}", state.best_formula));
        }
        "/clear" => {
            state.logs.clear();
        }
        "/copylogs" => {
            // Write logs to a timestamped file and try to copy to clipboard
            let logs_text = state.logs.join("\n");
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let filename = format!("fusou_logs_{}.log", ts);
            match std::env::current_dir() {
                Ok(dir) => {
                    // write logs into ./output/logs_<ts>/ to keep workspace clean
                    let out_dir = dir.join("output").join(format!("logs_{}", ts));
                    let _ = std::fs::create_dir_all(&out_dir);
                    let path = out_dir.join(&filename);
                    match std::fs::write(&path, &logs_text) {
                                Ok(_) => {
                                    push_log(state, format!("Logs written to {}", path.display()));

                            // Try clipboard utilities in order
                            let mut copied = false;
                            let clipboard_cmds: &[(&str, &[&str])] = &[
                                ("wl-copy", &[]),
                                ("xclip", &["-selection", "clipboard"]),
                                ("xsel", &["--clipboard", "--input"]),
                            ];

                            for (cmd, args) in clipboard_cmds {
                                if which::which(cmd).is_ok() {
                                    if let Ok(mut child) = std::process::Command::new(cmd)
                                        .args(*args)
                                        .stdin(std::process::Stdio::piped())
                                        .spawn()
                                    {
                                        if let Some(mut stdin) = child.stdin.take() {
                                            use std::io::Write;
                                            let _ = stdin.write_all(logs_text.as_bytes());
                                        }
                                        if let Ok(status) = child.wait() {
                                            if status.success() {
                                                push_log(state, format!("Logs copied to clipboard via {}", cmd));
                                                copied = true;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            if !copied {
                                push_log(state, "No clipboard utility found or copy failed; logs saved to file.".into());
                            }
                        }
                        Err(e) => {
                            push_log(state, format!("Failed to write logs to file: {}", e));
                        }
                    }
                }
                Err(e) => {
                    push_log(state, format!("Failed to determine current directory: {}", e));
                }
            }
        }
            "/dump" => {
                // Export solver state to JSON file
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let filename = format!("fusou_dump_{}.json", ts);
            
                // Create JSON object with current state
                let json_obj = serde_json::json!({
                    "worker_id": state.worker_id.to_string(),
                    "job_id": state.job_id.map(|id| id.to_string()),
                    "generation": state.generation,
                    "best_error": state.best_error,
                    "best_formula": state.best_formula,
                    "target_formula": state.target_formula,
                    "sample_count": state.sample_count,
                    "selected_features": state.selected_features,
                    "max_generations": state.max_generations,
                    "target_error": state.target_error,
                    "top_candidates": state.top_candidates.iter().map(|c| {
                        serde_json::json!({
                            "rank": c.rank,
                            "formula": c.formula,
                            "rmse": c.rmse
                        })
                    }).collect::<Vec<_>>()
                });
            
                match std::env::current_dir() {
                    Ok(dir) => {
                        // Save dump into ./output/dump_<ts>/
                        let out_dir = dir.join("output").join(format!("dump_{}", ts));
                        if let Err(e) = std::fs::create_dir_all(&out_dir) {
                            push_log(state, format!("Failed to create output directory: {}", e));
                            return false;
                        }
                        let path = out_dir.join(&filename);
                        match std::fs::write(&path, serde_json::to_string_pretty(&json_obj).unwrap_or_default()) {
                            Ok(_) => {
                                push_log(state, format!("State exported to {}", path.display()));
                            }
                            Err(e) => {
                                push_log(state, format!("Failed to write dump file: {}", e));
                            }
                        }
                    }
                    Err(e) => {
                        push_log(state, format!("Failed to determine current directory: {}", e));
                    }
                }
            }
        "/export-params" => {
            // Export current parameters to JSON file
            export_parameters(state);
        }
        _ if cmd.starts_with("/import-params ") => {
            // Import parameters from JSON file
            if let Some(rest) = cmd.strip_prefix("/import-params ") {
                let filepath = rest.trim();
                import_parameters(state, filepath);
            } else {
                push_log(state, "Usage: /import-params <filepath>".into());
            }
        }
        _ if cmd.starts_with("/sweep ") => {
            // Start parameter sweep experiment
            if let Some(rest) = cmd.strip_prefix("/sweep ") {
                initiate_parameter_sweep(state, rest);
            } else {
                push_log(state, "Usage: /sweep <param1=min:max:step> [param2=min:max:step] ...".into());
            }
        }
        _ if !cmd.is_empty() => {
            push_log(
                state,
                format!(
                    "Unknown command: {}. Type /help for available commands.",
                    cmd
                ),
            );
        }
        _ => {}
    }
    false
}

fn push_log(state: &mut SolverState, msg: String) {
    // Filter out very noisy smart-init generation logs
    if msg.contains("Smart-init: generated") {
        return;
    }

    // Preserve user's scroll position unless they were viewing the bottom
    let was_at_bottom = state.log_scroll_offset == 0;
    state.logs.push(msg);
    // Increase retained log lines so users can scroll further back
    if state.logs.len() > 2000 {
        state.logs.drain(0..state.logs.len() - 2000);
    }
    if was_at_bottom {
        // keep autoscroll to bottom
        state.log_scroll_offset = 0;
    }
}

pub fn handle_mouse_event(mouse: MouseEvent, state: &mut SolverState) {
    match mouse.kind {
        MouseEventKind::ScrollUp => {
            scroll_focused_up(state);
        }
        MouseEventKind::ScrollDown => {
            scroll_focused_down(state);
        }
        _ => {}
    }
}

fn scroll_focused_up(state: &mut SolverState) {
    match state.focused_panel {
        FocusedPanel::Logs => {
            if state.log_scroll_offset + 1 < state.logs.len() {
                state.log_scroll_offset += 1;
            }
        }
        FocusedPanel::BestSolution => {
            let line_count = count_best_solution_lines(state);
            if state.best_solution_scroll_offset + 1 < line_count {
                state.best_solution_scroll_offset += 1;
            }
        }
        FocusedPanel::OperatorStats => {
            // Move selection down the list (up in UI corresponds to increasing index)
            let len = state.operator_counts.len().max(1);
            if state.operator_selected_index + 1 < len {
                state.operator_selected_index += 1;
            }
        }
    }
}

fn scroll_focused_down(state: &mut SolverState) {
    match state.focused_panel {
        FocusedPanel::Logs => {
            if state.log_scroll_offset > 0 {
                state.log_scroll_offset -= 1;
            }
        }
        FocusedPanel::BestSolution => {
            if state.best_solution_scroll_offset > 0 {
                state.best_solution_scroll_offset -= 1;
            }
        }
        FocusedPanel::OperatorStats => {
            if state.operator_selected_index > 0 {
                state.operator_selected_index -= 1;
            }
        }
    }
}

fn count_best_solution_lines(_state: &SolverState) -> usize {
    // Return 100 to support scrolling through long formulas and clustering conditions
    100
}

/// Export current parameters to JSON file
fn export_parameters(state: &mut SolverState) {
    use crate::state::ParameterSet;
    
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let filename = format!("parameters_{}.json", ts);

    let cfg_arc_opt = state.shared_config.clone();
    let params = if let Some(cfg_arc) = cfg_arc_opt {
        if let Ok(cfg) = cfg_arc.lock() {
            let p = ParameterSet {
                population_size: cfg.population_size,
                max_depth: cfg.max_depth,
                mutation_rate: cfg.mutation_rate,
                crossover_rate: cfg.crossover_rate,
                tournament_size: cfg.tournament_size,
                elite_count: cfg.elite_count,
                use_nsga2: cfg.use_nsga2,
                tarpeian_probability: cfg.tarpeian_probability,
                hoist_mutation_rate: cfg.hoist_mutation_rate,
                constant_optimization_interval: cfg.constant_optimization_interval,
                max_generations: state.max_generations,
                target_error: state.target_error,
                correlation_threshold: state.correlation_threshold,
                achieved_error: Some(state.best_error),
            };
            drop(cfg);
            Some(p)
        } else {
            push_log(state, "Failed to acquire config lock".into());
            None
        }
    } else {
        push_log(state, "No shared configuration available".into());
        None
    };

    let params = match params {
        Some(p) => p,
        None => return,
    };

    match std::env::current_dir() {
        Ok(dir) => {
            // Save parameters under ./output/params_<ts>/
            let out_dir = dir.join("output").join(format!("params_{}", ts));
            if let Err(e) = std::fs::create_dir_all(&out_dir) {
                push_log(state, format!("Failed to create output directory: {}", e));
                return;
            }
            let path = out_dir.join(&filename);
            match serde_json::to_string_pretty(&params) {
                Ok(json_str) => {
                    match std::fs::write(&path, json_str) {
                        Ok(_) => {
                            push_log(state, format!("Parameters exported to {}", path.display()));
                        }
                        Err(e) => {
                            push_log(state, format!("Failed to write parameters file: {}", e));
                        }
                    }
                }
                Err(e) => {
                    push_log(state, format!("Failed to serialize parameters: {}", e));
                }
            }
        }
        Err(e) => {
            push_log(state, format!("Failed to determine current directory: {}", e));
        }
    }
}

/// Import parameters from JSON file
fn import_parameters(state: &mut SolverState, filepath: &str) {
    use crate::state::ParameterSet;

    match std::fs::read_to_string(filepath) {
        Ok(content) => {
            match serde_json::from_str::<ParameterSet>(&content) {
                Ok(params) => {
                    // Update shared_config if available
                    if let Some(cfg_arc) = state.shared_config.clone() {
                        match cfg_arc.lock() {
                            Ok(mut cfg) => {
                                cfg.population_size = params.population_size;
                                cfg.max_depth = params.max_depth;
                                cfg.mutation_rate = params.mutation_rate;
                                cfg.crossover_rate = params.crossover_rate;
                                cfg.tournament_size = params.tournament_size;
                                cfg.elite_count = params.elite_count;
                                cfg.use_nsga2 = params.use_nsga2;
                                cfg.tarpeian_probability = params.tarpeian_probability;
                                cfg.hoist_mutation_rate = params.hoist_mutation_rate;
                                cfg.constant_optimization_interval = params.constant_optimization_interval;
                                drop(cfg);
                            }
                            Err(_) => {
                                push_log(state, "Failed to acquire config lock".into());
                                return;
                            }
                        }
                    }

                    // Update state parameters
                    state.max_generations = params.max_generations;
                    state.target_error = params.target_error;
                    state.correlation_threshold = params.correlation_threshold;

                    push_log(state, format!("Parameters imported from {}", filepath));
                    push_log(state, format!(
                        "Loaded: pop={}, depth={}, mut_rate={:.3}, max_gen={}",
                        params.population_size, params.max_depth, params.mutation_rate, params.max_generations
                    ));
                }
                Err(e) => {
                    push_log(state, format!("Failed to parse parameters file: {}", e));
                }
            }
        }
        Err(e) => {
            push_log(state, format!("Failed to read parameters file: {}", e));
        }
    }
}

/// Initiate parameter sweep experiment
fn initiate_parameter_sweep(state: &mut SolverState, args: &str) {
    use crate::state::SweepConfig;
    use std::collections::HashMap;

    let mut parts: Vec<&str> = args.split_whitespace().collect();
    // Extract optional refinement settings: refinements=<N>, refinement_factor=<f>
    // and repeats=<R>
    let mut max_refinements: usize = 0;
    let mut refinement_factor: f64 = 0.5;
    let mut repeats: usize = 1;
    // Remove these tokens from parts
    parts.retain(|token| {
        if let Some(rest) = token.strip_prefix("refinements=") {
            if let Ok(v) = rest.parse::<usize>() {
                max_refinements = v;
            }
            false
        } else if let Some(rest) = token.strip_prefix("refinement_factor=") {
            if let Ok(v) = rest.parse::<f64>() {
                refinement_factor = v;
            }
            false
        } else if let Some(rest) = token.strip_prefix("repeats=") {
            if let Ok(v) = rest.parse::<usize>() {
                repeats = v.max(1);
            }
            false
        } else {
            true
        }
    });
    if parts.is_empty() {
        push_log(state, "Usage: /sweep [default|all] or /sweep <param1=min:max:step> [param2=min:max:step] ...".into());
        return;
    }

    let mut parameters_to_sweep = Vec::new();
    let mut ranges = HashMap::new();
    let mut total_iterations = 1usize;

    // Handle preset options
    if parts.len() == 1 {
        match parts[0] {
            "default" => {
                // Default sweep configuration
                parameters_to_sweep = vec![
                    "mutation_rate".to_string(),
                    "max_depth".to_string(),
                    "population_size".to_string(),
                ];
                ranges.insert("mutation_rate".to_string(), (0.1, 0.5, 0.1));
                ranges.insert("max_depth".to_string(), (3.0, 8.0, 1.0));
                ranges.insert("population_size".to_string(), (32.0, 256.0, 32.0));
                let iter1 = (((0.5 - 0.1) / 0.1) as f64).ceil() as usize + 1;
                let iter2 = (((8.0 - 3.0) / 1.0) as f64).ceil() as usize + 1;
                let iter3 = (((256.0 - 32.0) / 32.0) as f64).ceil() as usize + 1;
                total_iterations = iter1 * iter2 * iter3;
                push_log(state, "Using default sweep configuration: mutation_rate, max_depth, population_size".into());
            }
            "all" => {
                // Sweep all available parameters
                parameters_to_sweep = vec![
                    "population_size".to_string(),
                    "max_depth".to_string(),
                    "mutation_rate".to_string(),
                    "crossover_rate".to_string(),
                    "tournament_size".to_string(),
                    "elite_count".to_string(),
                ];
                ranges.insert("population_size".to_string(), (32.0, 256.0, 64.0));
                ranges.insert("max_depth".to_string(), (3.0, 8.0, 2.0));
                ranges.insert("mutation_rate".to_string(), (0.1, 0.5, 0.15));
                ranges.insert("crossover_rate".to_string(), (0.6, 0.9, 0.1));
                ranges.insert("tournament_size".to_string(), (2.0, 8.0, 2.0));
                ranges.insert("elite_count".to_string(), (1.0, 16.0, 5.0));
                let mut total = 1usize;
                for (_, (min, max, step)) in &ranges {
                    let iterations = (((max - min) / step) as f64).ceil() as usize + 1;
                    total *= iterations;
                }
                total_iterations = total;
                push_log(state, "Using full sweep configuration: all major parameters".into());
            }
            _ => {
                // Custom range specifications
                for part in parts {
                    if let Some((param, range_str)) = part.split_once('=') {
                        let range_parts: Vec<&str> = range_str.split(':').collect();
                        if range_parts.len() == 3 {
                            match (range_parts[0].parse::<f64>(), range_parts[1].parse::<f64>(), range_parts[2].parse::<f64>()) {
                                (Ok(min), Ok(max), Ok(step)) if step > 0.0 && min <= max => {
                                    let iterations = (((max - min) / step) as f64).ceil() as usize + 1;
                                    total_iterations *= iterations;
                                    parameters_to_sweep.push(param.to_string());
                                    ranges.insert(param.to_string(), (min, max, step));
                                }
                                _ => {
                                    push_log(state, format!("Invalid range for {}: must be min:max:step with step > 0", param));
                                    return;
                                }
                            }
                        } else {
                            push_log(state, format!("Invalid format for {}: use param=min:max:step", param));
                            return;
                        }
                    } else {
                        push_log(state, "Invalid sweep argument format. Use: param1=min:max:step param2=min:max:step ...".into());
                        return;
                    }
                }
            }
        }
    } else {
        // Custom range specifications
        for part in parts {
            if let Some((param, range_str)) = part.split_once('=') {
                let range_parts: Vec<&str> = range_str.split(':').collect();
                if range_parts.len() == 3 {
                    match (range_parts[0].parse::<f64>(), range_parts[1].parse::<f64>(), range_parts[2].parse::<f64>()) {
                        (Ok(min), Ok(max), Ok(step)) if step > 0.0 && min <= max => {
                            let iterations = (((max - min) / step) as f64).ceil() as usize + 1;
                            total_iterations *= iterations;
                            parameters_to_sweep.push(param.to_string());
                            ranges.insert(param.to_string(), (min, max, step));
                        }
                        _ => {
                            push_log(state, format!("Invalid range for {}: must be min:max:step with step > 0", param));
                            return;
                        }
                    }
                } else {
                    push_log(state, format!("Invalid format for {}: use param=min:max:step", param));
                    return;
                }
            } else {
                push_log(state, "Invalid sweep argument format. Use: param1=min:max:step param2=min:max:step ...".into());
                return;
            }
        }
    }

    let sweep_config = SweepConfig {
        parameters_to_sweep,
        ranges,
        current_iteration: 0,
        total_iterations,
        best_params: None,
        best_error: f64::MAX,
        results: Vec::new(),

        refinement_enabled: max_refinements > 0,
        max_refinements,
        refinement_factor,
        current_refinement: 0,
        in_refinement_mode: false,
        refinement_ranges: None,
        refinement_total_iterations: 0,
        refinement_current_iteration: 0,
        refinement_parent_iteration: None,
        repeats_per_setting: repeats,
        current_repeat: 0,
        accumulated_errors: Vec::new(),
        run_durations: Vec::new(),
        historical_run_durations: Vec::new(),
        current_run_history: Vec::new(),
        accumulated_histories: Vec::new(),
        detailed_results: Vec::new(),
        refinement_top_k: 3,
    };

    state.sweep_config = Some(sweep_config.clone());
    push_log(state, format!("Parameter sweep initialized: {} parameters, {} total iterations", 
        sweep_config.parameters_to_sweep.len(), sweep_config.total_iterations));
    push_log(state, format!("Parameters to sweep: {}", sweep_config.parameters_to_sweep.join(", ")));
    push_log(state, "Note: Run /start-sweep to begin the parameter sweep experiment".into());
}

/// Start formula optimization with current parameters
fn start_formula_optimization(state: &mut SolverState) {
    if state.solver_running {
        push_log(state, "Solver is already running.".into());
        return;
    }

    let sender = match &state.event_sender {
        Some(s) => s.clone(),
        None => {
            push_log(state, "Cannot start solver: no event sender available".into());
            return;
        }
    };

    let _shared_config = match &state.shared_config {
        Some(cfg) => cfg.clone(),
        None => {
            push_log(state, "Cannot start solver: no shared configuration".into());
            return;
        }
    };

    // Show current configuration before starting
    let config_str = if let Some(cfg_arc) = &state.shared_config {
        if let Ok(cfg) = cfg_arc.lock() {
            format!(
                "Starting formula optimization with config:\n  population_size: {}\n  mutation_rate: {}\n  max_depth: {}\n  max_generations: {}",
                cfg.population_size, cfg.mutation_rate, cfg.max_depth, state.max_generations
            )
        } else {
            format!("Starting formula optimization with max_generations: {}", state.max_generations)
        }
    } else {
        format!("Starting formula optimization with max_generations: {}", state.max_generations)
    };
    push_log(state, config_str);

    state.solver_running = true;

    if sender.send(crate::state::AppEvent::StartRequested).is_err() {
        push_log(state, "Failed to request solver start (sender closed)".into());
        state.solver_running = false;
    } else {
        push_log(state, "Start requested: main will spawn a fresh solver run".into());
    }
}

/// Start parameter sweep optimization
fn start_parameter_sweep(state: &mut SolverState) {
    if state.solver_running {
        push_log(state, "Solver is already running.".into());
        return;
    }

    if state.sweep_config.is_none() {
        push_log(state, "No parameter sweep configured. Use /sweep to configure first.".into());
        return;
    }

    let sender = match &state.event_sender {
        Some(s) => s.clone(),
        None => {
            push_log(state, "Cannot start sweep: no event sender available".into());
            return;
        }
    };

    let _shared_config = match &state.shared_config {
        Some(cfg) => cfg.clone(),
        None => {
            push_log(state, "Cannot start sweep: no shared configuration".into());
            return;
        }
    };

    let (total_iter, params_list) = if let Some(sweep_config) = &state.sweep_config {
        (sweep_config.total_iterations, sweep_config.parameters_to_sweep.join(", "))
    } else {
        (0, String::new())
    };

    push_log(state, format!("Starting parameter sweep with {} total iterations", total_iter));
    push_log(state, format!("Sweeping parameters: {}", params_list));

    state.solver_running = true;

    if sender.send(crate::state::AppEvent::StartRequested).is_err() {
        push_log(state, "Failed to request sweep start (sender closed)".into());
        state.solver_running = false;
    } else {
        push_log(state, "Sweep start requested: main will execute parameter sweep".into());
    }
}

/// Show general help information
fn show_general_help(state: &mut SolverState) {
    push_log(state, "\n=== FUSOU Formula Miner - Command Help ===".into());
    push_log(state, "\nAvailable commands (type '/help <command>' for details):".into());
    for (cmd, desc) in COMMANDS {
        push_log(state, format!("  {:<20} - {}", cmd, desc));
    }
    push_log(state, "\n=== Quick Start ===".into());
    push_log(state, "1. Configure parameters:  /set <param> <value>".into());
    push_log(state, "2. Start optimization:    /start-formula".into());
    push_log(state, "3. Or setup a sweep:      /sweep <param=min:max:step>".into());
    push_log(state, "4. Execute sweep:         /start-sweep".into());
}

/// Show detailed help for a specific command
fn show_detailed_help(state: &mut SolverState, topic: &str) {
    let lower = topic.to_lowercase();
    match lower.as_str() {
        "start-formula" => {
            push_log(state, "\n=== /start-formula ===".into());
            push_log(state, "Starts formula optimization with current parameters.".into());
            push_log(state, "Usage: /start-formula".into());
            push_log(state, "\nBefore running:".into());
            push_log(state, "  - Configure parameters with /set (optional)".into());
            push_log(state, "  - Default parameters are auto-derived from dataset".into());
            push_log(state, "\nExample workflow:".into());
            push_log(state, "  /set mutation_rate 0.3".into());
            push_log(state, "  /set max_generations 5000".into());
            push_log(state, "  /start-formula".into());
        }
        "start-sweep" => {
            push_log(state, "\n=== /start-sweep ===".into());
            push_log(state, "Starts parameter sweep optimization.".into());
            push_log(state, "Usage: /start-sweep".into());
            push_log(state, "\nBefore running:".into());
            push_log(state, "  - Configure sweep with /sweep command (required)".into());
            push_log(state, "\nExample workflow:".into());
            push_log(state, "  /sweep default".into());
            push_log(state, "  /start-sweep".into());
        }
        "sweep" => {
            push_log(state, "\n=== /sweep ===".into());
            push_log(state, "Configures parameter sweep for optimization tuning.".into());
            push_log(state, "Usage: /sweep [default|all] or /sweep <param1=min:max:step> [param2=min:max:step] ...".into());
            push_log(state, "Optional: add `refinements=<N>` and `refinement_factor=<f>` to enable local refine passes.".into());
            push_log(state, "\nOptions:".into());
            push_log(state, "  default     - Sweep default parameter set".into());
            push_log(state, "  all         - Sweep all available parameters".into());
            push_log(state, "  custom      - Specify custom ranges for each parameter".into());
            push_log(state, "\nExample - Default sweep:".into());
            push_log(state, "  /sweep default".into());
            push_log(state, "  /start-sweep".into());
            push_log(state, "\nExample - Custom ranges:".into());
            push_log(state, "  /sweep mutation_rate=0.1:0.5:0.1 max_depth=3:8:1".into());
            push_log(state, "  /start-sweep".into());
        }
        "set" => {
            push_log(state, "\n=== /set ===".into());
            push_log(state, "Sets runtime configuration parameters.".into());
            push_log(state, "Usage: /set <param> <value>".into());
            push_log(state, "\nAvailable parameters:".into());
            for param in SET_PARAMETERS {
                push_log(state, format!("  - {}", param));
            }
            push_log(state, "\nExample:".into());
            push_log(state, "  /set mutation_rate 0.25".into());
            push_log(state, "  /set max_generations 10000".into());
        }
        "export-params" | "import-params" => {
            push_log(state, "\n=== Parameter Import/Export ===".into());
            push_log(state, "/export-params  - Save current parameters to JSON file".into());
            push_log(state, "/import-params <file>  - Load parameters from JSON file".into());
            push_log(state, "\nExamples:".into());
            push_log(state, "  /export-params".into());
            push_log(state, "  /import-params parameters_1234567890.json".into());
        }
        "dump" => {
            push_log(state, "\n=== /dump ===".into());
            push_log(state, "Exports current solver state to JSON file.".into());
            push_log(state, "Usage: /dump".into());
            push_log(state, "\nIncludes:".into());
            push_log(state, "  - Current best formula and error".into());
            push_log(state, "  - Generation and progress information".into());
            push_log(state, "  - Top 5 candidate formulas".into());
            push_log(state, "  - Target formula (for synthetic data)".into());
        }
        "clustering" => {
            push_log(state, "\n=== Clustering (Preview) ===".into());
            push_log(state, "Automatic data clustering during preprocessing.".into());
            push_log(state, "\nFeature: Enabled with 'clustering' build feature".into());
            push_log(state, "\nClustering is automatically performed when /start-formula is executed".into());
            push_log(state, "and clustering is configured in miner_config.toml".into());
            push_log(state, "\nConfiguration (in miner_config.toml):".into());
            push_log(state, "  [clustering]".into());
            push_log(state, "  method = \"kmeans\"              # Decision tree, K-means, SVM".into());
            push_log(state, "  max_depth = 5                    # For tree-based methods".into());
            push_log(state, "  min_samples_leaf = 1             # Minimum samples per leaf".into());
            push_log(state, "  num_clusters = 3                 # Target number of clusters".into());
            push_log(state, "  n_trees = 10                     # For ensemble methods".into());
            push_log(state, "\nOutput:".into());
            push_log(state, "  - Clustering panel shows cluster distribution".into());
            push_log(state, "  - Best Solution panel displays clustering rules applied".into());
            push_log(state, "  - Each cluster is optimized independently during GA".into());
        }
        _ => {
            push_log(state, format!("No detailed help available for '{}'", topic));
            push_log(state, "Available topics: start-formula, start-sweep, sweep, set, export-params, import-params, dump, clustering".into());
        }
    }
}


