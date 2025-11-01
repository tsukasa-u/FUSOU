use proxy_https::bidirectional_channel;
use std::error::Error;
use tauri::Emitter;

#[cfg(dev)]
use regex::Regex;

use crate::cloud_storage::submit_data;

use kc_api::interface::air_base::AirBases;
use kc_api::interface::deck_port::DeckPorts;
use kc_api::interface::interface::{Add, EmitData, Identifier, Set};
use kc_api::parser::{request_parser, response_parser};

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
                let _ = handle.emit_to("main", "set-kcs-air-bases-ports", data);
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
            Set::MstMapAreas(data) => {
                data.restore();
            }
            Set::MstMapInfos(data) => {
                data.restore();
            }
            Set::MstShipGraphs(data) => {
                data.restore();
            }
            Set::MstShipUpgrades(data) => {
                data.restore();
            }
            Set::MstEquipExslots(data) => {
                data.restore();
            }
            Set::MstEquipLimitExslots(data) => {
                data.restore();
            }
            Set::Dammy(_) => {
                let _ = handle.emit_to("main", "set-kcs-dammy", ());
            }
        },
        EmitData::Identifier(data) => match data {
            Identifier::Port(_) => {
                submit_data::submit_port_table();
            }
            Identifier::RequireInfo(_) => {}
            Identifier::GetData(_) => {
                submit_data::submit_get_data_table();
            }
            Identifier::MapStart(_) => {
                let _ = handle.emit_to("main", "set-kcs-air-bases-battles", AirBases::load());
                let _ = handle.emit_to("main", "set-kcs-deck-battles", DeckPorts::load());
            }
        },
    }
}

pub fn struct_selector_response(
    name: String,
    data: String,
) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let data_removed_bom: String = data.replace("\u{feff}", "");
    let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");

    #[cfg(dev)]
    let re_metadata = Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();

    #[cfg(dev)]
    let data_removed_metadata: String = re_metadata.replace(&data_removed_svdata, "").to_string();

    #[cfg(dev)]
    return kc_api::parser::response_parser(name, data_removed_metadata);

    #[cfg(any(not(dev), check_release))]
    return kc_api::parser::response_parser(name, data_removed_svdata);
}

pub fn struct_selector_resquest(
    name: String,
    data: String,
) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let data_removed_bom: String = data.replace("\u{feff}", "");

    #[cfg(dev)]
    let re_metadata = Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();

    #[cfg(dev)]
    let data_removed_metadata: String = re_metadata.replace(&data_removed_bom, "").to_string();

    #[cfg(dev)]
    return kc_api::parser::request_parser(name, data_removed_metadata);

    #[cfg(any(not(dev), check_release))]
    return kc_api::parser::request_parser(name, data_removed_bom);
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
                        tracing::warn!("Received None message");
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
                        tracing::warn!("Received None message");
                    },
                    Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                        tracing::info!("Received shutdown message: {} {}", status, message);
                        let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                            status: "SHUTTING DOWN".to_string(),
                            message: "Response parser is shutting down".to_string(),
                        }).await;
                        break;
                    },
                    Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                        tracing::info!("Received health message: {} {}", status, message);
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
    tracing::info!("Shutting Response parser");
}

pub fn serve_reponse_parser(
    handle: &tauri::AppHandle,
    slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
    proxy_log_slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>,
) {
    let handle_clone = handle.clone();
    tokio::task::spawn(async move { response_parser(&handle_clone, slave, proxy_log_slave).await });
}
