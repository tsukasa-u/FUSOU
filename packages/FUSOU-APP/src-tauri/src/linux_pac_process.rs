use std::time::Duration;

use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const PAC_PROCESS_TIMEOUT: Duration = Duration::from_secs(30);
const PAC_STOP_TIMEOUT: Duration = Duration::from_secs(5);
const PAC_GROUP_EXIT_TIMEOUT: Duration = Duration::from_secs(5);
const PAC_EVENT_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Debug)]
pub(crate) struct PacScriptError {
    pub(crate) diagnostic_code: &'static str,
    pub(crate) script_diagnostics: Vec<String>,
    pub(crate) result_unknown: bool,
}

impl PacScriptError {
    pub(crate) fn new(diagnostic_code: &'static str, script_diagnostics: Vec<String>) -> Self {
        Self {
            diagnostic_code,
            script_diagnostics,
            result_unknown: false,
        }
    }

    fn result_unknown(script_diagnostics: Vec<String>) -> Self {
        Self {
            diagnostic_code: "pac_process_result_unknown",
            script_diagnostics,
            result_unknown: true,
        }
    }

    fn outcome_unknown(diagnostic_code: &'static str, script_diagnostics: Vec<String>) -> Self {
        Self {
            diagnostic_code,
            script_diagnostics,
            result_unknown: true,
        }
    }
}

fn pac_script_diagnostic(line: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(line);
    let code = text
        .split_whitespace()
        .find_map(|part| part.strip_prefix("code="))?;
    if code.is_empty()
        || code.len() > 64
        || !code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return None;
    }
    Some(code.to_string())
}

pub(crate) async fn run_linux_pac_script<R>(
    app: &AppHandle<R>,
    command_path: String,
    args: Vec<String>,
) -> Result<(), PacScriptError>
where
    R: Runtime,
{
    run_linux_pac_script_with_timeout(app, command_path, args, PAC_PROCESS_TIMEOUT).await
}

pub(crate) async fn run_linux_pac_script_with_timeout<R>(
    app: &AppHandle<R>,
    command_path: String,
    args: Vec<String>,
    timeout: Duration,
) -> Result<(), PacScriptError>
where
    R: Runtime,
{
    let command = app
        .shell()
        .command(command_path)
        .args(args)
        .set_process_group(true);
    let (events, child) = command
        .spawn()
        .map_err(|_| PacScriptError::new("pac_process_start_failed", Vec::new()))?;
    wait_for_pac_child(events, child, timeout).await
}

pub(crate) async fn wait_for_pac_child(
    mut events: tauri::async_runtime::Receiver<CommandEvent>,
    child: CommandChild,
    timeout: Duration,
) -> Result<(), PacScriptError> {
    let process_group = match libc::pid_t::try_from(child.pid()) {
        Ok(process_group) => process_group,
        Err(_) => {
            let kill = tokio::task::spawn_blocking(move || child.kill());
            let _ = tokio::time::timeout(PAC_STOP_TIMEOUT, kill).await;
            return Err(PacScriptError::result_unknown(Vec::new()));
        }
    };
    let mut diagnostics = Vec::new();
    let process_result = tokio::time::timeout(timeout, async {
        loop {
            match events.recv().await {
                Some(CommandEvent::Stderr(line)) => {
                    if let Some(code) = pac_script_diagnostic(&line) {
                        diagnostics.push(code);
                    }
                }
                Some(CommandEvent::Terminated(payload)) => {
                    return Ok((payload.code, payload.signal));
                }
                Some(CommandEvent::Error(_)) => {
                    return Err("pac_process_output_failed");
                }
                Some(CommandEvent::Stdout(_)) => {}
                None => return Err("pac_process_terminated_without_status"),
                _ => {}
            }
        }
    })
    .await;

    let process_result = match process_result {
        Ok(Ok(status)) => {
            let group_is_gone = match process_group_is_gone(process_group) {
                Ok(is_gone) => is_gone,
                Err(_) => false,
            };
            if !group_is_gone {
                stop_pac_process_group(process_group, child, &mut events, &mut diagnostics, false)
                    .await?;
            }
            if status == (Some(0), None) {
                return Ok(());
            }
            return Err(PacScriptError::new("pac_script_failed", diagnostics));
        }
        Ok(Err(diagnostic_code)) => diagnostic_code,
        Err(_) => "pac_process_timeout",
    };

    stop_pac_process_group(process_group, child, &mut events, &mut diagnostics, true).await?;
    Err(PacScriptError::outcome_unknown(process_result, diagnostics))
}

async fn stop_pac_process_group(
    process_group: libc::pid_t,
    child: CommandChild,
    events: &mut tauri::async_runtime::Receiver<CommandEvent>,
    diagnostics: &mut Vec<String>,
    require_termination_event: bool,
) -> Result<(), PacScriptError> {
    let kill = tokio::task::spawn_blocking(move || child.kill());
    let kill_result = tokio::time::timeout(PAC_STOP_TIMEOUT, kill).await;
    match kill_result {
        Ok(Ok(Ok(()))) => {}
        _ => return Err(PacScriptError::result_unknown(diagnostics.clone())),
    }

    if require_termination_event {
        let termination_result = tokio::time::timeout(PAC_STOP_TIMEOUT, async {
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stderr(line) => {
                        if let Some(code) = pac_script_diagnostic(&line) {
                            diagnostics.push(code);
                        }
                    }
                    CommandEvent::Terminated(_) => return true,
                    CommandEvent::Error(_) | CommandEvent::Stdout(_) => {}
                    _ => {}
                }
            }
            false
        })
        .await;
        if !matches!(termination_result, Ok(true)) {
            return Err(PacScriptError::result_unknown(diagnostics.clone()));
        }
    }

    let group_exit_result = tokio::time::timeout(PAC_GROUP_EXIT_TIMEOUT, async {
        loop {
            match process_group_is_gone(process_group) {
                Ok(true) => return true,
                Ok(false) => tokio::time::sleep(PAC_EVENT_POLL_INTERVAL).await,
                Err(_) => return false,
            }
        }
    })
    .await;
    if !matches!(group_exit_result, Ok(true)) {
        return Err(PacScriptError::result_unknown(diagnostics.clone()));
    }
    Ok(())
}

fn process_group_is_gone(process_group: libc::pid_t) -> std::io::Result<bool> {
    if unsafe { libc::killpg(process_group, 0) } == 0 {
        return Ok(false);
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(true)
    } else {
        Err(error)
    }
}
