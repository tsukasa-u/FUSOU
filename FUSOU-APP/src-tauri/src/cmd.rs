use tauri::api::process::Command;

#[cfg(TAURI_BUILD_DEBUG)]
use proxy_https::pac_server::PATH_PROXY_CRATE;

#[cfg(target_os = "windows")]
use proxy_https::pac_server::PATH_ADD_PROXY_BAT;

#[cfg(target_os = "windows")]
use proxy_https::pac_server::PATH_DELETE_PROXY_BAT;

#[cfg(target_os = "windows")]
use proxy_https::pac_server::PATH_ADD_STORE_BAT;

#[cfg(target_os = "linux")]
use proxy_https::pac_server::PATH_ADD_PROXY_SH;

#[cfg(target_os = "linux")]
use proxy_https::pac_server::PATH_DELETE_PROXY_SH;

#[cfg(target_os = "linux")]
use proxy_https::pac_server::PATH_ADD_STORE_SH;

use crate::RESOURCES_DIR;
    
#[cfg(target_os = "windows")]
pub fn add_pac(path: &str) {
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_ADD_PROXY_BAT);
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_ADD_PROXY_BAT).as_path().to_str().expect("cmd_path not found").to_string();
    
    let _output = Command::new(cmd_path)
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "windows")]
pub fn remove_pac() {
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_DELETE_PROXY_BAT);
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_DELETE_PROXY_BAT).as_path().to_str().expect("cmd_path not found").to_string();
    
    let _output = Command::new(cmd_path)
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}

#[cfg(target_os = "windows")]
pub fn add_store() {
    use crate::ROAMING_DIR;

    #[cfg(TAURI_BUILD_DEBUG)]
    let ca_path = "./ca/ca_cert.pem".to_string();
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let ca_path = ROAMING_DIR.get().expect("ROAMING_DIR not found").join("ca/ca_cert.pem").as_path().to_str().expect("ca_path not found").to_string();
    
    #[cfg(TAURI_BUILD_DEBUG)]
    let cmd_path = format!("{}/{}", PATH_PROXY_CRATE, PATH_ADD_STORE_BAT);
    #[cfg(not(TAURI_BUILD_DEBUG))]
    let cmd_path = RESOURCES_DIR.get().expect("RESOURCES_DIR not found").join(PATH_ADD_STORE_BAT).as_path().to_str().expect("cmd_path not found").to_string();
    
    let _output = Command::new(cmd_path)
        .args([ca_path])
        .output()
        .expect("failed to execute process");
}

#[cfg(target_os = "linux")]
#[cfg(TAURI_BUILD_DEBUG)] 
pub fn add_pac(path: &str) {
    let _output = Command::new(PATH_ADD_PROXY_SH)
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "linux")]
#[cfg(TAURI_BUILD_DEBUG)] 
pub fn remove_pac() {
    Command::new(PATH_DELETE_PROXY_SH)
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}