use tauri::Manager;

use crate::interface::mst_ship::KCS_MST_SHIPS;
use crate::interface::mst_slot_item::KCS_MST_SLOT_ITEMS;
use crate::interface::slot_item::KCS_SLOT_ITEMS;

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