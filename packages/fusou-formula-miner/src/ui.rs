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
            Constraint::Length(7),
            Constraint::Min(5),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(f.size());

    render_title(f, state, chunks[0]);
    render_status(f, state, chunks[1]);
    
    // Split chunks[2] horizontally: Best Solution on left, Config on right
    let solution_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
        .split(chunks[2]);
    
    render_best_solution(f, state, solution_chunks[0]);
    render_config(f, state, solution_chunks[1]);
    
    render_logs(f, state, chunks[3]);
    render_input(f, state, chunks[4]);
}

fn render_title(f: &mut Frame, state: &SolverState, area: Rect) {
    let job_text = state
        .job_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "no job assigned".to_string());
    let title_text = format!(
        "{} v{} | Worker {} | Phase: {:?} | Job: {}",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        state.worker_id,
        state.phase,
        job_text
    );
    let online_text = if state.online { "Online" } else { "Offline" };
    let title_text = format!("{} | Mode: {}", title_text, online_text);
    let title = Paragraph::new(title_text).block(Block::default().borders(Borders::ALL));
    f.render_widget(title, area);
}

fn render_status(f: &mut Frame, state: &SolverState, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(2)])
        .split(area);

    let gauge = Gauge::default()
        .block(Block::default().borders(Borders::ALL).title("Progress"))
        .gauge_style(Style::default().fg(Color::Green))
        .ratio(state.progress.min(1.0));
    f.render_widget(gauge, chunks[0]);

    let feature_count = if state.selected_features.is_empty() {
        0
    } else {
        state.selected_features.len()
    };
    let features_preview = if state.selected_features.is_empty() {
        "(pending selection)".to_string()
    } else {
        let joined = state.selected_features.join(", ");
        if joined.len() > 60 {
            format!("{}…", &joined[..60])
        } else {
            joined
        }
    };

    let max_gen = if state.max_generations == 0 {
        "∞".to_string()
    } else {
        state.max_generations.to_string()
    };

    let summary = format!(
        "Samples: {} | Features: {}\nMax generations: {} | Target RMSE ≤ {:.5}\nCorr threshold ≥ {:.3}\nSelection: {}",
        state.sample_count,
        feature_count,
        max_gen,
        state.target_error,
        state.correlation_threshold,
        features_preview
    );

    // Data source: used for both title and summary
    let data_source = if state.target_formula.is_some() {
        "Synthetic (ground truth shown)".to_string()
    } else if state.online {
        "Server".to_string()
    } else {
        "Local/Unknown".to_string()
    };

    // Compose final summary (body) and append ground-truth if present
    let mut summary = summary;
    if let Some(gt) = &state.target_formula {
        summary = format!("{}\nGround truth: {}", summary, gt);
    }

    // Put data source into the block title so it's visible even when body is small
    let title_label = format!("Job status - Data source: {}", data_source);
    let summary_block = Paragraph::new(summary)
        .block(Block::default().borders(Borders::ALL).title(title_label))
        .wrap(Wrap { trim: true });
    f.render_widget(summary_block, chunks[1]);
}

fn render_best_solution(f: &mut Frame, state: &SolverState, area: Rect) {
    // Build info text with best solution prominently displayed
    let mut info_text = format!(
        "Generation: {} / {}\nBest RMSE: {:.6} (target {:.6})\n\n─ BEST SOLUTION ─\n{}",
        state.generation,
        state.max_generations,
        state.best_error,
        state.target_error,
        state.best_formula
    );
    
    // Add top 5 candidates below best solution
    if !state.top_candidates.is_empty() {
        info_text.push_str("\n\n─ Top Candidates ─");
        for cand in &state.top_candidates {
            // Format: #1: 0.045230 | (atk - def) * (1.0 + 0.1 * step(...))
            let formula_preview = if cand.formula.len() > 60 {
                format!("{}...", &cand.formula[..57])
            } else {
                cand.formula.clone()
            };
            info_text.push_str(&format!(
                "\n#{}: {:.6} | {}",
                cand.rank, cand.rmse, formula_preview
            ));
        }
    }
    
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

fn render_config(f: &mut Frame, state: &SolverState, area: Rect) {
    // Display current GA configuration
    let config_text = if let Some(ref shared_config) = state.shared_config {
        match shared_config.lock() {
            Ok(cfg) => {
                format!(
                    "GA Configuration\n\n\
                     Population: {}\n\
                     Max Depth: {}\n\
                     Mutation: {:.2}\n\
                     Crossover: {:.2}\n\
                     Tournament: {}\n\
                     Elite: {}\n\
                     Attempts: {}\n\
                     Use NSGA2: {}\n\
                     Tarpeian: {:.2}\n\
                     Hoist Mut: {:.2}\n\
                     Const Opt: {}",
                    cfg.population_size,
                    cfg.max_depth,
                    cfg.mutation_rate,
                    cfg.crossover_rate,
                    cfg.tournament_size,
                    cfg.elite_count,
                    cfg.max_attempts,
                    cfg.use_nsga2,
                    cfg.tarpeian_probability,
                    cfg.hoist_mutation_rate,
                    cfg.constant_optimization_interval
                )
            }
            Err(_) => "Config: (locked)".to_string(),
        }
    } else {
        "No shared config".to_string()
    };

    let config = Paragraph::new(config_text)
        .block(Block::default().borders(Borders::ALL).title("Config"))
        .wrap(Wrap { trim: true });
    f.render_widget(config, area);
}

fn render_input(f: &mut Frame, state: &SolverState, area: Rect) {
    let cmd_text = if state.input_buffer.is_empty() {
        "Type /help for commands".to_string()
    } else {
        let suggestions = if state.command_suggestions.is_empty() {
            String::new()
        } else {
            format!(" [suggestions: {}]", state.command_suggestions.join(", "))
        };
        format!("Command: {}{}", state.input_buffer, suggestions)
    };
    let cmd_input =
        Paragraph::new(cmd_text).block(Block::default().borders(Borders::ALL).title("Input"));
    f.render_widget(cmd_input, area);
}
