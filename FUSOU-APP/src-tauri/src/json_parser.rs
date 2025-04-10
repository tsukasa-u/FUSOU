use std::error::Error;
use tauri::Emitter;
// use proxy::bidirectional_channel;
use proxy_https::bidirectional_channel;
use register_trait::TraitForConvert;

use register_trait::expand_struct_selector;

// use crate::kcapi;
use crate::interface::interface::{Add, EmitData, Identifier, Set};

pub fn emit_data(handle: &tauri::AppHandle, emit_data: EmitData) {
    match emit_data {
        EmitData::Add(data) => match data {
            Add::Materials(data) => {
                let _ = handle.emit_to("main", "add-kcs-materials", data);
            }
            Add::Ships(data) => {
                data.add_or();
                let _ = handle.emit_to("main", "add-kcs-ships", data);
            }
            Add::Battle(data) => {
                data.add_or();
                let _ = handle.emit_to("main", "add-kcs-battle", data);
            }
            Add::Cell(data) => {
                data.add_or();
                let _ = handle.emit_to("main", "add-kcs-cell", data);
            }
            Add::Dammy(_) => {
                let _ = handle.emit_to("main", "add-kcs-dammy", ());
            }
        },
        EmitData::Set(data) => match data {
            Set::DeckPorts(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-deck-ports", data);
            }
            Set::Materials(data) => {
                let _ = handle.emit_to("main", "set-kcs-materials", data);
            }
            Set::Ships(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-ships", data);
            }
            Set::SlotItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-slot-items", data);
            }
            Set::NDocks(data) => {
                let _ = handle.emit_to("main", "set-kcs-n-docks", data);
            }
            Set::Logs(data) => {
                let _ = handle.emit_to("main", "set-kcs-logs", data);
            }
            Set::AirBases(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-air-bases", data);
            }
            Set::MstShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-ships", data);
            }
            Set::MstSlotItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-slot-items", data);
            }
            Set::MstEquipExslotShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-equip-exslot-ships", data);
            }
            Set::MstEquipShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-equip-ships", data);
            }
            Set::MstStypes(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-stypes", data);
            }
            Set::MstUseItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-use-items", data);
            }
            Set::MstSlotItemEquipTypes(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-mst-slot-item-equip-types", data);
            }
            Set::Cells(data) => {
                data.restore();
                let _ = handle.emit_to("main", "set-kcs-cells", data);
            }
            Set::Dammy(_) => {
                let _ = handle.emit_to("main", "set-kcs-dammy", ());
            }
        },
        EmitData::Identifier(data) => match data {
            Identifier::Port(_) => {}
            Identifier::RequireInfo(_) => {}
            Identifier::GetData(_) => {}
        },
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

// Should I rewrite this attribute marcro to macro_rules!?
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

async fn response_parser(
    handle: &tauri::AppHandle,
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
                        let handle_clone = handle.clone();
                        tokio::task::spawn(async move {
                            if let Ok(emit_data_list) = struct_selector_response(path, content) {
                                for emit_data_element in emit_data_list {
                                    emit_data(&handle_clone, emit_data_element);
                                }
                            };
                        });
                    },
                    Some(bidirectional_channel::StatusInfo::REQUEST { path, content_type: _, content }) => {
                        let handle_clone = handle.clone();
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

pub fn serve_reponse_parser(
    handle: &tauri::AppHandle,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) {
    let handle_clone = handle.clone();
    tokio::task::spawn(async move { response_parser(&handle_clone, slave, proxy_log_slave).await });
}
