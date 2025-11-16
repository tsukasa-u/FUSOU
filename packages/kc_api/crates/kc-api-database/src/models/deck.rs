use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::env_info::EnvInfoId;
use crate::models::ship::EnemyShip;
use crate::models::ship::EnemyShipId;
use crate::models::ship::EnemyShipProps;
use crate::models::ship::FriendShip;
use crate::models::ship::FriendShipId;
use crate::models::ship::FriendShipProps;
use crate::models::ship::OwnShip;
use crate::models::ship::OwnShipId;
use crate::table::PortTable;
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::ship::Ships;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type OwnDeckId = Uuid;
pub type SupportDeckId = Uuid;
pub type EnemyDeckId = Uuid;
pub type FriendDeckId = Uuid;

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct OwnDeck {
    pub env_uuid: EnvInfoId,
    pub uuid: OwnDeckId,
    pub ship_ids: Option<OwnShipId>,
    pub combined_flag: Option<i32>,
}

impl OwnDeck {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: i64,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let decks = DeckPorts::load();
        let deck_option = decks.deck_ports.get(&data);
        let deck = match deck_option {
            Some(d) => d,
            None => {
                tracing::warn!("OwnDeck::new: deck not found for id {}", data);
                return None;
            }
        };

        let ships = Ships::load();
        let new_ship_ids = Uuid::new_v7(ts);
        let result = deck.ship.clone().map(|ship_ids| {
            ship_ids
                .iter()
                .enumerate()
                .map(|(ship_id_index, ship_id)| {
                    let ship = match ships.ships.get(ship_id) {
                        Some(ship) => ship,
                        None => {
                            tracing::warn!("OwnDeck::new: ship not found for id {}", ship_id);
                            return None;
                        }
                    };
                    let ship_id = match ship.ship_id {
                        Some(id) => id,
                        None => {
                            tracing::warn!("OwnDeck::new: ship_id is None for ship id {}", ship_id);
                            return None;
                        }
                    };
                    OwnShip::new_ret_option(
                        ts,
                        new_ship_ids,
                        ship_id,
                        table,
                        env_uuid,
                        ship_id_index,
                    )
                })
                .collect::<Vec<_>>()
        });
        let new_ship_ids_wrap = match result {
            Some(v) if v.iter().any(|x| x.is_some()) => Some(new_ship_ids),
            _ => None,
        };

        let new_data = OwnDeck {
            env_uuid,
            uuid,
            ship_ids: new_ship_ids_wrap,
            combined_flag: decks.combined_flag.map(|flag| flag as i32),
        };

        table.own_deck.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct SupportDeck {
    pub env_uuid: EnvInfoId,
    pub uuid: SupportDeckId,
    pub ship_ids: Option<OwnShipId>,
}

impl SupportDeck {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: i64,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let decks = DeckPorts::load();
        let deck = match decks.deck_ports.get(&data) {
            Some(deck) => deck,
            None => {
                tracing::warn!("SupportDeck::new: deck not found for id {}", data);
                return None;
            }
        };

        let ships = Ships::load();
        let new_ship_ids = Uuid::new_v7(ts);
        let result = deck.ship.clone().map(|ship_ids| {
            ship_ids
                .iter()
                .enumerate()
                .map(|(ship_id_index, ship_id)| {
                    let ship = match ships.ships.get(ship_id) {
                        Some(ship) => ship,
                        None => {
                            tracing::warn!("SupportDeck::new: ship not found for id {}", ship_id);
                            return None;
                        }
                    };
                    let ship_id = match ship.ship_id {
                        Some(id) => id,
                        None => {
                            tracing::warn!(
                                "SupportDeck::new: ship_id is None for ship id {}",
                                ship_id
                            );
                            return None;
                        }
                    };
                    OwnShip::new_ret_option(
                        ts,
                        new_ship_ids,
                        ship_id,
                        table,
                        env_uuid,
                        ship_id_index,
                    )
                })
                .collect::<Vec<_>>()
        });
        let new_ship_ids_wrap = match result {
            Some(v) if v.iter().any(|x| x.is_some()) => Some(new_ship_ids),
            _ => None,
        };

        let new_data = SupportDeck {
            env_uuid,
            uuid,
            ship_ids: new_ship_ids_wrap,
        };

        table.support_deck.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct EnemyDeck {
    pub env_uuid: EnvInfoId,
    pub uuid: EnemyDeckId,
    pub ship_ids: Option<EnemyShipId>,
}

impl EnemyDeck {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_ship_ids = Uuid::new_v7(ts);
        let result = data.enemy_ship_id.map(|ship_ids| {
            ship_ids
                .iter()
                .enumerate()
                .map(|(ship_id_index, ship_id)| {
                    let props: EnemyShipProps = (
                        data.e_lv
                            .clone()
                            .map(|lv| lv[ship_id_index] as i32),
                        data.e_hp_max
                            .clone()
                            .map(|hp| hp[ship_id_index] as i32),
                        data.e_hp_max
                            .clone()
                            .map(|hp| hp[ship_id_index] as i32),
                        data.e_slot.clone().map(|slot| {
                            slot[ship_id_index]
                                .clone()
                                .into_iter()
                                .map(|value| value as i32)
                                .collect()
                        }),
                        data.e_params
                            .clone()
                            .map(|param| {
                                param[ship_id_index]
                                    .clone()
                                    .into_iter()
                                    .map(|value| value as i32)
                                    .collect()
                            }),
                        *ship_id as i32,
                    );
                    EnemyShip::new_ret_option(
                        ts,
                        new_ship_ids,
                        props,
                        table,
                        env_uuid,
                        ship_id_index,
                    )
                })
                .collect::<Vec<_>>()
        });
        let new_ship_ids_wrap = match result {
            Some(v) if v.iter().any(|x| x.is_some()) => Some(new_ship_ids),
            _ => None,
        };

        let new_data = EnemyDeck {
            env_uuid,
            uuid,
            ship_ids: new_ship_ids_wrap,
        };
        table.enemy_deck.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct FriendDeck {
    pub env_uuid: EnvInfoId,
    pub uuid: FriendDeckId,
    pub ship_ids: Option<FriendShipId>,
}

impl FriendDeck {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::FriendlyForceInfo,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_ship_ids = Uuid::new_v7(ts);
        let result = data
            .ship_id
            .iter()
            .enumerate()
            .map(|(ship_id_index, ship_id)| {
                let friend_props: FriendShipProps = (
                    Some(data.ship_lv[ship_id_index] as i32),
                    Some(data.now_hps[ship_id_index] as i32),
                    Some(data.max_hps[ship_id_index] as i32),
                    Some(
                        data.slot[ship_id_index]
                            .clone()
                            .into_iter()
                            .map(|value| value as i32)
                            .collect(),
                    ),
                    Some(data.slot_ex[ship_id_index] as i32),
                    Some(
                        data.params[ship_id_index]
                            .clone()
                            .into_iter()
                            .map(|value| value as i32)
                            .collect(),
                    ),
                    *ship_id as i32,
                );
                FriendShip::new_ret_option(
                    ts,
                    new_ship_ids,
                    friend_props,
                    table,
                    env_uuid,
                    ship_id_index,
                )
            })
            .collect::<Vec<_>>();
        let new_ship_ids_wrap = match result.iter().any(|x| x.is_some()) {
            true => Some(new_ship_ids),
            false => None,
        };

        let new_data = FriendDeck {
            env_uuid,
            uuid,
            ship_ids: new_ship_ids_wrap,
        };
        table.friend_deck.push(new_data);

        Some(())
    }
}
