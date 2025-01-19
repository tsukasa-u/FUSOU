use tauri::api::process::Command;
use proxy_https::pac_server::PATH_ADD_PROXY_BAT;
use proxy_https::pac_server::PATH_DELETE_PROXY_BAT;
use proxy_https::pac_server::PATH_ADD_STORE_BAT;
use proxy_https::pac_server::PATH_ADD_PROXY_SH;
use proxy_https::pac_server::PATH_DELETE_PROXY_SH;
use proxy_https::pac_server::PATH_ADD_STORE_SH;
    
#[cfg(target_os = "windows")]
pub fn add_pac(path: &str) {
    let _output = Command::new(PATH_ADD_PROXY_BAT)
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "windows")]
pub fn remove_pac() {
    Command::new(PATH_DELETE_PROXY_BAT)
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}

#[cfg(target_os = "windows")]
pub fn add_store() {
    Command::new(PATH_ADD_STORE_BAT)
        .args(["./ca/ca_cert.pem"])
        .output()
        .expect("failed to execute process");
}

#[cfg(target_os = "linux")]
pub fn add_pac(path: &str) {
    let _output = Command::new(PATH_ADD_PROXY_SH)
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "linux")]
pub fn remove_pac() {
    Command::new(PATH_DELETE_PROXY_SH)
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}