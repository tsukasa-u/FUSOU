use parquet_derive::ParquetRecordWriter;
use serde::{Deserialize, Serialize};
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

use register_trait::{TraitForDecode, TraitForEncode};

pub type OwnDeckId = Uuid;
pub type SupportDeckId = Uuid;
pub type EnemyDeckId = Uuid;
pub type FriendDeckId = Uuid;

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct OwnDeck {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of OwnDeck.
    pub uuid: Vec<u8>,
    /// UUID of OwnShip. This UUID may be referenced multiple times.
    pub ship_ids: Vec<u8>,
    pub combined_flag: Option<i64>,
}

impl OwnDeck {
    pub fn new_ret_uuid(data: i64, table: &mut PortTable, env_uuid: EnvInfoId) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();

        let decks = DeckPorts::load();
        let deck = decks.deck_ports.get(&data)?;

        let ships = Ships::load();
        let new_ship_ids = deck.ship.clone().map(|ship_ids| {
            let ret: Vec<Option<Uuid>> = ship_ids
                .into_iter()
                .map(|ship_id| {
                    let ship = ships.ships.get(&ship_id)?;
                    let ship_id = ship.ship_id?;
                    let new_ship = OwnShip::new_ret_uuid(ship_id, table, env_uuid);
                    return new_ship;
                })
                .collect();
            return ret;
        })?;

        let new_data = OwnDeck {
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
            combined_flag: decks.combined_flag,
        };

        table.own_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct SupportDeck {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of SupportDeck.
    pub uuid: Vec<u8>,
    /// UUID of OwnShip. This UUID may be referenced multiple times.
    pub ship_ids: Vec<u8>,
}

impl SupportDeck {
    pub fn new_ret_uuid(data: i64, table: &mut PortTable, env_uuid: EnvInfoId) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();

        let decks = DeckPorts::load();
        let deck = decks.deck_ports.get(&data)?;

        let ships = Ships::load();
        let new_ship_ids = deck.ship.clone().map(|ship_ids| {
            let ret: Vec<Option<Uuid>> = ship_ids
                .into_iter()
                .map(|ship_id| {
                    let ship = ships.ships.get(&ship_id)?;
                    let ship_id = ship.ship_id?;
                    let new_ship = OwnShip::new_ret_uuid(ship_id, table, env_uuid);
                    return new_ship;
                })
                .collect();
            return ret;
        })?;

        let new_data = SupportDeck {
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
        };

        table.support_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct EnemyDeck {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of EnemyDeck.
    pub uuid: Vec<u8>,
    /// UUID of EnemyShip. This UUID may be referenced multiple times.
    pub ship_ids: Vec<u8>,
}

impl EnemyDeck {
    pub fn new_ret_uuid(
        data: crate::interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
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
                        let new_ship = EnemyShip::new_ret_uuid(props, table, env_uuid);
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

        return Some(new_uuid);
    }
}

#[derive(
    Debug, Clone, Deserialize, Serialize, ParquetRecordWriter, TraitForEncode, TraitForDecode,
)]
pub struct FriendDeck {
    /// UUID of EnvInfo.
    pub env_uuid: Vec<u8>,
    /// UUID of FriendDeck.
    pub uuid: Vec<u8>,
    /// UUID of FriendShip. This UUID may be referenced multiple times.
    pub ship_ids: Vec<u8>,
}

impl FriendDeck {
    pub fn new_ret_uuid(
        data: crate::interface::battle::FriendlyForceInfo,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
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
                let new_ship = FriendShip::new_ret_uuid(friend_props, table, env_uuid);
                return new_ship;
            })
            .collect();

        let new_data = FriendDeck {
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
        };
        table.friend_deck.push(new_data);

        return Some(new_uuid);
    }
}
