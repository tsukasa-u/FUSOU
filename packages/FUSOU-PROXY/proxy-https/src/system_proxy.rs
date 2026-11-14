use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Output;

#[cfg(target_os = "windows")]
pub const PATH_ADD_PROXY_SCRIPT: &str = "windows/add_proxy.ps1";
#[cfg(target_os = "windows")]
pub const PATH_DELETE_PROXY_SCRIPT: &str = "windows/delete_proxy.ps1";
#[cfg(target_os = "windows")]
pub const PATH_ADD_STORE_SCRIPT: &str = "windows/add_store.ps1";
#[cfg(target_os = "windows")]
pub const PATH_CHECK_CA_SCRIPT: &str = "windows/check_ca.ps1";

#[cfg(target_os = "linux")]
pub const PATH_ADD_PROXY_SCRIPT: &str = "linux/add_proxy.sh";
#[cfg(target_os = "linux")]
pub const PATH_DELETE_PROXY_SCRIPT: &str = "linux/delete_proxy.sh";
#[cfg(target_os = "linux")]
pub const PATH_ADD_STORE_SCRIPT: &str = "linux/add_store.sh";
#[cfg(target_os = "linux")]
pub const PATH_CHECK_CA_SCRIPT: &str = "linux/check_ca.sh";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct ScriptError {
    pub message: String,
}

impl ScriptError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ScriptError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ScriptError {}

pub fn resolve_script_path(cmd_dir: &Path, relative_script_path: &str) -> Result<PathBuf, ScriptError> {
    let path = cmd_dir.join(relative_script_path);
    if !path.is_file() {
        return Err(ScriptError::new(format!(
            "system proxy script not found: {}",
            path.display()
        )));
    }
    Ok(path)
}

async fn run_script(
    cmd_dir: &Path,
    relative_script_path: &str,
    args: &[&str],
) -> Result<Output, ScriptError> {
    let script_path = resolve_script_path(cmd_dir, relative_script_path)?;

    #[cfg(target_os = "windows")]
    let output = {
        let script_str = script_path.to_str().ok_or_else(|| {
            ScriptError::new(format!(
                "script path is not valid UTF-8: {}",
                script_path.display()
            ))
        })?;
        let mut command = tokio::process::Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                script_str,
            ])
            .args(args);
        command.creation_flags(CREATE_NO_WINDOW);
        command.output().await.map_err(|err| {
            ScriptError::new(format!(
                "failed to execute {}: {err}",
                script_path.display()
            ))
        })?
    };

    #[cfg(target_os = "linux")]
    let output = {
        let mut command = tokio::process::Command::new(&script_path);
        command.args(args);
        command.output().await.map_err(|err| {
            ScriptError::new(format!(
                "failed to execute {}: {err}",
                script_path.display()
            ))
        })?
    };

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let output: Output = {
        let _ = (&script_path, args);
        return Err(ScriptError::new(
            "system proxy scripts are only supported on Windows and Linux",
        ));
    };

    Ok(output)
}

fn log_output_and_check_success(operation: &str, output: &Output) -> Result<(), ScriptError> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    tracing::debug!("{operation} stdout: {stdout}");
    tracing::debug!("{operation} stderr: {stderr}");

    if output.status.success() {
        return Ok(());
    }

    tracing::warn!("{operation} failed with status: {:?}", output.status);
    if !stderr.trim().is_empty() {
        tracing::warn!("{operation} stderr: {stderr}");
    }
    if !stdout.trim().is_empty() {
        tracing::warn!("{operation} stdout: {stdout}");
    }

    Err(ScriptError::new(format!(
        "{operation} exited with status {:?}",
        output.status
    )))
}

pub async fn add_pac(cmd_dir: &Path, pac_url: &str) -> Result<(), ScriptError> {
    let output = run_script(cmd_dir, PATH_ADD_PROXY_SCRIPT, &[pac_url]).await?;
    log_output_and_check_success("add_pac", &output)?;
    tracing::info!("register AutoConfigURL: {pac_url}");
    Ok(())
}

pub async fn remove_pac(cmd_dir: &Path) -> Result<(), ScriptError> {
    let output = run_script(cmd_dir, PATH_DELETE_PROXY_SCRIPT, &[]).await?;
    log_output_and_check_success("remove_pac", &output)?;
    tracing::info!("unregister AutoConfigURL");
    Ok(())
}

pub async fn add_store(cmd_dir: &Path, cert_path: &Path) -> Result<(), ScriptError> {
    let cert_str = cert_path.to_str().ok_or_else(|| {
        ScriptError::new(format!(
            "certificate path is not valid UTF-8: {}",
            cert_path.display()
        ))
    })?;
    tracing::info!("add_store using certificate path: {cert_str}");
    let output = run_script(cmd_dir, PATH_ADD_STORE_SCRIPT, &[cert_str]).await?;
    log_output_and_check_success("add_store", &output)?;
    tracing::info!("add_store succeeded");
    Ok(())
}

pub async fn check_ca_installed(cmd_dir: &Path, cert_path: &Path) -> Result<bool, ScriptError> {
    let cert_str = cert_path.to_str().ok_or_else(|| {
        ScriptError::new(format!(
            "certificate path is not valid UTF-8: {}",
            cert_path.display()
        ))
    })?;
    tracing::info!("check_ca using local certificate path: {cert_str}");
    let output = run_script(cmd_dir, PATH_CHECK_CA_SCRIPT, &[cert_str]).await?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    tracing::debug!("check_ca stdout: {stdout}");
    if !stderr.trim().is_empty() {
        tracing::debug!("check_ca stderr: {stderr}");
    }

    if output.status.success() {
        tracing::info!("CA certificate is installed");
        Ok(true)
    } else {
        tracing::info!("CA certificate is not installed");
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crate_cmd_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("cmd")
    }

    #[test]
    fn bundled_system_proxy_scripts_exist() {
        let cmd_dir = crate_cmd_dir();
        let expected_scripts = [
            "windows/add_proxy.ps1",
            "windows/delete_proxy.ps1",
            "windows/add_store.ps1",
            "windows/check_ca.ps1",
            "linux/add_proxy.sh",
            "linux/delete_proxy.sh",
            "linux/add_store.sh",
            "linux/check_ca.sh",
        ];

        for script in expected_scripts {
            let full_path = cmd_dir.join(script);
            assert!(
                full_path.is_file(),
                "expected script to exist at {}",
                full_path.display()
            );
        }
    }

    #[tokio::test]
    async fn check_ca_installed_returns_false_for_missing_cert() {
        let cmd_dir = crate_cmd_dir();
        let missing_cert = std::env::temp_dir().join("fusou-nonexistent-ca-cert.der");
        let installed = check_ca_installed(&cmd_dir, &missing_cert)
            .await
            .expect("script execution should not fail to spawn");
        assert!(!installed);
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn check_ca_installed_returns_false_for_uninstalled_generated_cert() {
        let cmd_dir = crate_cmd_dir();
        let temp_dir = std::env::temp_dir().join(format!(
            "fusou-check-ca-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let ca_path_str = temp_dir.to_string_lossy().to_string();
        crate::proxy_server_https::create_ca(ca_path_str);

        let cert_file = temp_dir.join(crate::proxy_server_https::CA_CERT_NAME_DER);
        let installed = check_ca_installed(&cmd_dir, &cert_file)
            .await
            .expect("check_ca.ps1 should run cleanly");
        let _ = std::fs::remove_dir_all(&temp_dir);

        assert!(!installed);
    }
}
