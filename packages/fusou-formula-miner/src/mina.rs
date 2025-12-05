use crate::state::SolverState;
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, MouseEvent, MouseEventKind};

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
            update_suggestions(state);
        }
        KeyCode::Backspace => {
            state.input_buffer.pop();
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
    if state.input_buffer.is_empty() || !state.input_buffer.starts_with('/') {
        state.suggestion_selected = None;
        return;
    }
    for (cmd, _) in COMMANDS {
        if cmd.starts_with(&state.input_buffer) {
            state.command_suggestions.push(cmd.to_string());
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
            let cfg_arc_opt = state.shared_config.clone();
            if let Some(cfg_arc) = cfg_arc_opt {
                match cfg_arc.lock() {
                    Ok(mut cfg) => {
                        let lower = key.to_lowercase();
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
