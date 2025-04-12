use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::ship::{EnemyShip, EnemyShipProps, FriendShip, FriendShipProps, OwnShip};
use crate::database::table::Table;
use crate::interface::deck_port::KCS_DECKS;
use crate::interface::ship::KCS_SHIPS;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct OwnDeck {
    pub ship_ids: Vec<Option<Uuid>>,
    pub combined_flag: Option<i64>,
}

impl OwnDeck {
    pub fn new_ret_uuid(data: i64, table: &mut Table) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();

        let decks = KCS_DECKS.lock().unwrap();
        let deck = decks.deck_ports.get(&data)?;

        let ships = KCS_SHIPS.lock().unwrap();
        let new_ship_ids = deck.ship.clone().map(|ship_ids| {
            let ret: Vec<Option<Uuid>> = ship_ids
                .into_iter()
                .map(|ship_id| {
                    let ship = ships.ships.get(&ship_id)?;
                    let ship_id = ship.ship_id?;
                    let new_ship = OwnShip::new_ret_uuid(ship_id, table);
                    return new_ship;
                })
                .collect();
            return ret;
        })?;

        let new_data = OwnDeck {
            ship_ids: new_ship_ids,
            combined_flag: decks.combined_flag,
        };

        table.own_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct SupportDeck {
    pub ship_ids: Vec<Option<Uuid>>,
}

impl SupportDeck {
    pub fn new_ret_uuid(data: i64, table: &mut Table) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();

        let decks = KCS_DECKS.lock().unwrap();
        let deck = decks.deck_ports.get(&data)?;

        let ships = KCS_SHIPS.lock().unwrap();
        let new_ship_ids = deck.ship.clone().map(|ship_ids| {
            let ret: Vec<Option<Uuid>> = ship_ids
                .into_iter()
                .map(|ship_id| {
                    let ship = ships.ships.get(&ship_id)?;
                    let ship_id = ship.ship_id?;
                    let new_ship = OwnShip::new_ret_uuid(ship_id, table);
                    return new_ship;
                })
                .collect();
            return ret;
        })?;

        let new_data = SupportDeck {
            ship_ids: new_ship_ids,
        };

        table.support_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct EnemyDeck {
    pub ship_ids: Vec<Uuid>,
}

impl EnemyDeck {
    pub fn new_ret_uuid(data: crate::interface::battle::Battle, table: &mut Table) -> Option<Uuid> {
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
                        let new_ship = EnemyShip::new_ret_uuid(props, table);
                        return new_ship;
                    })
                    .collect()
            })
            .unwrap_or_default();

        let new_data = EnemyDeck {
            ship_ids: new_ship_ids,
        };
        table.enemy_deck.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema)]
pub struct FriendDeck {
    pub ship_ids: Vec<Uuid>,
}

impl FriendDeck {
    pub fn new_ret_uuid(
        data: crate::interface::battle::FriendlyForceInfo,
        table: &mut Table,
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
                let new_ship = FriendShip::new_ret_uuid(friend_props, table);
                return new_ship;
            })
            .collect();

        let new_data = FriendDeck {
            ship_ids: new_ship_ids,
        };
        table.friend_deck.push(new_data);

        return Some(new_uuid);
    }
}
