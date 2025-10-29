use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use tracing_unwrap::OptionExt;
use uuid::Uuid;

use crate::database::env_info::EnvInfoId;
use crate::database::ship::EnemyShip;
use crate::database::ship::EnemyShipId;
use crate::database::ship::EnemyShipProps;
use crate::database::ship::FriendShip;
use crate::database::ship::FriendShipId;
use crate::database::ship::FriendShipProps;
use crate::database::ship::OwnShip;
use crate::database::ship::OwnShipId;
use crate::database::table::PortTable;
use crate::interface::deck_port::DeckPorts;
use crate::interface::ship::Ships;

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
    pub ship_ids: OwnShipId,
    pub combined_flag: Option<i64>,
}

impl OwnDeck {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: i64,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) {
        let decks = DeckPorts::load();
        let deck_option = decks.deck_ports.get(&data);
        let deck = match deck_option {
            Some(d) => d,
            None => {
                tracing::warn!("OwnDeck::new: deck not found for id {}", data);
                return;
            }
        };

        let ships = Ships::load();
        let new_ship_ids = Uuid::new_v7(ts);
        deck.ship.clone().map(|ship_ids| {
            ship_ids.iter().enumerate().map(|(ship_id_index, ship_id)| {
                let ship = match ships.ships.get(&ship_id) {
                    Some(ship) => ship,
                    None => {
                        tracing::warn!("OwnDeck::new: ship not found for id {}", ship_id);
                        return;
                    }
                };
                let ship_id = match ship.ship_id {
                    Some(id) => id,
                    None => {
                        tracing::warn!("OwnDeck::new: ship_id is None for ship id {}", ship_id);
                        return;
                    }
                };
                OwnShip::new(ts, new_ship_ids, ship_id, table, env_uuid, ship_id_index);
            });
        });

        let new_data = OwnDeck {
            env_uuid,
            uuid,
            ship_ids: new_ship_ids,
            combined_flag: decks.combined_flag,
        };

        table.own_deck.push(new_data);
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
    pub ship_ids: OwnShipId,
}

impl SupportDeck {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: i64,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) {
        let decks = DeckPorts::load();
        let deck = match decks.deck_ports.get(&data) {
            Some(deck) => deck,
            None => {
                tracing::warn!("SupportDeck::new: deck not found for id {}", data);
                return;
            }
        };

        let ships = Ships::load();
        let new_ship_ids = Uuid::new_v7(ts);
        deck.ship.clone().map(|ship_ids| {
            ship_ids.iter().enumerate().map(|(ship_id_index, ship_id)| {
                let ship = match ships.ships.get(&ship_id) {
                    Some(ship) => ship,
                    None => {
                        tracing::warn!("SupportDeck::new: ship not found for id {}", ship_id);
                        return None;
                    }
                };
                let ship_id = match ship.ship_id {
                    Some(id) => id,
                    None => {
                        tracing::warn!("SupportDeck::new: ship_id is None for ship id {}", ship_id);
                        return None;
                    }
                };
                OwnShip::new(ts, new_ship_ids, ship_id, table, env_uuid, ship_id_index);
            });
        })?;

        let new_data = SupportDeck {
            env_uuid,
            uuid,
            ship_ids: new_ship_ids,
        };

        table.support_deck.push(new_data);
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
    pub ship_ids: EnemyShipId,
}

impl EnemyDeck {
    pub fn new(data: crate::interface::battle::Battle, table: &mut PortTable, env_uuid: EnvInfoId) {
        let new_uuid = Uuid::new_v4();

        let new_ship_ids = data
            .enemy_ship_id
            .map(|ship_ids| {
                ship_ids
                    .iter()
                    .enumerate()
                    .map(|(i, ship_id)| {
                        let props: EnemyShipProps = (
                            None,
                            data.e_hp_max.clone().map(|hp| hp[i]),
                            data.e_hp_max.clone().map(|hp| hp[i]),
                            data.e_slot.clone().map(|slot| slot[i].clone()),
                            data.e_params.clone().map(|param| param[i].clone()),
                            Some(*ship_id),
                        );
                        let new_ship = EnemyShip::new(props, table, env_uuid);
                        return new_ship;
                    })
                    .collect()
            })
            .unwrap_or_default();

        let new_data = EnemyDeck {
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
        };
        table.enemy_deck.push(new_data);
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
    pub ship_ids: FriendShipId,
}

impl FriendDeck {
    pub fn new(
        data: crate::interface::battle::FriendlyForceInfo,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) {
        let new_uuid = Uuid::new_v4();

        let new_ship_ids = data
            .ship_id
            .iter()
            .enumerate()
            .map(|(i, ship_id)| {
                let friend_props: FriendShipProps = (
                    Some(data.ship_lv[i]),
                    Some(data.now_hps[i]),
                    Some(data.max_hps[i]),
                    Some(data.slot[i].clone()),
                    Some(data.slot_ex[i]),
                    Some(data.params[i].clone()),
                    Some(*ship_id),
                );
                let new_ship = FriendShip::new(friend_props, table, env_uuid);
                return new_ship;
            })
            .collect();

        let new_data = FriendDeck {
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
        };
        table.friend_deck.push(new_data);
    }
}
