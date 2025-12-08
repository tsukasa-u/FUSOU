use crate::mina::FocusedPanel;
use crate::state::SolverState;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Gauge, List, ListItem, Paragraph, Wrap},
};
// no direct Instant use here (timestamps handled in state)

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
    // Make Config narrower so we can allocate more room to operator stats.
    let solution_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(80), Constraint::Percentage(20)])
        .split(chunks[2]);
    
    render_best_solution(f, state, solution_chunks[0]);
    render_config(f, state, solution_chunks[1]);
    
    // Split chunks[3] horizontally: Logs on left, Clustering on right (always show clustering panel)
    let logs_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
        .split(chunks[3]);
    render_logs(f, state, logs_chunks[0]);
    render_clustering_panel(f, state, logs_chunks[1]);
    
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
    let dashboard_text = "📊 Dashboard: http://localhost:3030/dashboard";
    let title_text = format!("{} | {}", title_text, dashboard_text);
    let title = Paragraph::new(title_text).block(Block::default().borders(Borders::ALL));
    f.render_widget(title, area);
}

fn render_status(f: &mut Frame, state: &SolverState, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(2)])
        .split(area);

    let progress_ratio = if state.max_generations > 0 {
        state.progress.min(1.0).max(0.0)
    } else {
        0.0
    };

    let progress_label = if state.max_generations > 0 {
        format!("{:.1}% ({}/{})", 
            progress_ratio * 100.0,
            state.generation,
            state.max_generations
        )
    } else {
        format!("0% (0/{})", state.max_generations)
    };

    let gauge = Gauge::default()
        .block(Block::default().borders(Borders::ALL).title("Progress"))
        .gauge_style(Style::default().fg(Color::Green))
        .label(progress_label)
        .ratio(progress_ratio);
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

    // If a sweep is running or configured, show sweep progress
    if let Some(sweep) = &state.sweep_config {
        let sweep_progress = format!("\nSweep: {}/{} | Best RMSE: {:.6}", sweep.current_iteration, sweep.total_iterations, sweep.best_error);
        let refinement_info = if sweep.in_refinement_mode {
            format!(" | Refinement {}/{} (parent {})", sweep.refinement_current_iteration, sweep.refinement_total_iterations, sweep.refinement_parent_iteration.unwrap_or(0))
        } else if sweep.refinement_enabled {
            format!(" | Refinements used: {}/{}", sweep.current_refinement, sweep.max_refinements)
        } else {
            String::new()
        };

        // Estimate ETA based on historical average run duration
        let eta_info = if !sweep.historical_run_durations.is_empty() {
            let sum: f64 = sweep.historical_run_durations.iter().sum();
            let avg = sum / (sweep.historical_run_durations.len() as f64);
            // remaining main iterations
            let remaining_main = if sweep.total_iterations > sweep.current_iteration {
                (sweep.total_iterations - sweep.current_iteration) as f64
            } else { 0.0 };
            // remaining repeats for current setting
            let remaining_repeats = if sweep.repeats_per_setting > sweep.current_repeat {
                (sweep.repeats_per_setting - sweep.current_repeat) as f64
            } else { 0.0 };
            let remaining_refinement = if sweep.in_refinement_mode {
                (sweep.refinement_total_iterations.saturating_sub(sweep.refinement_current_iteration)) as f64
            } else { 0.0 };
            let total_remaining_runs = remaining_main * (sweep.repeats_per_setting as f64) + remaining_repeats + remaining_refinement;
            let eta_seconds = avg * total_remaining_runs;
            let mins = (eta_seconds / 60.0).floor() as u64;
            let secs = (eta_seconds % 60.0).round() as u64;
            format!(" | ETA ~ {}m{}s", mins, secs)
        } else {
            String::new()
        };

        summary = format!("{}{}{}{}", summary, sweep_progress, refinement_info, eta_info);
    }

    // If solver is running, show active parameter snapshot
    if state.solver_running {
        if let Some(cfg_arc) = &state.shared_config {
            if let Ok(cfg) = cfg_arc.lock() {
                let params = format!("\nActive params: pop={} depth={} mut={:.3} cross={:.3} tour={} elite={} max_gen={}",
                    cfg.population_size, cfg.max_depth, cfg.mutation_rate, cfg.crossover_rate, cfg.tournament_size, cfg.elite_count, state.max_generations);
                summary = format!("{}{}", summary, params);
            }
        }
    }

    // Put data source into the block title so it's visible even when body is small
    let title_label = format!("Job status - Data source: {}", data_source);
    // Append duplicate tracker stats if available
    let dup_info = match state.duplicate_tracker.lock() {
        Ok(tracker) => format!("\nDuplicate history: {} unique formulas tracked", tracker.tracked_count()),
        Err(_) => String::new(),
    };

    // Append selected synthetic dataset type (if config available)
    let dataset_info = match state.miner_config.lock() {
        Ok(mc) => format!("\nSynthetic dataset type: {}", mc.synthetic_data.dataset_type),
        Err(_) => String::new(),
    };

    let summary_with_dup = format!("{}{}{}", summary, dup_info, dataset_info);

    let summary_block = Paragraph::new(summary_with_dup)
        .block(Block::default().borders(Borders::ALL).title(title_label))
        .wrap(Wrap { trim: true });
    f.render_widget(summary_block, chunks[1]);
}

fn render_best_solution(f: &mut Frame, state: &SolverState, area: Rect) {
    // Split area: main best-solution text (left) and operator stats (right)
    // Split the Best Solution area: left = main solution, right = operator stats
    // Give operator stats more space (35% of the BestSolution area)
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(65), Constraint::Percentage(35)])
        .split(area);

    // Left column split: header (generation & global best), per-cluster best list, top candidates
    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(6),
            Constraint::Min(6),
        ])
        .split(cols[0]);

    // Header: show generation (sum or proportion) and global best
    let denom = if state.total_work > 0 { state.total_work.to_string() } else { state.max_generations.to_string() };
    let header_text = format!(
        "Generation: {} / {}\nBest RMSE: {:.6} (target {:.6})",
        state.generation,
        denom,
        state.best_error,
        state.target_error
    );
    let header = Paragraph::new(header_text)
        .block(Block::default().borders(Borders::ALL).title("Best Solution"))
        .wrap(Wrap { trim: true });
    f.render_widget(header, left_chunks[0]);

    // Per-cluster bests as a List so we can highlight the active cluster row
    let mut cluster_items: Vec<ListItem> = Vec::new();
    let mut labels: Vec<_> = state.per_cluster_best.keys().cloned().collect();
    labels.sort();
    for label in labels.iter() {
        if let Some((err, formula)) = state.per_cluster_best.get(label) {
            let gen = state.per_cluster_generation.get(label).cloned().unwrap_or(0);
            let line = format!("{} - gen {} | RMSE {:.6}", label, gen, err);
            cluster_items.push(ListItem::new(line));
            // Also push formula as an indented line
            cluster_items.push(ListItem::new(format!("  {}", formula)));
        }
    }
    let mut cluster_list_state = ratatui::widgets::ListState::default();
    // Find selected index for current_cluster_label (selects the first line of the cluster entry)
    if let Some(active_label) = &state.current_cluster_label {
        // Each cluster contributes 2 items (label line + formula), so find its index
        let mut idx = 0usize;
        for lbl in labels.iter() {
            if lbl == active_label {
                cluster_list_state.select(Some(idx));
                break;
            }
            idx += 2;
        }
    }
    let cluster_block_style = if state.focused_panel == FocusedPanel::BestSolution {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };
    let cluster_list = List::new(cluster_items)
        .block(Block::default().borders(Borders::ALL).title("Per-Cluster Bests").border_style(cluster_block_style))
        .highlight_style(Style::default().fg(Color::LightCyan));
    f.render_stateful_widget(cluster_list, left_chunks[1], &mut cluster_list_state);

    // Top candidates list (respect state.top_candidates_limit)
    let limit = state.top_candidates_limit.min(state.top_candidates.len()).max(0);
    let mut cand_items: Vec<ListItem> = Vec::new();
    for cand in state.top_candidates.iter().take(limit) {
        let formula_preview = if cand.formula.len() > 80 {
            format!("{}...", &cand.formula[..77])
        } else {
            cand.formula.clone()
        };
        cand_items.push(ListItem::new(format!("#{}: {:.6} | {}", cand.rank, cand.rmse, formula_preview)));
    }
    let cand_block_style = if state.focused_panel == FocusedPanel::BestSolution { Style::default().fg(Color::Yellow) } else { Style::default() };
    let cand_list = List::new(cand_items)
        .block(Block::default().borders(Borders::ALL).title(format!("Top Candidates (showing {})", state.top_candidates_limit)).border_style(cand_block_style));
    let mut cand_state = ratatui::widgets::ListState::default();
    f.render_stateful_widget(cand_list, left_chunks[2], &mut cand_state);

    // Compute operator probabilities from cumulative counts in state
    let stats = compute_operator_prob_stats(state);
    // Determine available width for the operator column and compute a compact bar width.
    let col_width = cols[1].width as usize;
    // Reserve space for label, separators and percent/count fields.
    let label_w = 6usize; // e.g. 'identity' will be truncated
    let percent_w = 6usize; // e.g. '100.0%'
    let separators = 6usize; // spaces and pipes
    let mut bar_width = if col_width > (label_w + percent_w + separators) {
        col_width - (label_w + percent_w + separators)
    } else {
        8usize
    };
    if bar_width > 40 { bar_width = 40 }
    // Compute total cumulative operator selections and show it in the block title
    let total: usize = stats.iter().map(|(_, _, c)| *c).sum();

    let items: Vec<ListItem> = stats
        .into_iter()
        .map(|(label, prob, _count)| {
            // Truncate label if too long
            let mut label_display = label.clone();
            if label_display.len() > label_w {
                label_display.truncate(label_w);
            }
            // Build bar proportional to probability
            let filled = ((prob / 100.0) * (bar_width as f64)).round() as usize;
            let filled = filled.min(bar_width);
            let empty = bar_width - filled;
            let bar = format!("{}{}", "█".repeat(filled), "░".repeat(empty));
            // Compact one-line format (no per-operator count): label |bar| XX.X%
            let line = format!("{:<label_w$} |{}| {:>5.1}%", label_display, bar, prob, label_w=label_w);
            ListItem::new(line)
        })
        .collect();

    let mut list_state = ratatui::widgets::ListState::default();
    if state.operator_selected_index < items.len() {
        list_state.select(Some(state.operator_selected_index));
    } else if !items.is_empty() {
        list_state.select(Some(0));
    }

    let ops_border_style = if state.focused_panel == FocusedPanel::OperatorStats {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };
    let ops_list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(format!("Operator Stats (total: {})", total))
                .border_style(ops_border_style)
        )
        .highlight_style(Style::default().fg(Color::Yellow))
        .highlight_symbol("> ");
    f.render_stateful_widget(ops_list, cols[1], &mut list_state);
}

// Scan best solution and top candidates (formula strings) and compute operator occurrence
// probabilities. This is a lightweight, string-based heuristic (avoids requiring Expr objects
// to be passed through state). Returns formatted lines ready for display.
fn compute_operator_prob_stats(state: &SolverState) -> Vec<(String, f64, usize)> {
    // If the solver provided AST-based operator counts, prefer them (most accurate)
    let ordered_labels = vec!["+","-","*","/","min","max","step","log","sqrt","exp","floor","pow"];
    if !state.operator_counts.is_empty() {
        let map: std::collections::HashMap<String, usize> = state
            .operator_counts
            .iter()
            .cloned()
            .collect();
        let total: usize = map.values().sum();
        let mut stats = Vec::new();
        for label in ordered_labels {
            let cnt = *map.get(label).unwrap_or(&0);
            let prob = if total == 0 { 0.0 } else { (cnt as f64) / (total as f64) * 100.0 };
            stats.push((label.to_string(), prob, cnt));
        }
        return stats;
    }

    // Fallback: lightweight string-scan heuristic (used when operator_counts not available)
    let ops = vec![
        ("+", " + "),
        ("-", " - "),
        ("*", " * "),
        ("/", " / "),
        ("min", "min("),
        ("max", "max("),
        ("step", "step("),
        ("log", "log("),
        ("sqrt", "sqrt("),
        ("exp", "exp("),
        ("floor", "floor("),
    ];

    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    let mut total = 0usize;

    // Helper to scan a formula string
    let scan = |s: &str, counts: &mut std::collections::HashMap<&str, usize>, total: &mut usize| {
        for (label, pat) in &ops {
            if pat.is_empty() {
                continue;
            }
            let mut start = 0usize;
            while let Some(pos) = s[start..].find(pat) {
                *counts.entry(label).or_insert(0) += 1;
                *total += 1;
                start += pos + pat.len();
            }
        }
    };

    if !state.best_formula.is_empty() {
        scan(&state.best_formula, &mut counts, &mut total);
    }
    for cand in &state.top_candidates {
        scan(&cand.formula, &mut counts, &mut total);
    }

    // Always return all ops; if total==0 then probabilities are zero
    let mut stats = Vec::new();
    for (label, _pat) in ops {
        let cnt = *counts.get(label).unwrap_or(&0);
        let prob = if total == 0 { 0.0 } else { (cnt as f64) / (total as f64) * 100.0 };
        stats.push((label.to_string(), prob, cnt));
    }
    stats
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
    
    
    // Change border color to red if IME/Japanese mode is active
    let input_block = if state.ime_mode_active {
        Block::default()
            .borders(Borders::ALL)
            .border_style(ratatui::style::Style::default().fg(ratatui::style::Color::Red))
            .title("Input (Japanese Mode Detected)")
    } else {
        Block::default()
            .borders(Borders::ALL)
            .title("Input")
    };
    
    let cmd_input = Paragraph::new(cmd_text).block(input_block);
    f.render_widget(cmd_input, area);
}

fn render_clustering_panel(f: &mut Frame, state: &SolverState, area: Rect) {
    let cluster_text = match &state.cluster_assignments {
        Some(assignments) => {
            // Parse JSON-serialized cluster assignments
            match serde_json::from_value::<std::collections::HashMap<String, serde_json::Value>>(
                assignments.clone()
            ) {
                Ok(data) => {
                    let num_clusters = data.get("num_clusters")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    
                    let cluster_sizes = data.get("cluster_sizes")
                        .and_then(|v| v.as_object())
                        .map(|obj| {
                            obj.iter()
                                .map(|(k, v)| format!("C{}: {}", k, v.as_u64().unwrap_or(0)))
                                .collect::<Vec<_>>()
                                .join(" | ")
                        })
                        .unwrap_or_else(|| "N/A".to_string());
                    
                    let method = data.get("method")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    
                    let quality = data.get("quality_score")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    
                    let rules = data.get("rules")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str())
                                .take(3)  // Show only first 3 rules
                                .map(|r| format!("• {}", r))
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_else(|| "".to_string());
                    
                    // Extract centroids
                    let centroids_str = data.get("centroids")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .enumerate()
                                .map(|(c_id, centroid)| {
                                    if let Some(vals) = centroid.as_array() {
                                        let formatted = vals.iter()
                                            .filter_map(|v| v.as_f64())
                                            .map(|f| format!("{:.2}", f))
                                            .collect::<Vec<_>>()
                                            .join(", ");
                                        format!("  C{}: [{}]", c_id, formatted)
                                    } else {
                                        format!("  C{}: N/A", c_id)
                                    }
                                })
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_else(|| "".to_string());
                    
                    // Extract cluster conditions
                    let conditions_str = data.get("cluster_conditions")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .enumerate()
                                .filter_map(|(c_id, cond)| {
                                    cond.as_str().map(|s| format!("  C{}: {}", c_id, s))
                                })
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_else(|| "".to_string());
                    
                    let mut text = format!(
                        "Clusters: {}\n{}\nMethod: {}\nQuality: {:.2}",
                        num_clusters,
                        cluster_sizes,
                        method,
                        quality
                    );
                    
                    if !rules.is_empty() {
                        text.push_str(&format!("\n\nRules:\n{}", rules));
                    }
                    
                    if !centroids_str.is_empty() {
                        text.push_str(&format!("\n\nCentroids:\n{}", centroids_str));
                    }
                    
                    if !conditions_str.is_empty() {
                        text.push_str(&format!("\n\nConditions:\n{}", conditions_str));
                    }

                    // Show feature mapping f0,f1,... -> feature names (if available from state)
                    if !state.selected_features.is_empty() {
                        let mut fmap = String::from("\n\nFeature mapping:\n");
                        for (i, fname) in state.selected_features.iter().enumerate() {
                            fmap.push_str(&format!("  f{} -> {}\n", i, fname));
                        }
                        // Show s label mapping note (s -> f0,f1,...)
                        fmap.push_str("\nNote: sample label 's' corresponds to feature indices f0,f1,... in order.\n");
                        text.push_str(&fmap);
                    }
                    
                    text
                }
                Err(_) => "Clustering data corrupted".to_string(),
            }
        }
        None => "No clustering performed\n\nClustering disabled in config".to_string(),
    };
    
    let block = Block::default()
        .borders(Borders::ALL)
        .title("Clustering")
        .border_style(
            if state.focused_panel == FocusedPanel::Logs {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default()
            }
        );
    
    let paragraph = Paragraph::new(cluster_text)
        .block(block)
        .wrap(Wrap { trim: true });
    
    f.render_widget(paragraph, area);
}

