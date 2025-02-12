use std::collections::HashMap;

use proxy_https::bidirectional_channel;
use tauri::AppHandle;
use tauri::Manager;

use crate::external::create_external_window;
use crate::interface::mst_ship::KCS_MST_SHIPS;
use crate::interface::mst_slot_item::KCS_MST_SLOT_ITEMS;
use crate::interface::slot_item::KCS_SLOT_ITEMS;
use crate::interface::mst_equip_exslot_ship::KCS_MST_EQUIP_EXSLOT_SHIP;
use crate::interface::mst_slot_item_equip_type::KCS_MST_EQUIPTYPES;
use crate::interface::mst_equip_ship::KCS_MST_EQUIP_SHIP;
use crate::interface::mst_stype::KCS_MST_STYPES;
use crate::interface::mst_use_item::KCS_MST_USEITEMS;

use crate::external::SHARED_BROWSER;
use crate::json_parser;
use crate::wrap_proxy;
use crate::wrap_proxy::PacChannel;
use crate::wrap_proxy::ProxyChannel;
use crate::wrap_proxy::ProxyLogChannel;
use crate::wrap_proxy::ResponseParseChannel;
use crate::RESOURCES_DIR;
use crate::ROAMING_DIR;

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
pub async fn get_mst_equip_exslot_ships(window: tauri::Window) {
    let data = KCS_MST_EQUIP_EXSLOT_SHIP.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-mst-equip-exslot-ships", (*data).clone());
}

#[tauri::command]
pub async fn get_mst_slotitem_equip_types(window: tauri::Window) {
    let data = KCS_MST_EQUIPTYPES.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-mst-slot-item-equip-types", (*data).clone());
}

#[tauri::command]
pub async fn get_mst_equip_ships(window: tauri::Window) {
    let data = KCS_MST_EQUIP_SHIP.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-mst-equip-ships", (*data).clone());
}

#[tauri::command]
pub async fn get_mst_stypes(window: tauri::Window) {
    let data = KCS_MST_STYPES.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-mst-stypes", (*data).clone());
}

#[tauri::command]
pub async fn get_mst_useitems(window: tauri::Window) {
    let data = KCS_MST_USEITEMS.lock().unwrap();
    let _ = window.app_handle().emit_to("main", "set-kcs-mst-use-items", (*data).clone());
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
pub async fn check_pac_server_health(window: tauri::Window, pac_channel: tauri::State<'_, PacChannel>) -> Result<String, String> {
  match bidirectional_channel::check_health(pac_channel.master.clone()).await {
    Ok(_) => {
      Ok("PAC server is running".to_string())
    },
    Err(e) => {
      Err(e.to_string())
    }
  }
}

#[tauri::command]
pub async fn check_proxy_server_health(window: tauri::Window, proxy_channel: tauri::State<'_, ProxyChannel>) -> Result<String, String> {
  match bidirectional_channel::check_health(proxy_channel.master.clone()).await {
    Ok(_) => {
      Ok("Proxy server is running".to_string())
    },
    Err(e) => {
      Err(e.to_string())
    }
  }
}

#[tauri::command]
pub async fn launch_with_options(window: tauri::Window, options: HashMap<String, i32>, pac_channel: tauri::State<'_, PacChannel>, proxy_channel: tauri::State<'_, ProxyChannel>, proxy_log_channel: tauri::State<'_, ProxyLogChannel>, response_parse_channel: tauri::State<'_, ResponseParseChannel>) -> Result<(), ()> {
  println!("{:?}", options);

  if let Some(&flag) = options.get("run_proxy_server") {
    if flag!=0 {
      if let Some(&server_index) = options.get("server") {
        let server_address = match server_index {
          -1 => Some(""),
           1 => Some("w01y.kancolle-server.com"), // 横須賀鎮守府
           2 => Some("w02k.kancolle-server.com"), // 新呉鎮守府
           3 => Some("w03s.kancolle-server.com"), // 佐世保鎮守府
           4 => Some("w04m.kancolle-server.com"), // 舞鶴鎮守府
           5 => Some("w05o.kancolle-server.com"), // 大湊警備府
           6 => Some("w06k.kancolle-server.com"), // トラック泊地
           7 => Some("w07l.kancolle-server.com"), // リンガ泊地
           8 => Some("w08r.kancolle-server.com"), // ラバウル基地
           9 => Some("w09s.kancolle-server.com"), // ショートランド泊地
          10 => Some("w10b.kancolle-server.com"), // ブイン基地
          11 => Some("w11t.kancolle-server.com"), // タウイタウイ泊地
          12 => Some("w12p.kancolle-server.com"), // パラオ泊地
          13 => Some("w13b.kancolle-server.com"), // ブルネイ泊地
          14 => Some("w14h.kancolle-server.com"), // 単冠湾泊地
          15 => Some("w15p.kancolle-server.com"), // 幌筵泊地
          16 => Some("w16s.kancolle-server.com"), // 宿毛湾泊地
          17 => Some("w17k.kancolle-server.com"), // 鹿屋基地
          18 => Some("w18i.kancolle-server.com"), // 岩川基地
          19 => Some("w19s.kancolle-server.com"), // 佐伯湾泊地
          20 => Some("w20h.kancolle-server.com"), // 柱島泊地
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
          #[cfg(TAURI_BUILD_DEBUG)]
          let pac_path = "./../../FUSOU-PROXY/proxy_rust/proxy-https/proxy.pac".to_string();
          #[cfg(not(TAURI_BUILD_DEBUG))]
          let pac_path = ROAMING_DIR.get().expect("ROAMING_DIR not found").join("./resources/pac/proxy.pac").as_path().to_str().expect("failed to convert str").to_string();
          // let pac_path = window.app_handle().path_resolver().resolve_resource("./resources/pac/proxy.pac").expect("failed to resolve resources/pac/proxy dir").as_path().to_str().expect("failed to convert str").to_string();

          #[cfg(TAURI_BUILD_DEBUG)]
          let save_path = "./../../FUSOU-PROXY-DATA".to_string();
          #[cfg(not(TAURI_BUILD_DEBUG))]
          let save_path = directories::UserDirs::new().expect("failed to get user dirs").document_dir().expect("failed to get doc dirs").join("FUSOU-PROXY-DATA").as_path().to_str().expect("failed to convert str").to_string();

          #[cfg(TAURI_BUILD_DEBUG)]
          let ca_path = "./ca/".to_string();
          #[cfg(not(TAURI_BUILD_DEBUG))]
          let ca_path = ROAMING_DIR.get().expect("ROAMING_DIR not found").join("./resources/ca").as_path().to_str().expect("failed to convert str").to_string();
          // let ca_path =  window.app_handle().path_resolver().resolve_resource("./resources/ca").expect("failed to resolve app_local_data_dir").as_path().to_str().expect("failed to convert str").to_string();

          println!("save address: {}", save_path);
          println!("ca path: {}", ca_path);
          println!("pac path: {}", pac_path);

          let _proxy_result = wrap_proxy::serve_proxy(server_address.to_string(), save_path, pac_path, ca_path, proxy_channel.slave.clone(), proxy_log_channel.master.clone(), pac_channel.slave.clone()).unwrap();
        }
      }
    }
  }
  if let Some(&flag) = options.get("open_app") {
    if flag!=0 {
      json_parser::serve_reponse_parser(&window.app_handle(), response_parse_channel.slave.clone(), proxy_log_channel.slave.clone());
      window.get_window("main").expect("no window labeled 'main' found").show().unwrap();
      let _ = window.app_handle().tray_handle().get_item("main-open/close").set_title("Close Main Window");
    } else {
      window.get_window("main").expect("no window labeled 'main' found").close().unwrap();
      let _ = window.app_handle().tray_handle().get_item("main-open/close").set_title("Open Main Window");
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

//--------------------------------------------------------------

pub fn set_launch_page(app: &AppHandle) {
    let _ = app.emit_to::<()>("main", "set-main-page-launch", ());
}
