// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// #![recursion_limit = "256"]

use tauri::{Manager, AppHandle, CustomMenuItem, SystemTray, SystemTrayEvent, SystemTrayMenu};
use tokio::sync::mpsc;
use webbrowser::{open_browser, Browser};
use arboard::Clipboard;
use core::time;
use std::fs;
use std::sync::{Arc, Mutex};
use std::process::ExitCode;

mod kcapi;
mod notification;
mod cmd_pac_tauri;
mod json_parser;
mod interface;

mod discord;
mod tauri_cmd;

use proxy::bidirectional_channel::{BidirectionalChannel, StatusInfo};

#[derive(Debug, Default )]
pub struct BrowserState(Browser);

impl BrowserState {
    pub fn new() -> Self {
        BrowserState(Browser::default())
    }

    pub fn set_browser(&mut self, browser: &Browser) {
      browser.clone_into(&mut self.0);
      // self.0 = browser.clone();
    }

    pub fn get_browser(&self) -> Browser {
        self.0.clone()
    }
}

fn create_external_window(app: &tauri::App) {

  let init_script = fs::read_to_string("./../src/init_script.js").expect("Unable to read init_script.js");

  let external = tauri::WindowBuilder::new(
    app,
    "external",
    tauri::WindowUrl::External("http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/".parse().unwrap()),
  )
  .fullscreen(false)
  .title("fusou-viewer")
  .inner_size(1192_f64, 712_f64)
  .visible(false)
  .initialization_script(&init_script)
  .build()
  .expect("error while building external");
  external.open_devtools();
  // external.hwnd().unwrap().0

}

#[tokio::main]
async fn main() -> ExitCode {

  let proxy_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
  let proxy_bidirectional_channel_slave = proxy_bidirectional_channel.clone_slave();
  let proxy_bidirectional_channel_master = proxy_bidirectional_channel.clone_master();
  let proxy_target = "http://125.6.189.247";

  let pac_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
  let pac_bidirectional_channel_slave = pac_bidirectional_channel.clone_slave();
  let pac_bidirectional_channel_master = pac_bidirectional_channel.clone_master();
  let pac_path = "./../../FUSOU-PROXY/proxy_rust/proxy/proxy.pac".to_string();

  let proxy_log_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
  let proxy_log_bidirectional_channel_slave = proxy_log_bidirectional_channel.clone_slave();
  let proxy_log_bidirectional_channel_master = proxy_log_bidirectional_channel.clone_master();

  let response_parse_channel = BidirectionalChannel::<StatusInfo>::new(1);
  let response_parse_channel_slave = response_parse_channel.clone_slave();
  let response_parse_channel_master = response_parse_channel.clone_master();

  let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

  let shared_browser = Arc::new(Mutex::new(BrowserState::new()));

  let proxy_serve_shutdown: CustomMenuItem = CustomMenuItem::new("proxy-serve-shutdown".to_string(), "Shutdown Proxy Server".to_string());
  let gprc_serve_shutdown: CustomMenuItem = CustomMenuItem::new("gprc-serve-shutdown".to_string(), "Shutdown gRPC Server".to_string()).disabled();
  let pac_server_shutdown: CustomMenuItem = CustomMenuItem::new("pac-serve-shutdown".to_string(), "Shutdown PAC Server".to_string());
  let delete_registry: CustomMenuItem = CustomMenuItem::new("delete-registry".to_string(), "Delete Registry".to_string());

  // let restart_proxy: CustomMenuItem = CustomMenuItem::new("restart-proxy".to_string(), "Restart Proxy Server".to_string());

  let quit: CustomMenuItem = CustomMenuItem::new("quit".to_string(), "Quit".to_string()).accelerator("CmdOrCtrl+Q".to_string());
  let pause: CustomMenuItem = CustomMenuItem::new("pause".to_string(), "Pause".to_string()).selected();
  let title: CustomMenuItem = CustomMenuItem::new("title".to_string(), "FUSOU".to_string()).disabled();
  let open_close: CustomMenuItem = CustomMenuItem::new("open/close".to_string(), "Open Window".to_string());
  let visit_website: CustomMenuItem = CustomMenuItem::new("visit-website".to_string(), "Visit Website".to_string());

  let browser_sub_menu : SystemTrayMenu = SystemTrayMenu::new()
    .add_item(CustomMenuItem::new("select-default".to_string(), "Default".to_string()).selected())
    .add_item(CustomMenuItem::new("select-firefox".to_string(), "Firefox".to_string()).disabled())
    .add_item(CustomMenuItem::new("select-chrome".to_string(), "Chrome".to_string()).disabled())
    .add_item(CustomMenuItem::new("select-opera".to_string(), "Opera".to_string()).disabled())
    .add_native_item(tauri::SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("copy-url".to_string(), "Copy URL".to_string()));

  let danger_ope_sub_menu: SystemTrayMenu = SystemTrayMenu::new()
    .add_item(CustomMenuItem::new("danger-title".to_string(), "Danger Zone".to_string()).disabled())  
    .add_native_item(tauri::SystemTrayMenuItem::Separator)
    .add_item(proxy_serve_shutdown)
    .add_item(gprc_serve_shutdown)
    .add_item(pac_server_shutdown)
    .add_item(delete_registry);

  let advanced_sub_menu: SystemTrayMenu = SystemTrayMenu::new()
    .add_item(CustomMenuItem::new("advanced-title".to_string(), "Advanced".to_string()).disabled())
    .add_native_item(tauri::SystemTrayMenuItem::Separator)
    .add_submenu(tauri::SystemTraySubmenu::new("Select browser".to_string(), browser_sub_menu))
    .add_submenu(tauri::SystemTraySubmenu::new("Danger Zone".to_string(), danger_ope_sub_menu));

  let tray_menu = SystemTrayMenu::new()
    .add_item(title)
    .add_native_item(tauri::SystemTrayMenuItem::Separator)
    .add_item(visit_website)
    .add_item(open_close)
    .add_native_item(tauri::SystemTrayMenuItem::Separator)
    .add_submenu(tauri::SystemTraySubmenu::new("Advanced".to_string(), advanced_sub_menu))
    .add_native_item(tauri::SystemTrayMenuItem::Separator)
    .add_item(pause)
    .add_item(quit);

  let system_tray = SystemTray::new().with_menu(tray_menu).with_tooltip("FUSOU");

  let external_window_size_before = Mutex::new(tauri::PhysicalSize::<u32> {
    width: 1200,
    height: 720
  });
  
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      // tauri_cmd::close_splashscreen, 
      // tauri_cmd::show_splashscreen, 
      tauri_cmd::get_mst_ships,
      tauri_cmd::get_mst_slot_items,
      tauri_cmd::get_slot_items
    ])
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(move |app| {
      
      create_external_window(&app);
      // let _window = app.get_window("main").unwrap().close().unwrap();

      // start proxy server
      let save_path = "./../../FUSOU-PROXY-DATA".to_string();
      let proxy_addr = proxy::proxy_server::serve_proxy(proxy_target.to_string(), 0, proxy_bidirectional_channel_slave, proxy_log_bidirectional_channel_master, save_path);

      if proxy_addr.is_err() {
        return Err("Failed to start proxy server".into());
      }

      // start pac server
      let pac_addr = proxy::pac_server::serve_pac_file(pac_path.clone(), 0, pac_bidirectional_channel_slave);
      
      if pac_addr.is_err() {
        return Err("Failed to start pac server".into());
      }

      proxy::edit_pac::edit_pac(&pac_path, proxy_addr.unwrap().to_string().as_str());
      
      cmd_pac_tauri::add_pac(&format!("http://localhost:{}/proxy.pac", pac_addr.unwrap().port()));

      json_parser::serve_reponse_parser(&app.handle(), response_parse_channel_slave, proxy_log_bidirectional_channel_slave);

      discord::connect();
      // discord::set_activity("experimental implementation", "playing KanColle with FUSOU");
      discord::set_activity_button("experimental implementation", "playing KanColle with FUSOU", "Visit GitHub Repository", "https://github.com/tsukasa-u/FUSOU");

      let proxy_bidirectional_channel_master_clone = proxy_bidirectional_channel_master.clone();
      let pac_bidirectional_channel_master_clone = pac_bidirectional_channel_master.clone();
      let response_parse_channel_master_clone = response_parse_channel_master.clone();
      let app_handle = app.handle();
      tauri::async_runtime::spawn(async move {
        let _ = shutdown_rx.recv().await;
        // is it needed to add select! for timeout?
        let _ = tokio::join!(
          proxy::bidirectional_channel::request_shutdown(proxy_bidirectional_channel_master_clone),
          proxy::bidirectional_channel::request_shutdown(pac_bidirectional_channel_master_clone),
          proxy::bidirectional_channel::request_shutdown(response_parse_channel_master_clone),
        );

        tokio::time::sleep(time::Duration::from_millis(2000)).await;
        app_handle.exit(0_i32);
      });
      return Ok(())
    })
    .system_tray(system_tray)
    // .on_page_load(|window, _ | {
    //   let _ = window.app_handle().tray_handle().get_item("open").set_title("close");
    // })
    .on_window_event(move |event| match event.event() {
      tauri::WindowEvent::CloseRequested { .. } => {
          let _ = event.window().app_handle().tray_handle().get_item("open/close").set_title("Open Window");
      },
      tauri::WindowEvent::Resized(size) => {

        if event.window().label().eq("external") {
          if let Ok(is_maximized) = event.window().is_maximized() {
            if is_maximized {
              external_window_size_before.lock().unwrap().height = size.height;
              external_window_size_before.lock().unwrap().width = size.width;
              return;
            }
          }
          if let Ok(is_minimized) = event.window().is_minimized() {
            if is_minimized {
              return;
            }
          }
          
          if size.width != external_window_size_before.lock().unwrap().width {
            external_window_size_before.lock().unwrap().width = size.width;
            external_window_size_before.lock().unwrap().height = size.width*712/1192;
          } else {
            external_window_size_before.lock().unwrap().width = size.height*1192/712;
            external_window_size_before.lock().unwrap().height = size.height;
          }

          let _ = event.window().set_size(external_window_size_before.lock().unwrap().clone());
        }
      },
      _ => {}
    })
    .on_system_tray_event(move |app: &AppHandle, event: SystemTrayEvent| match event {
      SystemTrayEvent::LeftClick {
        position: _,
        size: _,
        ..
      } => {
    
        // notification::wrap_notification(app, notification::NotificationContent::default());
        
        let window = app.get_window("main");
        match window {
          Some(window) => {
            match window.is_visible() {
              Ok(false) => {
                let _ = window.show().unwrap();
                let _ = app.tray_handle().get_item("open/close").set_title("Close Window");
              }
              _ => {}
            }
          },
          None => {
            let _window = tauri::WindowBuilder::new(app, "main", tauri::WindowUrl::App("index.html".into()))
              .build()
              .unwrap();
            let _ = app.tray_handle().get_item("open/close").set_title("Close Window");
          }
        }

        println!("system tray received a left click");
      },
      SystemTrayEvent::RightClick {
        position: _,
        size: _,
        ..
      } => {
        println!("system tray received a right click");
      },
      SystemTrayEvent::DoubleClick {
        position: _,
        size: _,
        ..
      } => {
        println!("system tray received a double click");
      },
      SystemTrayEvent::MenuItemClick { id, .. } => {
        match id.as_str() {
          "gprc-serve-shutdown" => {
            let _ = app.tray_handle().get_item("pause").set_title("Pause");
            let _ = app.tray_handle().get_item("pause").set_enabled(false);
            // gprc_server::gprc_stop_with_thread(wg.clone(), tx_master_gprc.clone());
            // let _ = app.tray_handle().get_item("gprc-serve-shutdown").set_title("Shutdown gRPC Server");
            // let _ = app.tray_handle().get_item("proxy-serve-shutdown").set_title("Shutdown Proxy Server");
          },
          "proxy-serve-shutdown" => {
            let _ = app.tray_handle().get_item("pause").set_title("Pause");
            let _ = app.tray_handle().get_item("pause").set_enabled(false);
            // let _ = app.tray_handle().get_item("gprc-serve-shutdown").set_title("Shutdown gRPC Server");
            // let _ = app.tray_handle().get_item("proxy-serve-shutdown").set_title("Shutdown Proxy Server");
          },
          "quit" => {

            // let pac_bidirectional_channel_master_clone = pac_bidirectional_channel_master.clone();
            // let proxy_bidirectional_channel_master_clone = proxy_bidirectional_channel_master.clone();
            if let Some(window) = app.get_window("main"){
            
              if let Ok(visible) = window.is_visible() {
                if !visible {
                  let _ = app.get_window("main").expect("no window labeled 'main' found").hide().unwrap();
                }
              }
            }
            let _ = app.tray_handle().get_item("open/close").set_enabled(false);
            let _ = app.tray_handle().get_item("quit").set_enabled(false);
            let _ = app.tray_handle().get_item("pause").set_enabled(false);
            let _ = app.tray_handle().get_item("advanced-title").set_enabled(false);
            cmd_pac_tauri::remove_pac();
            
            discord::close();

            let shutdown_tx_clone = shutdown_tx.clone();
            tauri::async_runtime::spawn(async move {
                let _ = shutdown_tx_clone.send(()).await;
              }
            );
          },
          "copy-url" => {
            let mut clipboard = Clipboard::new().unwrap();
            clipboard.set_text("https://github.com/tsukasa-u").unwrap();
          }
          "visit-website" => {
            let browser = shared_browser.lock().unwrap();
            let _ = open_browser(browser.get_browser(), "https://github.com/tsukasa-u").is_ok();
          },
          "open/close" => {
            let window = app.get_window("main");
            match window {
              Some(window) => {
                match window.is_visible() {
                  Ok(true) => {
                    let _ = window.hide().unwrap();
                    let _ = app.tray_handle().get_item("open/close").set_title("Open Window");
                  },
                  Ok(false) => {
                    let _ = window.show().unwrap();
                    let _ = app.tray_handle().get_item("open/close").set_title("Close Window");
                  }
                  _ => {}
                }
              },
              None => {
                let _window = tauri::WindowBuilder::new(app, "main", tauri::WindowUrl::App("index.html".into()))
                  .build()
                  .unwrap();
                let _ = app.tray_handle().get_item("open/close").set_title("Close Window");
              }
            }
          }
          _ => {
            let submenu: Vec<&str> = id.as_str().split("-").collect();
            match submenu.get(0) {
              Some(&"sm1") => {
                vec!["default", "firefox", "chrome", "opera"].iter().for_each(|&item| {
                  // return true if the selecte menu tile match the current item in the vec!["default", "firefox", "chrome", "opera"]
                  let _ = app.tray_handle().get_item(&format!("select-{}", item)).set_selected(submenu.get(1).unwrap().eq(&item));
                });

                let mut browser = shared_browser.lock().unwrap();
                browser.set_browser(&(match submenu.get(1) {
                  Some(&"default") => Browser::default().to_owned(),
                  Some(&"firefox") => Browser::Firefox.to_owned(),
                  Some(&"chrome") => Browser::Chrome.to_owned(),
                  Some(&"opera") => Browser::Opera.to_owned(),
                  _ => Browser::default().to_owned()
                }));
              }
              _ => {}
            }
          }
        }
      }
      _ => {}
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |_app_handle, event| {
      match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
          api.prevent_exit();
        },
        tauri::RunEvent::Exit => {
          println!("exit");
        },
        _ => {}
      }
    });

    // wg.wait().await;

    return ExitCode::SUCCESS;
}