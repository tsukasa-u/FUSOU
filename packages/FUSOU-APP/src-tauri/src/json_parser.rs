use kc_api::interface::cells::Cells;
use kc_api::interface::ship::Ships;
use proxy_https::bidirectional_channel;
use std::error::Error;
use tauri::Emitter;

#[cfg(dev)]
use regex::Regex;
#[cfg(dev)]
use std::sync::LazyLock;

#[cfg(dev)]
static RE_METADATA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap());

use crate::events;
use crate::storage::submit_data;

use kc_api::interface::air_base::AirBases;
use kc_api::interface::deck_port::DeckPorts;
use kc_api::interface::interface::{Add, EmitData, Identifier, Set};
use kc_api::parser::parser::{request_parser, response_parser};

pub fn emit_data(handle: &tauri::AppHandle, emit_data: EmitData) {
    match emit_data {
        EmitData::Add(data) => match data {
            Add::Materials(data) => {
                let _ = handle.emit_to("main", events::ADD_KCS_MATERIALS, data);
            }
            Add::Ships(data) => {
                data.add_or();
                let _ = handle.emit_to("main", events::ADD_KCS_SHIPS, data);
            }
            Add::Battle(data) => {
                let cell_id = data.cell_id;
                data.add_or();
                let merged_battle = Cells::load().battles.get(&cell_id).cloned().unwrap_or(data);
                let _ = handle.emit_to("main", events::ADD_KCS_BATTLE, merged_battle);
            }
            Add::Cell(data) => {
                data.add_or();
                let _ = handle.emit_to("main", events::ADD_KCS_CELL, data);
            }
            Add::QuestEvent(data) => {
                crate::senders::quest_tree_sender::enqueue(data);
            }
            Add::Dammy(_) => {
                let _ = handle.emit_to("main", events::ADD_KCS_DAMMY, ());
            }
        },
        EmitData::Set(data) => match data {
            Set::DeckPorts(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_DECK_PORTS, data);
            }
            Set::Basic(data) => {
                data.restore();
                // Baseline flow: the dataset public_id is managed via anonymous session.
                // Social-link upsert is handled separately in OAuth callback handling.
                let handle_clone = handle.clone();
                tokio::task::spawn(async move {
                    // Create/restore anonymous session for data uploads
                    crate::util::try_anonymous_auth(&handle_clone).await;
                });
            }
            Set::Materials(data) => {
                let _ = handle.emit_to("main", events::SET_KCS_MATERIALS, data);
            }
            Set::UseItems(data) => {
                data.restore();
                // UseItems is not forwarded to the frontend.
            }
            Set::Ships(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_SHIPS, data);
            }
            Set::SlotItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_SLOT_ITEMS, data);
            }
            Set::NDocks(data) => {
                let _ = handle.emit_to("main", events::SET_KCS_N_DOCKS, data);
            }
            Set::Logs(data) => {
                let _ = handle.emit_to("main", events::SET_KCS_LOGS, data);
            }
            Set::AirBases(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_AIR_BASES_PORTS, data);
            }
            Set::MstShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_MST_SHIPS, data);
            }
            Set::MstSlotItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_MST_SLOT_ITEMS, data);
            }
            Set::MstEquipExslotShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_MST_EQUIP_EXSLOT_SHIPS, data);
            }
            Set::MstEquipShips(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_MST_EQUIP_SHIPS, data);
            }
            Set::MstStypes(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_MST_STYPES, data);
            }
            Set::MstUseItems(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_MST_USE_ITEMS, data);
            }
            Set::MstSlotItemEquipTypes(data) => {
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_MST_SLOT_ITEM_EQUIP_TYPES, data);
            }
            Set::Cells(data) => {
                let mut data = data;
                crate::map_cell_labels::apply_to_cells(&mut data);
                data.restore();
                let _ = handle.emit_to("main", events::SET_KCS_CELLS, data);
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
            Set::Quests(data) => {
                data.restore();
                crate::senders::quest_tree_sender::enqueue_snapshot(data.clone());
                let _ = handle.emit_to("main", events::SET_KCS_QUESTS, data);
            }
            Set::ShipGrowthSnapshot(data) => {
                crate::senders::ship_growth_sender::enqueue_snapshot(data);
            }
            Set::SokuSpeedObservedSnapshot(data) => {
                crate::senders::soku_speed_sender::enqueue_snapshot(data);
            }
            Set::RemodelSlotList(data) => {
                crate::senders::remodel_sender::enqueue_slotlist(data);
            }
            Set::RemodelDetail(data) => {
                crate::senders::remodel_sender::enqueue_detail(data);
            }
            Set::Dammy(_) => {
                let _ = handle.emit_to("main", events::SET_KCS_DAMMY, ());
            }
        },
        EmitData::Identifier(data) => match data {
            Identifier::Port(_) => {
                submit_data::submit_port_table();
            }
            Identifier::RequireInfo(_) => {}
            Identifier::GetData(_) => {
                submit_data::submit_get_data_table();
                Cells::reset();
            }
            Identifier::MapStart(_) => {
                let _ = handle.emit_to("main", events::SET_KCS_AIR_BASES_BATTLES, AirBases::load());
                let _ = handle.emit_to("main", events::SET_KCS_DECK_BATTLES, DeckPorts::load());
                Ships::cashe_restore();
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
    {
        let data_removed_metadata: String =
            RE_METADATA.replace(&data_removed_svdata, "").to_string();
        response_parser(name, data_removed_metadata)
    }

    #[cfg(any(not(dev), check_release))]
    return response_parser(name, data_removed_svdata);
}

pub fn struct_selector_resquest(
    name: String,
    data: String,
) -> Result<Vec<EmitData>, Box<dyn Error>> {
    let data_removed_bom: String = data.replace("\u{feff}", "");

    #[cfg(dev)]
    {
        let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
        let data_removed_metadata: String =
            RE_METADATA.replace(&data_removed_svdata, "").to_string();
        let repalced_data = data_removed_metadata
            .replace("%5B", "[")
            .replace("%5D", "]");
        request_parser(name, repalced_data)
    }

    #[cfg(any(not(dev), check_release))]
    return request_parser(name, data_removed_bom);
}

async fn parser_server(
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
                            if crate::map_cell_labels::map_ids_from_resource_path(&path).is_some() {
                                return;
                            }

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
    tokio::task::spawn(async move { parser_server(&handle_clone, slave, proxy_log_slave).await });
}
