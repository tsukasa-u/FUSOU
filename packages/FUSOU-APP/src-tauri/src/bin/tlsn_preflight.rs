use std::{env, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let config_path = match args.next().as_deref() {
        Some("--config") => match args.next() {
            Some(path) => PathBuf::from(path),
            None => {
                eprintln!("missing value for --config");
                return ExitCode::from(2);
            }
        },
        Some(_) | None => {
            eprintln!("usage: tlsn-preflight --config <path>");
            return ExitCode::from(2);
        }
    };

    if !config_path.is_file() {
        eprintln!("config file is missing");
        return ExitCode::from(2);
    }

    if let Err(error) = configs::set_user_config(&config_path.to_string_lossy()) {
        eprintln!("failed to load config file: {error}");
        return ExitCode::from(2);
    }

    let report = app_lib::tlsn_preflight::run_loaded_config_preflight(&config_path);
    print!("{}", report.text());
    if report.ready {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}