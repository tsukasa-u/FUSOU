use crate::state::SolverState;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, MouseEvent, MouseEventKind};
use std::sync::{Arc, atomic::Ordering};
use std::thread;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusedPanel {
    BestSolution,
    Logs,
}

const COMMANDS: &[(&str, &str)] = &[
    ("/help", "Show available commands"),
    ("/version", "Show package name and version"),
    ("/best", "Show current best formula"),
    ("/clear", "Clear all logs"),
    ("/copylogs", "Write logs to file and copy to clipboard if possible"),
    ("/quit", "Exit the application"),
    ("/stop", "Stop current solver run"),
    ("/start", "Start a fresh solver run"),
    ("/set", "Set runtime config: /set <param> <value>"),
    ("/dump", "Export solver state and results to JSON"),
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

// Handle simple commands from the user keyboard while the TUI runs.
// Public API: returns `true` when the caller should exit the app.
pub fn handle_key_event(key: KeyEvent, state: &mut SolverState) -> bool {
    // Only act on Key presses (not repeats / releases)
    if key.kind != KeyEventKind::Press {
        return false;
    }

    match key.code {
        KeyCode::Left => {
            state.focused_panel = FocusedPanel::BestSolution;
        }
        KeyCode::Right => {
            state.focused_panel = FocusedPanel::Logs;
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
        "/start" => {
            // Start a new solver run from scratch
            // Check if solver is already running using the solver_running flag
            if state.solver_running {
                push_log(state, "Solver is already running.".into());
                return false;
            }

            // Need event sender and shared config to spawn solver
            let sender = match &state.event_sender {
                Some(s) => s.clone(),
                None => {
                    push_log(state, "Cannot start solver: no event sender available".into());
                    return false;
                }
            };

            let _shared_config = match &state.shared_config {
                Some(cfg) => cfg.clone(),
                None => {
                    push_log(state, "Cannot start solver: no shared configuration".into());
                    return false;
                }
            };

            // Show current configuration before starting
            let config_str = if let Some(cfg_arc) = &state.shared_config {
                if let Ok(cfg) = cfg_arc.lock() {
                    format!(
                        "Starting optimization with config:\n  population_size: {}\n  mutation_rate: {}\n  max_depth: {}\n  max_generations: {}",
                        cfg.population_size, cfg.mutation_rate, cfg.max_depth, state.max_generations
                    )
                } else {
                    format!("Starting optimization with max_generations: {}", state.max_generations)
                }
            } else {
                format!("Starting optimization with max_generations: {}", state.max_generations)
            };
            push_log(state, config_str);

            // Mark solver as running
            state.solver_running = true;

            // Request main loop to start a fresh solver run (main will spawn thread)
            if sender.send(crate::state::AppEvent::StartRequested).is_err() {
                push_log(state, "Failed to request solver start (sender closed)".into());
                state.solver_running = false;
            } else {
                push_log(state, "Start requested: main will spawn a fresh solver run".into());
            }
            return false;
        }
        "/version" => {
            let v = format!("{} v{}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
            push_log(state, v);
        }
        "/help" => {
            push_log(state, "Available commands:".into());
            for (cmd, desc) in COMMANDS {
                push_log(state, format!("  {} - {}", cmd, desc));
            }
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
                    let path = dir.join(&filename);
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
                        let path = dir.join(&filename);
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
    state.logs.push(msg);
    if state.logs.len() > 200 {
        state.logs.drain(0..state.logs.len() - 200);
    }
    // Auto-scroll to bottom when new log arrives
    state.log_scroll_offset = 0;
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
    }
}

fn count_best_solution_lines(state: &SolverState) -> usize {
    let text = format!(
        "Gen: {}\nError: {:.6}\n\nCandidate:\n>> {}",
        state.generation, state.best_error, state.best_formula
    );
    text.lines().count()
}
