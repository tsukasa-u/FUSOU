use crate::mina::FocusedPanel;
use crate::state::SolverState;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Gauge, List, ListItem, Paragraph, Wrap},
};

pub fn render_ui(f: &mut Frame, state: &SolverState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Min(5),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(f.size());

    render_title(f, state, chunks[0]);
    render_progress(f, state, chunks[1]);
    render_best_solution(f, state, chunks[2]);
    render_logs(f, state, chunks[3]);
    render_input(f, state, chunks[4]);
}

fn render_title(f: &mut Frame, state: &SolverState, area: Rect) {
    let title_text = format!(
        "{} v{} - Phase: {:?}",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        state.phase
    );
    let title = Paragraph::new(title_text).block(Block::default().borders(Borders::ALL));
    f.render_widget(title, area);
}

fn render_progress(f: &mut Frame, state: &SolverState, area: Rect) {
    let gauge = Gauge::default()
        .block(Block::default().borders(Borders::ALL).title("Progress"))
        .gauge_style(Style::default().fg(Color::Green))
        .ratio(state.progress);
    f.render_widget(gauge, area);
}

fn render_best_solution(f: &mut Frame, state: &SolverState, area: Rect) {
    let info_text = format!(
        "Gen: {}\nError: {:.6}\n\nCandidate:\n>> {}",
        state.generation, state.best_error, state.best_formula
    );
    let info_lines: Vec<&str> = info_text.lines().collect();
    let visible_info_lines: Vec<&str> = info_lines
        .iter()
        .skip(state.best_solution_scroll_offset)
        .copied()
        .collect();
    let info_display = visible_info_lines.join("\n");
    let best_title = if state.focused_panel == FocusedPanel::BestSolution {
        format!(
            "Best Solution [focused] [{}/{}]",
            state.best_solution_scroll_offset + 1,
            info_lines.len()
        )
    } else {
        format!(
            "Best Solution [{}/{}]",
            state.best_solution_scroll_offset + 1,
            info_lines.len()
        )
    };
    let best_border_style = if state.focused_panel == FocusedPanel::BestSolution {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };
    let info = Paragraph::new(info_display)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(best_title)
                .border_style(best_border_style),
        )
        .wrap(Wrap { trim: true });
    f.render_widget(info, area);
}

fn render_logs(f: &mut Frame, state: &SolverState, area: Rect) {
    let log_count = state.logs.len();
    let visible_start = state.log_scroll_offset;
    let logs: Vec<ListItem> = state
        .logs
        .iter()
        .skip(visible_start)
        .map(|s| ListItem::new(s.as_str()))
        .collect();
    let scroll_info = if state.focused_panel == FocusedPanel::Logs {
        if log_count > 0 {
            format!("Logs [focused] [{}/{}]", visible_start + 1, log_count)
        } else {
            "Logs [focused]".to_string()
        }
    } else {
        if log_count > 0 {
            format!("Logs [{}/{}]", visible_start + 1, log_count)
        } else {
            "Logs".to_string()
        }
    };
    let log_border_style = if state.focused_panel == FocusedPanel::Logs {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };
    let log_list = List::new(logs).block(
        Block::default()
            .borders(Borders::ALL)
            .title(scroll_info)
            .border_style(log_border_style),
    );
    f.render_widget(log_list, area);
}

fn render_input(f: &mut Frame, state: &SolverState, area: Rect) {
    let cmd_text = if state.input_buffer.is_empty() {
        "Type /help for commands".to_string()
    } else {
        let suggestions = if state.command_suggestions.is_empty() {
            String::new()
        } else {
            format!(
                " [suggestions: {}]",
                state.command_suggestions.join(", ")
            )
        };
        format!("Command: {}{}", state.input_buffer, suggestions)
    };
    let cmd_input = Paragraph::new(cmd_text).block(Block::default().borders(Borders::ALL).title("Input"));
    f.render_widget(cmd_input, area);
}
