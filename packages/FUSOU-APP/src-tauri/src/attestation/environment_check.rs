use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentReport {
    pub environment_type: String,
    pub debugger_attached: bool,
    pub hooks_detected: Vec<String>,
}

#[cfg(target_os = "linux")]
fn detect_debugger() -> bool {
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if let Some(raw) = line.strip_prefix("TracerPid:") {
                return raw.trim() != "0";
            }
        }
    }
    false
}

#[cfg(not(target_os = "linux"))]
fn detect_debugger() -> bool {
    false
}

fn detect_hooks() -> Vec<String> {
    let mut hooks = Vec::new();

    if std::env::var("LD_PRELOAD").is_ok() {
        hooks.push("LD_PRELOAD".to_string());
    }
    if std::env::var("DYLD_INSERT_LIBRARIES").is_ok() {
        hooks.push("DYLD_INSERT_LIBRARIES".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(maps) = std::fs::read_to_string("/proc/self/maps") {
            if maps.to_lowercase().contains("frida") {
                hooks.push("frida".to_string());
            }
        }
    }

    hooks
}

fn detect_environment_type() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(vendor) = std::fs::read_to_string("/sys/class/dmi/id/sys_vendor") {
            let lower = vendor.to_lowercase();
            if lower.contains("vmware")
                || lower.contains("virtual")
                || lower.contains("qemu")
                || lower.contains("innotek")
            {
                return "VirtualMachine".to_string();
            }
        }

        if let Ok(cgroup) = std::fs::read_to_string("/proc/1/cgroup") {
            if cgroup.contains("docker") || cgroup.contains("lxc") {
                return "Container".to_string();
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if std::env::var("WT_SESSION").is_ok() {
            return "Native".to_string();
        }
    }

    "Native".to_string()
}

pub fn detect_environment() -> EnvironmentReport {
    EnvironmentReport {
        environment_type: detect_environment_type(),
        debugger_attached: detect_debugger(),
        hooks_detected: detect_hooks(),
    }
}
