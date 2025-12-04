use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use rand::prelude::*;
use ratatui::{backend::CrosstermBackend, Terminal};
use std::{
    io,
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::Duration,
};

mod dataset;
mod mina;
mod solver;
mod state;
mod statistics;
mod ui;

use dataset::Dataset;
use solver::{mutate, random_expr};
use state::{AppEvent, Phase, SolverState};

fn main() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let (tx, rx): (Sender<AppEvent>, Receiver<AppEvent>) = mpsc::channel();

    // Spawn solver thread
    thread::spawn(move || run_solver(tx));

    let mut state = SolverState::new();

    loop {
        terminal.draw(|f| ui::render_ui(f, &state))?;

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
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    Ok(())
}

fn run_solver(tx: Sender<AppEvent>) {
    let mut rng = rand::thread_rng();

    tx.send(AppEvent::Log("formula_miner started.".into()))
        .unwrap();
    tx.send(AppEvent::PhaseChange(Phase::Preprocessing))
        .unwrap();

    // === GENERATE MOCK DATA WITH NOISE ===
    let mut dataset = Dataset::new(vec![
        "Atk".into(),
        "Def".into(),
        "Luck".into(),
        "MapID".into(),
        "Timestamp".into(),
    ]);

    for i in 0..50 {
        let atk = rng.gen_range(100.0..200.0);
        let def = rng.gen_range(10.0..90.0);
        let luck = rng.gen_range(0.0..100.0);
        let map_id = 5.0;
        let timestamp = i as f64;
        let val = ((atk - def) * 2.0_f64).max(1.0_f64);
        dataset.add_sample(vec![atk, def, luck, map_id, timestamp], val);
    }

    tx.send(AppEvent::Log(
        "Data generation complete (50 samples, 5 features)".into(),
    ))
    .unwrap();
    thread::sleep(Duration::from_millis(500));

    // === PREPROCESSING: FEATURE SELECTION ===
    tx.send(AppEvent::Log("Starting feature selection...".into()))
        .unwrap();
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
    )))
    .unwrap();
    thread::sleep(Duration::from_millis(500));

    // === SOLVING PHASE ===
    tx.send(AppEvent::PhaseChange(Phase::Solving)).unwrap();
    tx.send(AppEvent::Log("Starting formula search...".into()))
        .unwrap();

    let data = filtered_dataset.to_pairs();
    let var_names = filtered_dataset.feature_names_as_str();
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
            tx.send(AppEvent::Log("Exact formula found!".into()))
                .unwrap();
            break;
        }
    }
    tx.send(AppEvent::Finished).unwrap();
}
