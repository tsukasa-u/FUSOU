use apache_avro::AvroSchema;
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
use crate::database::table::DATABASE_TABLE_VERSION;
use crate::interface::deck_port::DeckPorts;
use crate::interface::ship::Ships;

use register_trait::TraitForEncode;

pub type OwnDeckId = Uuid;
pub type SupportDeckId = Uuid;
pub type EnemyDeckId = Uuid;
pub type FriendDeckId = Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct OwnDeck {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: OwnDeckId,
    pub ship_ids: Vec<Option<OwnShipId>>,
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
            version: DATABASE_TABLE_VERSION.to_string(),
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
            combined_flag: decks.combined_flag,
        };

        table.own_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct SupportDeck {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: SupportDeckId,
    pub ship_ids: Vec<Option<OwnShipId>>,
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
            version: DATABASE_TABLE_VERSION.to_string(),
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
        };

        table.support_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct EnemyDeck {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: EnemyDeckId,
    pub ship_ids: Vec<EnemyShipId>,
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
            version: DATABASE_TABLE_VERSION.to_string(),
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
        };
        table.enemy_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct FriendDeck {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: FriendDeckId,
    pub ship_ids: Vec<FriendShipId>,
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
            version: DATABASE_TABLE_VERSION.to_string(),
            env_uuid,
            uuid: new_uuid,
            ship_ids: new_ship_ids,
        };
        table.friend_deck.push(new_data);

        return Some(new_uuid);
    }
}
