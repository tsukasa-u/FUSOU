use tauri::api::process::Command;

#[cfg(TAURI_BUILD_DEBUG)]
use proxy_https::pac_server::PATH_PROXY_CRATE;

use proxy_https::pac_server::PATH_ADD_PROXY_BAT;
use proxy_https::pac_server::PATH_DELETE_PROXY_BAT;
use proxy_https::pac_server::PATH_ADD_STORE_BAT;
use proxy_https::pac_server::PATH_ADD_PROXY_SH;
use proxy_https::pac_server::PATH_DELETE_PROXY_SH;
use proxy_https::pac_server::PATH_ADD_STORE_SH;

use crate::RESOURCES_DIR;
use crate::ROAMING_DIR;
    
pub fn add_pac(path: &str) {
    #[cfg(target_os = "windows")]
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_ADD_PROXY_BAT);
    #[cfg(target_os = "linux")]
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_ADD_PROXY_SH);

    #[cfg(target_os = "windows")]
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_ADD_PROXY_BAT).as_path().to_str().expect("cmd_path not found").to_string();
    #[cfg(target_os = "linux")]
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_ADD_PROXY_SH).as_path().to_str().expect("cmd_path not found").to_string();
    
    let _output = Command::new(cmd_path)
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
pub fn remove_pac() {
    #[cfg(target_os = "windows")]
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_DELETE_PROXY_BAT);
    #[cfg(target_os = "linux")]
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_DELETE_PROXY_SH);

    #[cfg(target_os = "windows")]
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_DELETE_PROXY_BAT).as_path().to_str().expect("cmd_path not found").to_string();
    #[cfg(target_os = "linux")]
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_DELETE_PROXY_SH).as_path().to_str().expect("cmd_path not found").to_string();
    
    let _output = Command::new(cmd_path)
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}

pub fn add_store() {

    #[cfg(TAURI_BUILD_DEBUG)]
    let ca_path = "./ca/ca_cert.pem".to_string();
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let ca_path = ROAMING_DIR.get().expect("ROAMING_DIR not found").join("ca/ca_cert.pem").as_path().to_str().expect("ca_path not found").to_string();
    
    #[cfg(target_os = "windows")]
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_ADD_STORE_BAT);
    #[cfg(target_os = "linux")]
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_ADD_STORE_SH);

    #[cfg(target_os = "windows")]
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_ADD_STORE_BAT).as_path().to_str().expect("cmd_path not found").to_string();
    #[cfg(target_os = "linux")]
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_ADD_STORE_SH).as_path().to_str().expect("cmd_path not found").to_string();
    
    let _output = Command::new(cmd_path)
        .args([ca_path])
        .output()
        .expect("failed to execute process");
}