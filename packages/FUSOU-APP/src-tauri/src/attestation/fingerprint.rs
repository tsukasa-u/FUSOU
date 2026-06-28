use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize)]
pub struct SoftwareFingerprint {
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub total_memory_mb: u64,
    pub os_name: String,
    pub os_version: String,
    pub hostname_hash: String,
    pub machine_id_hash: String,
}

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(target_os = "linux")]
fn machine_id_raw() -> String {
    std::fs::read_to_string("/etc/machine-id")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            std::env::var("HOSTNAME")
                .unwrap_or_else(|_| "unknown-linux-machine".to_string())
        })
}

#[cfg(target_os = "windows")]
fn machine_id_raw() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-windows-machine".to_string())
}

#[cfg(target_os = "macos")]
fn machine_id_raw() -> String {
    std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown-macos-machine".to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn machine_id_raw() -> String {
    "unknown-machine".to_string()
}

pub fn collect_fingerprint() -> SoftwareFingerprint {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|cpu| cpu.brand().to_string())
        .unwrap_or_default();

    let cpu_cores = sys.cpus().len();
    let total_memory_mb = sys.total_memory() / 1024 / 1024;

    let os_name = sysinfo::System::name().unwrap_or_default();
    let os_version = sysinfo::System::os_version().unwrap_or_default();
    let hostname = sysinfo::System::host_name().unwrap_or_default();

    let machine_id = machine_id_raw();

    SoftwareFingerprint {
        cpu_brand,
        cpu_cores,
        total_memory_mb,
        os_name,
        os_version,
        hostname_hash: sha256_hex(&hostname),
        machine_id_hash: sha256_hex(&machine_id),
    }
}
