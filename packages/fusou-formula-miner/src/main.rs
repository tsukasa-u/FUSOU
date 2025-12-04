use anyhow::Result;
use crossterm::{
    event::{self, Event, EnableMouseCapture, DisableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use rand::prelude::*;
use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Gauge, List, ListItem, Paragraph, Wrap},
};
use std::{
    io,
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::Duration,
};

mod mina;

// --- Statistics Helper ---
fn calculate_correlation(x: &[f64], y: &[f64]) -> f64 {
    if x.len() != y.len() || x.is_empty() {
        return 0.0;
    }
    let n = x.len() as f64;
    let mean_x: f64 = x.iter().sum::<f64>() / n;
    let mean_y: f64 = y.iter().sum::<f64>() / n;
    let cov: f64 = x
        .iter()
        .zip(y.iter())
        .map(|(xi, yi)| (xi - mean_x) * (yi - mean_y))
        .sum();
    let var_x: f64 = x.iter().map(|xi| (xi - mean_x).powi(2)).sum();
    let var_y: f64 = y.iter().map(|yi| (yi - mean_y).powi(2)).sum();
    if var_x < 1e-9 || var_y < 1e-9 {
        return 0.0;
    }
    cov / (var_x.sqrt() * var_y.sqrt())
}

fn calculate_variance(x: &[f64]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    let mean: f64 = x.iter().sum::<f64>() / x.len() as f64;
    x.iter().map(|xi| (xi - mean).powi(2)).sum::<f64>() / x.len() as f64
}

// --- Preprocessing ---
#[derive(Clone)]
struct Dataset {
    feature_names: Vec<String>,
    inputs: Vec<Vec<f64>>,
    targets: Vec<f64>,
}

impl Dataset {
    fn filter_features(&self, correlation_threshold: f64) -> (Vec<usize>, Vec<String>) {
        let mut selected_indices = Vec::new();
        let mut logs = Vec::new();

        for (i, name) in self.feature_names.iter().enumerate() {
            let feature_values: Vec<f64> = self.inputs.iter().map(|row| row[i]).collect();
            let variance = calculate_variance(&feature_values);
            if variance < 1e-9 {
                logs.push(format!("Excluded '{}' (zero variance)", name));
                continue;
            }
            let corr = calculate_correlation(&feature_values, &self.targets);
            if corr.abs() < correlation_threshold {
                logs.push(format!("Excluded '{}' (correlation: {:.3})", name, corr));
            } else {
                logs.push(format!("Selected '{}' (correlation: {:.3})", name, corr));
                selected_indices.push(i);
            }
        }

        (selected_indices, logs)
    }

    fn apply_selection(&self, indices: &[usize]) -> Dataset {
        let new_names = indices.iter().map(|&i| self.feature_names[i].clone()).collect();
        let new_inputs = self
            .inputs
            .iter()
            .map(|row| indices.iter().map(|&i| row[i]).collect())
            .collect();
        Dataset {
            feature_names: new_names,
            inputs: new_inputs,
            targets: self.targets.clone(),
        }
    }
}

// --- Solver Engine ---
#[derive(Clone, Copy, Debug, PartialEq)]
enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Max,
    Exp,
}

#[derive(Clone, Debug)]
enum Expr {
    Const(f64),
    Var(usize),
    Binary(Op, Box<Expr>, Box<Expr>),
    Unary(Op, Box<Expr>),
}

impl Expr {
    fn eval(&self, vars: &[f64]) -> f64 {
        match self {
            Expr::Const(c) => *c,
            Expr::Var(i) => *vars.get(*i).unwrap_or(&0.0),
            Expr::Binary(op, l, r) => {
                let lv = l.eval(vars);
                let rv = r.eval(vars);
                match op {
                    Op::Add => lv + rv,
                    Op::Sub => lv - rv,
                    Op::Mul => lv * rv,
                    Op::Div => {
                        if rv.abs() < 1e-4 {
                            0.0
                        } else {
                            lv / rv
                        }
                    }
                    Op::Max => lv.max(rv),
                    _ => 0.0,
                }
            }
            Expr::Unary(Op::Exp, c) => c.eval(vars).exp(),
            _ => 0.0,
        }
    }

    fn to_string(&self, vars: &[&str]) -> String {
        match self {
            Expr::Const(c) => format!("{:.1}", c),
            Expr::Var(i) => vars.get(*i).unwrap_or(&"?").to_string(),
            Expr::Binary(op, l, r) => {
                let s = match op {
                    Op::Add => "+",
                    Op::Sub => "-",
                    Op::Mul => "*",
                    Op::Div => "/",
                    Op::Max => "max",
                    _ => "?",
                };
                if matches!(op, Op::Max) {
                    format!("max({}, {})", l.to_string(vars), r.to_string(vars))
                } else {
                    format!("({} {} {})", l.to_string(vars), s, r.to_string(vars))
                }
            }
            Expr::Unary(Op::Exp, c) => format!("exp({})", c.to_string(vars)),
            _ => "err".to_string(),
        }
    }
}

fn random_expr(depth: i32, rng: &mut ThreadRng, num_vars: usize) -> Expr {
    if depth == 0 || rng.gen_bool(0.3) {
        if rng.gen_bool(0.5) {
            Expr::Const(rng.gen_range(1.0_f64..5.0_f64).round())
        } else {
            Expr::Var(rng.gen_range(0..num_vars))
        }
    } else {
        match rng.gen_range(0..5) {
            0 => Expr::Binary(
                Op::Add,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            1 => Expr::Binary(
                Op::Sub,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            2 => Expr::Binary(
                Op::Mul,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            3 => Expr::Binary(
                Op::Max,
                Box::new(random_expr(depth - 1, rng, num_vars)),
                Box::new(random_expr(depth - 1, rng, num_vars)),
            ),
            _ => random_expr(depth - 1, rng, num_vars),
        }
    }
}

fn mutate(expr: &Expr, rng: &mut ThreadRng, num_vars: usize) -> Expr {
    if rng.gen_bool(0.2) {
        return random_expr(2, rng, num_vars);
    }
    match expr {
        Expr::Binary(op, l, r) => Expr::Binary(*op, Box::new(mutate(l, rng, num_vars)), Box::new(mutate(r, rng, num_vars))),
        _ => expr.clone(),
    }
}

// --- TUI State ---
pub struct SolverState {
    pub generation: u64,
    pub best_error: f64,
    pub best_formula: String,
    pub logs: Vec<String>,
    pub progress: f64,
    pub input_buffer: String,
    pub command_suggestions: Vec<String>,
    pub log_scroll_offset: usize,
    pub best_solution_scroll_offset: usize,
    pub focused_panel: FocusedPanel,
    pub phase: Phase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusedPanel {
    BestSolution,
    Logs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Preprocessing,
    Solving,
    Finished,
}

enum AppEvent {
    Update(u64, f64, String),
    Log(String),
    PhaseChange(Phase),
    Finished,
}

// --- Main ---
fn main() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let (tx, rx): (Sender<AppEvent>, Receiver<AppEvent>) = mpsc::channel();

    thread::spawn(move || {
        let mut rng = rand::thread_rng();
        
        tx.send(AppEvent::Log("formula_miner started.".into())).unwrap();
        tx.send(AppEvent::PhaseChange(Phase::Preprocessing)).unwrap();
        
        // === GENERATE MOCK DATA WITH NOISE ===
        let mut dataset = Dataset {
            feature_names: vec![
                "Atk".into(),
                "Def".into(),
                "Luck".into(),
                "MapID".into(),
                "Timestamp".into(),
            ],
            inputs: Vec::new(),
            targets: Vec::new(),
        };

        for i in 0..50 {
            let atk = rng.gen_range(100.0..200.0);
            let def = rng.gen_range(10.0..90.0);
            let luck = rng.gen_range(0.0..100.0); // random noise
            let map_id = 5.0; // constant (zero variance)
            let timestamp = i as f64; // monotonic
            let val = ((atk - def) * 2.0_f64).max(1.0_f64);
            dataset.inputs.push(vec![atk, def, luck, map_id, timestamp]);
            dataset.targets.push(val);
        }

        tx.send(AppEvent::Log("Data generation complete (50 samples, 5 features)".into())).unwrap();
        thread::sleep(Duration::from_millis(500));

        // === PREPROCESSING: FEATURE SELECTION ===
        tx.send(AppEvent::Log("Starting feature selection...".into())).unwrap();
        let (selected_indices, filter_logs) = dataset.filter_features(0.1);
        for log in filter_logs {
            tx.send(AppEvent::Log(log)).unwrap();
            thread::sleep(Duration::from_millis(200));
        }

        let filtered_dataset = dataset.apply_selection(&selected_indices);
        tx.send(AppEvent::Log(format!(
            "Feature selection complete: {} -> {} features",
            dataset.feature_names.len(),
            filtered_dataset.feature_names.len()
        )).into()).unwrap();
        thread::sleep(Duration::from_millis(500));

        // === SOLVING PHASE ===
        tx.send(AppEvent::PhaseChange(Phase::Solving)).unwrap();
        tx.send(AppEvent::Log("Starting formula search...".into())).unwrap();

        let data: Vec<(Vec<f64>, f64)> = filtered_dataset
            .inputs
            .iter()
            .zip(filtered_dataset.targets.iter())
            .map(|(inp, &targ)| (inp.clone(), targ))
            .collect();

        let var_names: Vec<&str> = filtered_dataset.feature_names.iter().map(|s| s.as_str()).collect();
        let num_vars = var_names.len();

        let mut best = random_expr(3, &mut rng, num_vars);
        let mut best_err = f64::MAX;
        let max_gen = 100000;

        for gen in 0..=max_gen {
            let candidate = mutate(&best, &mut rng, num_vars);
            let mut err = 0.0;
            for (vars, target) in &data {
                err += (candidate.eval(vars) - target).powi(2);
            }

            if err < best_err {
                best_err = err;
                best = candidate;
                tx.send(AppEvent::Update(gen, best_err, best.to_string(&var_names)))
                    .unwrap();
            }

            if gen % 500 == 0 {
                tx.send(AppEvent::Update(gen, best_err, best.to_string(&var_names)))
                    .unwrap();
                thread::sleep(Duration::from_micros(100));
            }

            if best_err < 0.001 {
                tx.send(AppEvent::Log("Exact formula found!".into())).unwrap();
                break;
            }
        }
        tx.send(AppEvent::Finished).unwrap();
    });

    let mut state = SolverState {
        generation: 0,
        best_error: f64::MAX,
        best_formula: "Initializing...".into(),
        logs: vec![],
        progress: 0.0,
        input_buffer: String::new(),
        command_suggestions: vec![],
        log_scroll_offset: 0,
        best_solution_scroll_offset: 0,
        focused_panel: FocusedPanel::Logs,
        phase: Phase::Preprocessing,
    };

    loop {
        terminal.draw(|f| ui(f, &state))?;

        if event::poll(Duration::from_millis(16))? {
            match event::read()? {
                Event::Key(key) => {
                    if mina::handle_key_event(key, &mut state) {
                        break;
                    }
                }
                Event::Mouse(mouse) => {
                    mina::handle_mouse_event(mouse, &mut state);
                }
                _ => {}
            }
        }

        while let Ok(msg) = rx.try_recv() {
            match msg {
                AppEvent::Update(g, e, f) => {
                    state.generation = g;
                    state.best_error = e;
                    state.best_formula = f;
                    state.progress = (g as f64 / 100000.0).min(1.0);
                }
                AppEvent::Log(s) => {
                    state.logs.push(s);
                    if state.logs.len() > 10 {
                        state.logs.remove(0);
                    }
                }
                AppEvent::PhaseChange(p) => {
                    state.phase = p;
                }
                AppEvent::Finished => {
                    state.logs.push("Done.".into());
                    state.progress = 1.0;
                    state.phase = Phase::Finished;
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    Ok(())
}

fn ui(f: &mut Frame, state: &SolverState) {
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

    let title_text = format!(
        "{} v{} - Phase: {:?}",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        state.phase
    );
    let title = Paragraph::new(title_text)
        .block(Block::default().borders(Borders::ALL));
    f.render_widget(title, chunks[0]);

    let gauge = Gauge::default()
        .block(Block::default().borders(Borders::ALL).title("Progress"))
        .gauge_style(Style::default().fg(Color::Green))
        .ratio(state.progress);
    f.render_widget(gauge, chunks[1]);

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
        format!("Best Solution [focused] [{}/{}]", state.best_solution_scroll_offset + 1, info_lines.len())
    } else {
        format!("Best Solution [{}/{}]", state.best_solution_scroll_offset + 1, info_lines.len())
    };
    let best_border_style = if state.focused_panel == FocusedPanel::BestSolution {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };
    let info = Paragraph::new(info_display)
        .block(Block::default().borders(Borders::ALL).title(best_title).border_style(best_border_style))
        .wrap(Wrap { trim: true });
    f.render_widget(info, chunks[2]);

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
    let log_list = List::new(logs).block(Block::default().borders(Borders::ALL).title(scroll_info).border_style(log_border_style));
    f.render_widget(log_list, chunks[3]);

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
    let cmd_input = Paragraph::new(cmd_text)
        .block(Block::default().borders(Borders::ALL).title("Input"));
    f.render_widget(cmd_input, chunks[4]);
}
