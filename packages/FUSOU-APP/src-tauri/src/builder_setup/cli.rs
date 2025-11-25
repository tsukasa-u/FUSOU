use clap::{ArgAction, Parser, Subcommand};
use serde::Serialize;
use std::io::{self, Write};
use tauri::{Error as TauriError, Manager};

#[derive(Debug, Clone, Default)]
pub struct CliInvocation {
    pub show_version: bool,
    pub enable_terminal_logs: bool,
    pub app_info: Option<AppInfoRequest>,
}

#[derive(Debug, Clone, Copy)]
pub struct AppInfoRequest {
    pub as_json: bool,
}

#[derive(Parser, Debug)]
#[command(
    name = "fusou",
    about = "FUSOU desktop client helper commands",
    disable_version_flag = true
)]
struct CliArgs {
    #[arg(
        short = 'V',
        long = "version",
        action = ArgAction::SetTrue,
        help = "Show the application version and exit"
    )]
    version: bool,
    #[arg(
        short = 'l',
        long = "logs",
        action = ArgAction::SetTrue,
        help = "Attach to the invoking terminal and stream logs to stdout"
    )]
    logs: bool,
    #[command(subcommand)]
    command: Option<CliCommand>,
}

#[derive(Subcommand, Debug)]
enum CliCommand {
    /// Print detailed application metadata
    Info {
        #[arg(
            long = "json",
            action = ArgAction::SetTrue,
            help = "Emit the metadata as JSON"
        )]
        json: bool,
    },
}

pub fn parse_invocation() -> CliInvocation {
    let cli = CliArgs::parse();
    let app_info = match cli.command {
        Some(CliCommand::Info { json }) => Some(AppInfoRequest { as_json: json }),
        None => None,
    };

    CliInvocation {
        show_version: cli.version,
        enable_terminal_logs: cli.logs,
        app_info,
    }
}

pub fn prepare_terminal_logs(invocation: &CliInvocation) {
    if invocation.enable_terminal_logs
        || invocation.show_version
        || invocation.app_info.is_some()
    {
        attach_to_terminal();
    }
}

pub fn handle_metadata_commands(
    app: &tauri::App,
    invocation: &CliInvocation,
) -> Result<(), Box<dyn std::error::Error>> {
    if invocation.show_version {
        print_version(app)?;
        std::process::exit(0);
    }

    if let Some(request) = invocation.app_info {
        print_app_info(app, request.as_json)?;
        std::process::exit(0);
    }

    Ok(())
}

fn print_version(app: &tauri::App) -> io::Result<()> {
    let package_info = app.package_info();
    let version = package_info.version.to_string();
    let name = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| package_info.name.clone());
    let mut stdout = io::stdout();
    writeln!(stdout, "{name} {version}")?;
    stdout.flush()
}

fn print_app_info(app: &tauri::App, as_json: bool) -> io::Result<()> {
    let package_info = app.package_info();
    let config = app.config();
    let app_handle = app.handle();
    let path_resolver = app_handle.path();

    let product_name = config
        .product_name
        .clone()
        .unwrap_or_else(|| package_info.name.clone());
    let identifier = config.identifier.clone();
    let version = package_info.version.to_string();
    let resources_dir = path_result_to_string(path_resolver.resource_dir());
    let app_data_dir = path_result_to_string(path_resolver.app_data_dir());
    let config_dir = path_result_to_string(path_resolver.app_config_dir());
    let executable = std::env::current_exe()
        .ok()
        .map(|path| path.display().to_string());

    let payload = AppInfoPayload {
        product_name,
        identifier,
        version,
        resources_dir,
        app_data_dir,
        config_dir,
        executable,
    };

    if as_json {
        let mut stdout = io::stdout();
        serde_json::to_writer_pretty(&mut stdout, &payload)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
        return Ok(());
    }

    let mut stdout = io::stdout();
    writeln!(stdout, "Product Name : {}", payload.product_name)?;
    writeln!(stdout, "Identifier   : {}", payload.identifier)?;
    writeln!(stdout, "Version      : {}", payload.version)?;
    if let Some(path) = &payload.executable {
        writeln!(stdout, "Executable   : {path}")?;
    }
    if let Some(path) = &payload.resources_dir {
        writeln!(stdout, "Resources Dir: {path}")?;
    }
    if let Some(path) = &payload.app_data_dir {
        writeln!(stdout, "App Data Dir : {path}")?;
    }
    if let Some(path) = &payload.config_dir {
        writeln!(stdout, "Config Dir   : {path}")?;
    }
    stdout.flush()
}

fn path_result_to_string(path: Result<std::path::PathBuf, TauriError>) -> Option<String> {
    path.ok().map(|p| p.display().to_string())
}

#[derive(Serialize)]
struct AppInfoPayload {
    product_name: String,
    identifier: String,
    version: String,
    resources_dir: Option<String>,
    app_data_dir: Option<String>,
    config_dir: Option<String>,
    executable: Option<String>,
}

#[cfg(windows)]
fn attach_to_terminal() {
    use windows_sys::Win32::System::Console::{AllocConsole, AttachConsole, ATTACH_PARENT_PROCESS};

    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            AllocConsole();
        }
    }
}

#[cfg(not(windows))]
fn attach_to_terminal() {}