// use tauri::api::process::Command;
// use std::process::Command;
use tauri_plugin_shell::ShellExt;

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

use crate::util::get_RESOURCES_DIR;
use crate::util::get_ROAMING_DIR;

pub fn add_pac<R>(path: String, app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    #[cfg(target_os = "windows")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_PROXY_BAT)
        .as_path()
        .to_str()
        .expect("cmd_path not found")
        .to_string();

    #[cfg(target_os = "linux")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_PROXY_SH)
        .as_path()
        .to_str()
        .expect("cmd_path not found")
        .to_string();

    let app_handle = app.clone();
    let path_clone = path.clone();
    tauri::async_runtime::spawn(async move {
        let output = app_handle
            .shell()
            .command(cmd_path)
            .args([path])
            .output()
            .await
            .expect("failed to execute process");

        println!("{}", String::from_utf8(output.stdout).unwrap());
    });

    println!("register AutoConfigURL: {path_clone}");
}

pub fn remove_pac<R>(app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    #[cfg(target_os = "windows")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_DELETE_PROXY_BAT)
        .as_path()
        .to_str()
        .expect("cmd_path not found")
        .to_string();

    #[cfg(target_os = "linux")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_DELETE_PROXY_SH)
        .as_path()
        .to_str()
        .expect("cmd_path not found")
        .to_string();

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let output = app_handle
            .shell()
            .command(cmd_path)
            .output()
            .await
            .expect("failed to execute process");

        println!("{}", String::from_utf8(output.stdout).unwrap());
    });

    println!("unregister AutoConfigURL");
}

pub fn add_store<R>(app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    let ca_path = get_ROAMING_DIR()
        .join("ca/ca_cert.pem")
        .as_path()
        .to_str()
        .expect("ca_path not found")
        .to_string();

    #[cfg(target_os = "windows")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_STORE_BAT)
        .as_path()
        .to_str()
        .expect("cmd_path not found")
        .to_string();

    #[cfg(target_os = "linux")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_STORE_SH)
        .as_path()
        .to_str()
        .expect("cmd_path not found")
        .to_string();

    println!("{}", cmd_path.clone());
    println!("{}", ca_path.clone());
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let output = app_handle
            .shell()
            .command(cmd_path)
            .args([ca_path])
            .output()
            .await
            .expect("failed to execute process");

        println!("{}", String::from_utf8(output.stdout).unwrap());
    });
}
