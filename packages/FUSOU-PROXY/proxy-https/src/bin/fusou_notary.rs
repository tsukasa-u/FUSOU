#[cfg(unix)]
use proxy_https::operational_notary::{run, Command};
use std::process::ExitCode;

#[cfg(unix)]
#[tokio::main]
async fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let command = match args.next().as_deref().and_then(std::ffi::OsStr::to_str) {
        Some("init") => Some(Command::Init),
        Some("export-public") => Some(Command::ExportPublic),
        Some("serve") => Some(Command::Serve),
        _ => None,
    };
    let (Some(command), Some(config), None) = (command, args.next(), args.next()) else {
        eprintln!("Usage: fusou-notary <init|export-public|serve> CONFIG.json");
        return ExitCode::from(2);
    };
    match run(command, std::path::Path::new(&config)).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Notary stopped: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(not(unix))]
fn main() -> ExitCode {
    eprintln!("fusou-notary requires a Unix host");
    ExitCode::FAILURE
}
