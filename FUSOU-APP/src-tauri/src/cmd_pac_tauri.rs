use tauri::api::process::Command;
    
#[cfg(target_os = "windows")]
pub fn add_pac(path: &str) {
    let _output = Command::new("./../../FUSOU-PROXY/proxy_rust/proxy/add_proxy.bat")
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "windows")]
pub fn remove_pac() {
    Command::new("./../../FUSOU-PROXY/proxy_rust/proxy/delete_proxy.bat")
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}