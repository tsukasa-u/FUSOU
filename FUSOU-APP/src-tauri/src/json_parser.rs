use std::error::Error;
// use proxy::bidirectional_channel;
use proxy_https::bidirectional_channel;
use register_trait::TraitForConvert;

use register_trait::expand_struct_selector;

// use crate::kcapi;
use crate::interface::interface::{Add, EmitData, Set};

pub fn emit_data<R: tauri::Runtime>(handle: &impl tauri::Manager<R>, emit_data: EmitData) {
    match emit_data {
        EmitData::Add(data) => {
            match data {
                Add::Materials(data) => {
                    // println!("Materials: {:?}", data.clone());
                    let _ = handle.emit_to("main", "add-kcs-materials", data);
                }
                Add::Ships(data) => {
                    // println!("Ships: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-ships", data);
                }
                Add::Battle(data) => {
                    // println!("Battle: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-battle", data);
                }
                Add::Cell(data) => {
                    // println!("Cell: {:?}", data);
                    let _ = handle.emit_to("main", "add-kcs-cell", data);
                }
                Add::Dammy(_) => {
                    // println!("Dammy");
                    let _ = handle.emit_to("main", "add-kcs-dammy", ());
                }
            }
        }
        EmitData::Set(data) => {
            match data {
                Set::DeckPorts(data) => {
                    // println!("DeckPorts: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-deck-ports", data);
                }
                Set::Materials(data) => {
                    // println!("Materials: {:?}", data.clone());
                    let _ = handle.emit_to("main", "set-kcs-materials", data);
                }
                Set::Ships(data) => {
                    // println!("Ships: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-ships", data);
                }
                Set::SlotItems(data) => {
                    // println!("SlotItems: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-slot-items", data);
                }
                Set::NDocks(data) => {
                    // println!("NDocks: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-n-docks", data);
                }
                Set::Logs(data) => {
                    // println!("Logs: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-logs", data);
                }
                Set::AirBases(data) => {
                    // println!("AirBases: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-air-bases", data);
                }
                Set::MstShips(data) => {
                    // println!("MstShips: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-ships", data);
                }
                Set::MstSlotItems(data) => {
                    // println!("MstSlotItems: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-slot-items", data);
                }
                Set::MstEquipExslotShips(data) => {
                    // println!("MstEquipExslotShips: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-equip-exslot-ships", data);
                }
                Set::MstEquipShips(data) => {
                    // println!("MstEquipShips: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-equip-ships", data);
                }
                Set::MstStypes(data) => {
                    // println!("MstStypes: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-stypes", data);
                }
                Set::MstUseItems(data) => {
                    // println!("MstUseItems: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-use-items", data);
                }
                Set::MstSlotItemEquipTypes(data) => {
                    // println!("MstSlotItemEquipTypes: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-mst-slot-item-equip-types", data);
                }
                Set::Battles(data) => {
                    // println!("Battle: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-battles", data);
                }
                Set::Cells(data) => {
                    // println!("Cells: {:?}", data);
                    let _ = handle.emit_to("main", "set-kcs-cells", data);
                }
                Set::Dammy(_) => {
                    // println!("Dammy");
                    let _ = handle.emit_to("main", "set-kcs-dammy", ());
                }
            }
        }
    }
}

// Should I rewrite this attribute marcro to macro_rules!?
#[expand_struct_selector(path = "./src/kcapi/")]
pub fn struct_selector_response(
    name: String,
    data: String,
) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let data_removed_bom: String = data.replace("\u{feff}", "");
    let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
    let root_wrap: Result<kcsapi_lib::Res, serde_json::Error> =
        serde_json::from_str(&data_removed_svdata);
    match root_wrap {
        Ok(root) => match root.convert() {
            Some(emit_data_list) => {
                return Ok(emit_data_list);
            }
            None => {
                return Ok(Vec::new());
            }
        },
        Err(e) => {
            println!(
                "\x1b[38;5;{}m Failed to parse JSON({:?}): {}\x1b[m ",
                8, name, e
            );
            return Err(Box::new(e));
        }
    };
}

#[expand_struct_selector(path = "./src/kcapi/")]
pub fn struct_selector_resquest(
    name: String,
    data: String,
) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let data_removed_bom: String = data.replace("\u{feff}", "");
    let root_wrap: Result<kcsapi_lib::Req, serde_qs::Error> = serde_qs::from_str(&data_removed_bom);
    match root_wrap {
        Ok(root) => match root.convert() {
            Some(emit_data_list) => {
                return Ok(emit_data_list);
            }
            None => {
                return Ok(Vec::new());
            }
        },
        Err(e) => {
            println!(
                "\x1b[38;5;{}m Failed to parse JSON({:?}): {}\x1b[m ",
                8, name, e
            );
            return Err(Box::new(e));
        }
    };
}

async fn response_parser<R: tauri::Runtime>(
    handle: &impl tauri::Manager<R>,
    mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    mut proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) {
    loop {
        tokio::select! {
            recv_log = proxy_log_slave.recv() => {
                match recv_log {
                    None => {
                        println!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::RESPONSE { path, content_type: _, content }) => {
                        let handle_clone = handle.app_handle();
                        tokio::task::spawn(async move {
                            if let Ok(emit_data_list) = struct_selector_response(path, content) {
                                for emit_data_element in emit_data_list {
                                    emit_data(&handle_clone, emit_data_element);
                                }
                            };
                        });
                    },
                    Some(bidirectional_channel::StatusInfo::REQUEST { path, content_type: _, content }) => {
                        let handle_clone = handle.app_handle();
                        tokio::task::spawn(async move {
                            if let Ok(emit_data_list) = struct_selector_resquest(path, content) {
                                for emit_data_element in emit_data_list {
                                    emit_data(&handle_clone, emit_data_element);
                                }
                            };
                        });
                    },
                    _ => {}
                }
            },
            recv_msg = slave.recv() => {
                match recv_msg {
                    None => {
                        println!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                        println!("Received shutdown message: {} {}", status, message);
                        let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                            status: "SHUTTING DOWN".to_string(),
                            message: "Response parser is shutting down".to_string(),
                        }).await;
                        break;
                    },
                    Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                        println!("Received health message: {} {}", status, message);
                        let _ = slave.send(bidirectional_channel::StatusInfo::HEALTH {
                            status: "RUNNING".to_string(),
                            message: "Response parser is running".to_string(),
                        }).await;
                    },
                    _ => {}
                }
            },
            _ = tokio::signal::ctrl_c() => {
                break;
            },
        }
    }
    println!("Shutting Response parser");
}

pub fn serve_reponse_parser<R: tauri::Runtime>(
    handle: &impl tauri::Manager<R>,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) {
    let handle_clone = handle.app_handle();
    tokio::task::spawn(async move { response_parser(&handle_clone, slave, proxy_log_slave).await });
}
