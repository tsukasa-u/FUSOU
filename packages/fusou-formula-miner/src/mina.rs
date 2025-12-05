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
