use tauri::Manager;

use crate::interface::mst_ship::KCS_MST_SHIPS;
use crate::interface::interface::{EmitData, Set};

#[tauri::command]
pub async fn get_mst_ships() -> EmitData {
    let mst_ships = KCS_MST_SHIPS.lock().unwrap();
    EmitData::Set(Set::MstShips((*mst_ships).clone()))
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