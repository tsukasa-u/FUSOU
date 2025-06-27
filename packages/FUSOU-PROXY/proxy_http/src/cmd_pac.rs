use std::process::Command;
    
#[cfg(target_os = "windows")]
pub fn add_pac(path: &str) {
    let _output = Command::new("./add_proxy.bat")
        .arg(path)
        .output()
        .expect("failed to execute process");
    println!("register AutoConfigURL: {}", path);
}
    
#[cfg(target_os = "windows")]
pub fn remove_pac() {
    Command::new("./delete_proxy.bat")
        .output()
        .expect("failed to execute process");
    println!("unregister AutoConfigURL");
}