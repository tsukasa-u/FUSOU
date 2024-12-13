use std::collections::HashMap;

use tauri::Manager;

use crate::external::create_external_window;
use crate::interface::mst_ship::KCS_MST_SHIPS;
use crate::interface::mst_slot_item::KCS_MST_SLOT_ITEMS;
use crate::interface::slot_item::KCS_SLOT_ITEMS;

use crate::external::SHARED_BROWSER;
use crate::json_parser;
use crate::wrap_proxy;
use crate::wrap_proxy::PacChannel;
use crate::wrap_proxy::ProxyChannel;
use crate::wrap_proxy::ProxyLogChannel;
use crate::wrap_proxy::ResponseParseChannel;

#[tauri::command]
pub async fn get_mst_ships(window: tauri::Window) {
    let data = KCS_MST_SHIPS.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-mst-ships", (*data).clone());
}

#[tauri::command]
pub async fn get_mst_slot_items(window: tauri::Window) {
    let data = KCS_MST_SLOT_ITEMS.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-mst-slot-items", (*data).clone());
}

#[tauri::command]
pub async fn get_slot_items(window: tauri::Window) {
    let data = KCS_SLOT_ITEMS.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-slot-items", (*data).clone());
}

#[tauri::command]
pub async fn show_splashscreen(window: tauri::Window) {
  // Show splashscreen
  window.get_window("splashscreen").expect("no window labeled 'splashscreen' found").show().unwrap();
}

#[tauri::command]
pub async fn close_splashscreen(window: tauri::Window) {
  // Close splashscreen
  window.get_window("splashscreen").expect("no window labeled 'splashscreen' found").close().unwrap();
  // Show main window
  window.get_window("main").expect("no window labeled 'main' found").show().unwrap();
  window.get_window("external").expect("no window labeled 'external' found").show().unwrap();
}

#[tauri::command]
pub async fn launch_with_options(window: tauri::Window, options: HashMap<String, i32>, pac_channel: tauri::State<'_, PacChannel>, proxy_channel: tauri::State<'_, ProxyChannel>, proxy_log_channel: tauri::State<'_, ProxyLogChannel>, response_parse_channel: tauri::State<'_, ResponseParseChannel>) -> Result<(), ()>{
  println!("{:?}", options);

  if let Some(&flag) = options.get("run_proxy_server") {
    if flag!=0 {
      if let Some(&server_index) = options.get("server") {
        let server_address = match server_index {
           1 => Some("http://w01y.kancolle-server.com"), // 横須賀鎮守府
           2 => Some("http://w02k.kancolle-server.com"), // 新呉鎮守府
           3 => Some("http://w03s.kancolle-server.com"), // 佐世保鎮守府
           4 => Some("http://w04m.kancolle-server.com"), // 舞鶴鎮守府
           5 => Some("http://w05o.kancolle-server.com"), // 大湊警備府
           6 => Some("http://w06k.kancolle-server.com"), // トラック泊地
           7 => Some("http://w07l.kancolle-server.com"), // リンガ泊地
           8 => Some("http://w08r.kancolle-server.com"), // ラバウル基地
           9 => Some("http://w09s.kancolle-server.com"), // ショートランド泊地
          10 => Some("http://w10b.kancolle-server.com"), // ブイン基地
          11 => Some("http://w11t.kancolle-server.com"), // タウイタウイ泊地
          12 => Some("http://w12p.kancolle-server.com"), // パラオ泊地
          13 => Some("http://w13b.kancolle-server.com"), // ブルネイ泊地
          14 => Some("http://w14h.kancolle-server.com"), // 単冠湾泊地
          15 => Some("http://w15p.kancolle-server.com"), // 幌筵泊地
          16 => Some("http://w16s.kancolle-server.com"), // 宿毛湾泊地
          17 => Some("http://w17k.kancolle-server.com"), // 鹿屋基地
          18 => Some("http://w18i.kancolle-server.com"), // 岩川基地
          19 => Some("http://w19s.kancolle-server.com"), // 佐伯湾泊地
          20 => Some("http://w20h.kancolle-server.com"), // 柱島泊地
          // 0 => Some("http://203.104.209.71"),  // 横須賀鎮守府
          // 1 => Some("http://203.104.209.87"),  // 新呉鎮守府
          // 2 => Some("http://125.6.184.215"),   // 佐世保鎮守府
          // 3 => Some("http://203.104.209.183"), //  舞鶴鎮守府	
          // 4 => Some("http://203.104.209.150"), //  大湊警備府
          // 5 => Some("http://203.104.209.134"), //  トラック泊地
          // 6 => Some("http://203.104.209.167"), //  リンガ泊地
          // 7 => Some("http://203.104.209.199"), //  ラバウル基地
          // 8 => Some("http://125.6.189.7"),     // ショートランド泊地
          // 0 => Some("http://125.6.189.39"),   // ブイン基地
          // 10 => Some("http://125.6.189.71"),   // タウイタウイ泊地
          // 11 => Some("http://125.6.189.103"),  // パラオ泊地
          // 12 => Some("http://125.6.189.135"),  // ブルネイ泊地
          // 13 => Some("http://125.6.189.167"),  // 単冠湾泊地
          // 14 => Some("http://125.6.189.247"),  // 宿毛湾泊地
          // 15 => Some("http://125.6.189.215"),  // 幌筵泊地
          // 16 => Some("http://203.104.209.23"), //  鹿屋基地
          // 17 => Some("http://203.104.209.39"), //  岩川基地
          // 18 => Some("http://203.104.209.55"), //  佐伯湾泊地
          // 19 => Some("http://203.104.209.102"),// 柱島泊地
          _ => None,
        };
        if let Some(server_address) = server_address {
          let pac_path = "./../../FUSOU-PROXY/proxy_rust/proxy/proxy.pac".to_string();
          let _proxy_result = wrap_proxy::serve_proxy(server_address.to_string(), pac_path, proxy_channel.slave.clone(), proxy_log_channel.master.clone(), pac_channel.slave.clone()).unwrap();
        }
      }
    }
  }
  if let Some(&flag) = options.get("open_app") {
    if flag!=0 {
      json_parser::serve_reponse_parser(&window.app_handle(), response_parse_channel.slave.clone(), proxy_log_channel.slave.clone());
      window.get_window("main").expect("no window labeled 'main' found").show().unwrap();
    } else {
      window.get_window("main").expect("no window labeled 'main' found").close().unwrap();
    }
  }
  if let Some(&flag) = options.get("open_kancolle") {
    if flag!=0 {
      if let Some(&browse_webview) = options.get("open_kancolle_with_webview") {
        if browse_webview!=0 {
          create_external_window(&window.app_handle(), None, true);
        } else {
          let browser = SHARED_BROWSER.lock().unwrap().get_browser();
          create_external_window(&window.app_handle(), Some(browser), false);
        }
      }
    }
  }

  return Ok(());
}