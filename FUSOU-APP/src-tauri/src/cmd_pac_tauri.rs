use tauri::api::process::Command;
    
#[cfg(target_os = "windows")]
pub fn add_pac(path: &str) {
    let _output = Command::new("./../../FUSOU-PROXY/proxy_rust/proxy/cmd/add_proxy.bat")
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "windows")]
pub fn remove_pac() {
    Command::new("./../../FUSOU-PROXY/proxy_rust/proxy/cmd/delete_proxy.bat")
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}

#[cfg(target_os = "linux")]
pub fn add_pac(path: &str) {
    let _output = Command::new("./../../FUSOU-PROXY/proxy_rust/proxy/cmd/add_proxy.sh")
        .args([path, ])
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "linux")]
pub fn remove_pac() {
    Command::new("./../../FUSOU-PROXY/proxy_rust/proxy/cmd/delete_proxy.sh")
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}