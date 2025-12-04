use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, MouseEvent, MouseEventKind};

const COMMANDS: &[(&str, &str)] = &[
    ("/help", "Show available commands"),
    ("/version", "Show package name and version"),
    ("/best", "Show current best formula"),
    ("/clear", "Clear all logs"),
    ("/quit", "Exit the application"),
];

// Handle simple commands from the user keyboard while the TUI runs.
// Public API: returns `true` when the caller should exit the app.
pub fn handle_key_event(key: KeyEvent, state: &mut crate::SolverState) -> bool {
    // Only act on Key presses (not repeats / releases)
    if key.kind != KeyEventKind::Press {
        return false;
    }

    match key.code {
        KeyCode::Left => {
            state.focused_panel = crate::FocusedPanel::BestSolution;
        }
        KeyCode::Right => {
            state.focused_panel = crate::FocusedPanel::Logs;
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
        KeyCode::Enter => {
            let cmd = state.input_buffer.trim().to_string();
            state.input_buffer.clear();
            state.command_suggestions.clear();
            return execute_command(&cmd, state);
        }
        KeyCode::Esc => {
            state.input_buffer.clear();
            state.command_suggestions.clear();
        }
        _ => {}
    }

    false
}

fn update_suggestions(state: &mut crate::SolverState) {
    state.command_suggestions.clear();
    if state.input_buffer.is_empty() || !state.input_buffer.starts_with('/') {
        return;
    }
    for (cmd, _) in COMMANDS {
        if cmd.starts_with(&state.input_buffer) {
            state.command_suggestions.push(cmd.to_string());
        }
    }
}

fn execute_command(cmd: &str, state: &mut crate::SolverState) -> bool {
    match cmd {
        "/quit" => return true,
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
            push_log(state, format!("Unknown command: {}. Type /help for available commands.", cmd));
        }
        _ => {}
    }
    false
}

fn push_log(state: &mut crate::SolverState, msg: String) {
    state.logs.push(msg);
    if state.logs.len() > 10 {
        state.logs.remove(0);
    }
    // Auto-scroll to bottom when new log arrives
    state.log_scroll_offset = 0;
}

pub fn handle_mouse_event(mouse: MouseEvent, state: &mut crate::SolverState) {
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

fn scroll_focused_up(state: &mut crate::SolverState) {
    match state.focused_panel {
        crate::FocusedPanel::Logs => {
            if state.log_scroll_offset + 1 < state.logs.len() {
                state.log_scroll_offset += 1;
            }
        }
        crate::FocusedPanel::BestSolution => {
            let line_count = count_best_solution_lines(state);
            if state.best_solution_scroll_offset + 1 < line_count {
                state.best_solution_scroll_offset += 1;
            }
        }
    }
}

fn scroll_focused_down(state: &mut crate::SolverState) {
    match state.focused_panel {
        crate::FocusedPanel::Logs => {
            if state.log_scroll_offset > 0 {
                state.log_scroll_offset -= 1;
            }
        }
        crate::FocusedPanel::BestSolution => {
            if state.best_solution_scroll_offset > 0 {
                state.best_solution_scroll_offset -= 1;
            }
        }
    }
}

fn count_best_solution_lines(state: &crate::SolverState) -> usize {
    let text = format!(
        "Gen: {}\nError: {:.6}\n\nCandidate:\n>> {}",
        state.generation, state.best_error, state.best_formula
    );
    text.lines().count()
}
