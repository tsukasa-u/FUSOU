// use dotenvy_macro::dotenv;

use std::str::FromStr;

use crate::encode::encode;
use crate::models::airbase::{AirBase, PlaneInfo};
use crate::models::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle, CarrierBaseAssault,
    ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList,
    MidnightHougeki, MidnightHougekiList, OpeningAirAttack, OpeningAirAttackList, OpeningRaigeki,
    OpeningTaisen, OpeningTaisenList, SupportAirattack, SupportHourai,
};
use crate::models::cell::Cells;
use crate::models::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use crate::models::env_info::{EnvInfo, UserEnv};
use crate::models::ship::{EnemyShip, FriendShip, OwnShip};
use crate::models::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};

use kc_api_interface::mst_equip_exslot::{MstEquipExslot, MstEquipExslots};
use kc_api_interface::mst_equip_exslot_ship::{MstEquipExslotShip, MstEquipExslotShips};
use kc_api_interface::mst_equip_limit_exslot::{MstEquipLimitExslot, MstEquipLimitExslots};
use kc_api_interface::mst_equip_ship::{MstEquipShip, MstEquipShips};
use kc_api_interface::mst_maparea::{MstMapArea, MstMapAreas};
use kc_api_interface::mst_mapinfo::{MstMapInfo, MstMapInfos};
use kc_api_interface::mst_ship::{MstShip, MstShips};
use kc_api_interface::mst_ship_graph::{MstShipGraph, MstShipGraphs};
use kc_api_interface::mst_ship_upgrade::{MstShipUpgrade, MstShipUpgrades};
use kc_api_interface::mst_slot_item::{MstSlotItem, MstSlotItems};
use kc_api_interface::mst_slot_item_equip_type::{MstSlotItemEquipType, MstSlotItemEquipTypes};
use kc_api_interface::mst_stype::{MstStype, MstStypes};
use kc_api_interface::mst_use_item::{MstUseItem, MstUseItems};

use register_trait::FieldSizeChecker;
use uuid::Uuid;

// Import DATABASE_TABLE_VERSION from schema_version module
pub use crate::schema_version::DATABASE_TABLE_VERSION;

#[derive(Debug, Clone)]
pub enum PortTableEnum {
    EnvInfo,
    Cells,
    AirBase,
    PlaneInfo,
    OwnSlotItem,
    EnemySlotItem,
    FriendSlotItem,
    OwnShip,
    EnemyShip,
    FriendShip,
    OwnDeck,
    SupportDeck,
    EnemyDeck,
    FriendDeck,
    AirBaseAirAttack,
    AirBaseAirAttackList,
    AirBaseAssult,
    CarrierBaseAssault,
    ClosingRaigeki,
    FriendlySupportHourai,
    FriendlySupportHouraiList,
    Hougeki,
    HougekiList,
    MidnightHougeki,
    MidnightHougekiList,
    OpeningAirAttack,
    OpeningAirAttackList,
    OpeningRaigeki,
    OpeningTaisen,
    OpeningTaisenList,
    SupportAirattack,
    SupportHourai,
    Battle,
}

#[derive(Debug, Clone, Default, FieldSizeChecker)]
pub struct PortTable {
    pub env_info: Vec<EnvInfo>,
    pub cells: Vec<Cells>,
    pub airbase: Vec<AirBase>,
    pub plane_info: Vec<PlaneInfo>,
    pub own_slotitem: Vec<OwnSlotItem>,
    pub enemy_slotitem: Vec<EnemySlotItem>,
    pub friend_slotitem: Vec<FriendSlotItem>,
    pub own_ship: Vec<OwnShip>,
    pub enemy_ship: Vec<EnemyShip>,
    pub friend_ship: Vec<FriendShip>,
    pub own_deck: Vec<OwnDeck>,
    pub support_deck: Vec<SupportDeck>,
    pub enemy_deck: Vec<EnemyDeck>,
    pub friend_deck: Vec<FriendDeck>,
    pub airbase_airattack: Vec<AirBaseAirAttack>,
    pub airbase_airattack_list: Vec<AirBaseAirAttackList>,
    pub airbase_assult: Vec<AirBaseAssult>,
    pub carrierbase_assault: Vec<CarrierBaseAssault>,
    pub closing_raigeki: Vec<ClosingRaigeki>,
    pub friendly_support_hourai: Vec<FriendlySupportHourai>,
    pub friendly_support_hourai_list: Vec<FriendlySupportHouraiList>,
    pub hougeki: Vec<Hougeki>,
    pub hougeki_list: Vec<HougekiList>,
    pub midnight_hougeki: Vec<MidnightHougeki>,
    pub midnight_hougeki_list: Vec<MidnightHougekiList>,
    pub opening_airattack: Vec<OpeningAirAttack>,
    pub opening_airattack_list: Vec<OpeningAirAttackList>,
    pub opening_raigeki: Vec<OpeningRaigeki>,
    pub opening_taisen: Vec<OpeningTaisen>,
    pub opening_taisen_list: Vec<OpeningTaisenList>,
    pub support_airattack: Vec<SupportAirattack>,
    pub support_hourai: Vec<SupportHourai>,
    pub battle: Vec<Battle>,
}

#[derive(Debug, Clone, Default)]
pub struct PortTableEncode {
    pub env_info: Vec<u8>,
    pub cells: Vec<u8>,
    pub airbase: Vec<u8>,
    pub plane_info: Vec<u8>,
    pub own_slotitem: Vec<u8>,
    pub enemy_slotitem: Vec<u8>,
    pub friend_slotitem: Vec<u8>,
    pub own_ship: Vec<u8>,
    pub enemy_ship: Vec<u8>,
    pub friend_ship: Vec<u8>,
    pub own_deck: Vec<u8>,
    pub support_deck: Vec<u8>,
    pub enemy_deck: Vec<u8>,
    pub friend_deck: Vec<u8>,
    pub airbase_airattack: Vec<u8>,
    pub airbase_airattack_list: Vec<u8>,
    pub airbase_assult: Vec<u8>,
    pub carrierbase_assault: Vec<u8>,
    pub closing_raigeki: Vec<u8>,
    pub friendly_support_hourai: Vec<u8>,
    pub friendly_support_hourai_list: Vec<u8>,
    pub hougeki: Vec<u8>,
    pub hougeki_list: Vec<u8>,
    pub midnight_hougeki: Vec<u8>,
    pub midnight_hougeki_list: Vec<u8>,
    pub opening_airattack: Vec<u8>,
    pub opening_airattack_list: Vec<u8>,
    pub opening_raigeki: Vec<u8>,
    pub opening_taisen: Vec<u8>,
    pub opening_taisen_list: Vec<u8>,
    pub support_airattack: Vec<u8>,
    pub support_hourai: Vec<u8>,
    pub battle: Vec<u8>,
}

impl EnvInfo {
    pub fn get_table_name() -> String {
        "env_info".to_string()
    }
}
impl Cells {
    pub fn get_table_name() -> String {
        "cells".to_string()
    }
}
impl AirBase {
    pub fn get_table_name() -> String {
        "airbase".to_string()
    }
}
impl PlaneInfo {
    pub fn get_table_name() -> String {
        "plane_info".to_string()
    }
}
impl OwnSlotItem {
    pub fn get_table_name() -> String {
        "own_slotitem".to_string()
    }
}
impl EnemySlotItem {
    pub fn get_table_name() -> String {
        "enemy_slotitem".to_string()
    }
}
impl FriendSlotItem {
    pub fn get_table_name() -> String {
        "friend_slotitem".to_string()
    }
}
impl OwnShip {
    pub fn get_table_name() -> String {
        "own_ship".to_string()
    }
}
impl EnemyShip {
    pub fn get_table_name() -> String {
        "enemy_ship".to_string()
    }
}
impl FriendShip {
    pub fn get_table_name() -> String {
        "friend_ship".to_string()
    }
}
impl OwnDeck {
    pub fn get_table_name() -> String {
        "own_deck".to_string()
    }
}
impl SupportDeck {
    pub fn get_table_name() -> String {
        "support_deck".to_string()
    }
}
impl EnemyDeck {
    pub fn get_table_name() -> String {
        "enemy_deck".to_string()
    }
}
impl FriendDeck {
    pub fn get_table_name() -> String {
        "friend_deck".to_string()
    }
}
impl AirBaseAirAttack {
    pub fn get_table_name() -> String {
        "airbase_airattack".to_string()
    }
}
impl AirBaseAirAttackList {
    pub fn get_table_name() -> String {
        "airbase_airattack_list".to_string()
    }
}
impl AirBaseAssult {
    pub fn get_table_name() -> String {
        "airbase_assult".to_string()
    }
}
impl CarrierBaseAssault {
    pub fn get_table_name() -> String {
        "carrierbase_assault".to_string()
    }
}
impl ClosingRaigeki {
    pub fn get_table_name() -> String {
        "closing_raigeki".to_string()
    }
}
impl FriendlySupportHourai {
    pub fn get_table_name() -> String {
        "friendly_support_hourai".to_string()
    }
}
impl FriendlySupportHouraiList {
    pub fn get_table_name() -> String {
        "friendly_support_hourai_list".to_string()
    }
}
impl Hougeki {
    pub fn get_table_name() -> String {
        "hougeki".to_string()
    }
}
impl HougekiList {
    pub fn get_table_name() -> String {
        "hougeki_list".to_string()
    }
}
impl MidnightHougeki {
    pub fn get_table_name() -> String {
        "midnight_hougeki".to_string()
    }
}
impl MidnightHougekiList {
    pub fn get_table_name() -> String {
        "midnight_hougeki_list".to_string()
    }
}
impl OpeningAirAttack {
    pub fn get_table_name() -> String {
        "opening_airattack".to_string()
    }
}
impl OpeningAirAttackList {
    pub fn get_table_name() -> String {
        "opening_airattack_list".to_string()
    }
}
impl OpeningRaigeki {
    pub fn get_table_name() -> String {
        "opening_raigeki".to_string()
    }
}
impl OpeningTaisen {
    pub fn get_table_name() -> String {
        "opening_taisen".to_string()
    }
}
impl OpeningTaisenList {
    pub fn get_table_name() -> String {
        "opening_taisen_list".to_string()
    }
}
impl SupportAirattack {
    pub fn get_table_name() -> String {
        "support_airattack".to_string()
    }
}
impl SupportHourai {
    pub fn get_table_name() -> String {
        "support_hourai".to_string()
    }
}
impl Battle {
    pub fn get_table_name() -> String {
        "battle".to_string()
    }
}

pub static PORT_TABLE_NAMES: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(|| {
    vec![
        EnvInfo::get_table_name(),
        Cells::get_table_name(),
        AirBase::get_table_name(),
        PlaneInfo::get_table_name(),
        OwnSlotItem::get_table_name(),
        EnemySlotItem::get_table_name(),
        FriendSlotItem::get_table_name(),
        OwnShip::get_table_name(),
        EnemyShip::get_table_name(),
        FriendShip::get_table_name(),
        OwnDeck::get_table_name(),
        EnemyDeck::get_table_name(),
        FriendDeck::get_table_name(),
        SupportDeck::get_table_name(),
        SupportAirattack::get_table_name(),
        OpeningAirAttack::get_table_name(),
        OpeningAirAttackList::get_table_name(),
        OpeningRaigeki::get_table_name(),
        OpeningTaisen::get_table_name(),
        OpeningTaisenList::get_table_name(),
        AirBaseAirAttack::get_table_name(),
        AirBaseAirAttackList::get_table_name(),
        AirBaseAssult::get_table_name(),
        CarrierBaseAssault::get_table_name(),
        FriendlySupportHourai::get_table_name(),
        FriendlySupportHouraiList::get_table_name(),
        Hougeki::get_table_name(),
        HougekiList::get_table_name(),
        MidnightHougeki::get_table_name(),
        MidnightHougekiList::get_table_name(),
        ClosingRaigeki::get_table_name(),
        Battle::get_table_name(),
    ]
});

impl FromStr for PortTableEnum {
    type Err = ();

    fn from_str(input: &str) -> Result<PortTableEnum, Self::Err> {
        match input.to_string() {
            x if x == EnvInfo::get_table_name() => Ok(PortTableEnum::EnvInfo),
            x if x == Cells::get_table_name() => Ok(PortTableEnum::Cells),
            x if x == AirBase::get_table_name() => Ok(PortTableEnum::AirBase),
            x if x == PlaneInfo::get_table_name() => Ok(PortTableEnum::PlaneInfo),
            x if x == OwnSlotItem::get_table_name() => Ok(PortTableEnum::OwnSlotItem),
            x if x == EnemySlotItem::get_table_name() => Ok(PortTableEnum::EnemySlotItem),
            x if x == FriendSlotItem::get_table_name() => Ok(PortTableEnum::FriendSlotItem),
            x if x == OwnShip::get_table_name() => Ok(PortTableEnum::OwnShip),
            x if x == EnemyShip::get_table_name() => Ok(PortTableEnum::EnemyShip),
            x if x == FriendShip::get_table_name() => Ok(PortTableEnum::FriendShip),
            x if x == OwnDeck::get_table_name() => Ok(PortTableEnum::OwnDeck),
            x if x == SupportDeck::get_table_name() => Ok(PortTableEnum::SupportDeck),
            x if x == EnemyDeck::get_table_name() => Ok(PortTableEnum::EnemyDeck),
            x if x == FriendDeck::get_table_name() => Ok(PortTableEnum::FriendDeck),
            x if x == AirBaseAirAttack::get_table_name() => Ok(PortTableEnum::AirBaseAirAttack),
            x if x == AirBaseAirAttackList::get_table_name() => {
                Ok(PortTableEnum::AirBaseAirAttackList)
            }
            x if x == AirBaseAssult::get_table_name() => Ok(PortTableEnum::AirBaseAssult),
            x if x == CarrierBaseAssault::get_table_name() => Ok(PortTableEnum::CarrierBaseAssault),
            x if x == ClosingRaigeki::get_table_name() => Ok(PortTableEnum::ClosingRaigeki),
            x if x == FriendlySupportHourai::get_table_name() => {
                Ok(PortTableEnum::FriendlySupportHourai)
            }
            x if x == FriendlySupportHouraiList::get_table_name() => {
                Ok(PortTableEnum::FriendlySupportHouraiList)
            }
            x if x == Hougeki::get_table_name() => Ok(PortTableEnum::Hougeki),
            x if x == HougekiList::get_table_name() => Ok(PortTableEnum::HougekiList),
            x if x == MidnightHougeki::get_table_name() => Ok(PortTableEnum::MidnightHougeki),
            x if x == MidnightHougekiList::get_table_name() => {
                Ok(PortTableEnum::MidnightHougekiList)
            }
            x if x == OpeningAirAttack::get_table_name() => Ok(PortTableEnum::OpeningAirAttack),
            x if x == OpeningAirAttackList::get_table_name() => {
                Ok(PortTableEnum::OpeningAirAttackList)
            }
            x if x == OpeningRaigeki::get_table_name() => Ok(PortTableEnum::OpeningRaigeki),
            x if x == OpeningTaisen::get_table_name() => Ok(PortTableEnum::OpeningTaisen),
            x if x == OpeningTaisenList::get_table_name() => Ok(PortTableEnum::OpeningTaisenList),
            x if x == SupportAirattack::get_table_name() => Ok(PortTableEnum::SupportAirattack),
            x if x == SupportHourai::get_table_name() => Ok(PortTableEnum::SupportHourai),
            x if x == Battle::get_table_name() => Ok(PortTableEnum::Battle),
            _ => Err(()),
        }
    }
}

impl PortTable {
    pub fn new(
        interface_cells: kc_api_interface::cells::Cells,
        user_env: UserEnv,
        timestamp: i64,
    ) -> PortTable {
        let mut table = PortTable::default();
        let timestamp_context = uuid::ContextV7::new().with_additional_precision();
        let ts: uuid::Timestamp =
            uuid::Timestamp::from_unix(&timestamp_context, timestamp as u64, 0);
        let env_uuid = EnvInfo::new_ret_uuid(ts, (user_env, timestamp), &mut table);
        {
            let uuid = Uuid::new_v7(ts);
            Cells::new_ret_option(ts, uuid, interface_cells.clone(), &mut table, env_uuid)
        };
        tracing::debug!(
            "PortTable::new created with {} cells, maparea_id={}, mapinfo_no={}, battles={}",
            table.cells.len(),
            interface_cells.maparea_id,
            interface_cells.mapinfo_no,
            interface_cells.battles.len()
        );
        table
    }

    pub fn encode(&self) -> Result<PortTableEncode, apache_avro::Error> {
        let airbase = encode(self.airbase.clone())?;
        let plane_info = encode(self.plane_info.clone())?;
        let own_slotitem = encode(self.own_slotitem.clone())?;
        let enemy_slotitem = encode(self.enemy_slotitem.clone())?;
        let friend_slotitem = encode(self.friend_slotitem.clone())?;
        let own_ship = encode(self.own_ship.clone())?;
        let enemy_ship = encode(self.enemy_ship.clone())?;
        let friend_ship = encode(self.friend_ship.clone())?;
        let own_deck = encode(self.own_deck.clone())?;
        let support_deck = encode(self.support_deck.clone())?;
        let enemy_deck = encode(self.enemy_deck.clone())?;
        let friend_deck = encode(self.friend_deck.clone())?;
        let airbase_airattack = encode(self.airbase_airattack.clone())?;
        let airbase_airattack_list = encode(self.airbase_airattack_list.clone())?;
        let airbase_assult = encode(self.airbase_assult.clone())?;
        let carrierbase_assault = encode(self.carrierbase_assault.clone())?;
        let closing_raigeki = encode(self.closing_raigeki.clone())?;
        let friendly_support_hourai = encode(self.friendly_support_hourai.clone())?;
        let friendly_support_hourai_list = encode(self.friendly_support_hourai_list.clone())?;
        let hougeki = encode(self.hougeki.clone())?;
        let hougeki_list = encode(self.hougeki_list.clone())?;
        let midnight_hougeki = encode(self.midnight_hougeki.clone())?;
        let midnight_hougeki_list = encode(self.midnight_hougeki_list.clone())?;
        let opening_airattack = encode(self.opening_airattack.clone())?;
        let opening_airattack_list = encode(self.opening_airattack_list.clone())?;
        let opening_raigeki = encode(self.opening_raigeki.clone())?;
        let opening_taisen = encode(self.opening_taisen.clone())?;
        let opening_taisen_list = encode(self.opening_taisen_list.clone())?;
        let support_airattack = encode(self.support_airattack.clone())?;
        let support_hourai = encode(self.support_hourai.clone())?;
        let battle = encode(self.battle.clone())?;

        let cells = encode(self.cells.clone())?;
        tracing::debug!(
            "PortTable::encode - cells: {} records, {} bytes",
            self.cells.len(),
            cells.len()
        );
        let env_info = encode(self.env_info.clone())?;

        let table_encode = PortTableEncode {
            env_info,
            cells,
            airbase,
            plane_info,
            own_slotitem,
            enemy_slotitem,
            friend_slotitem,
            own_ship,
            enemy_ship,
            friend_ship,
            own_deck,
            support_deck,
            enemy_deck,
            friend_deck,
            airbase_airattack,
            airbase_airattack_list,
            airbase_assult,
            carrierbase_assault,
            closing_raigeki,
            friendly_support_hourai,
            friendly_support_hourai_list,
            hougeki,
            hougeki_list,
            midnight_hougeki,
            midnight_hougeki_list,
            opening_airattack,
            opening_airattack_list,
            opening_raigeki,
            opening_taisen,
            opening_taisen_list,
            support_airattack,
            support_hourai,
            battle,
        };
        Ok(table_encode)
    }

    /// Encode only non-empty tables and return Vec of (table_name, avro_bytes)
    pub fn encode_non_empty_tables(&self) -> Result<Vec<(String, Vec<u8>)>, apache_avro::Error> {
        let mut tables: Vec<(String, Vec<u8>)> = Vec::new();

        // helper macro to encode and push when non-empty
        macro_rules! enc_push_if_non_empty {
            ($name:expr, $vec_len:expr, $encode_expr:expr) => {
                if $vec_len > 0 {
                    let bytes = $encode_expr?;
                    if !bytes.is_empty() {
                        tables.push(($name.to_string(), bytes));
                    }
                }
            };
        }

        // Use the same encoders as encode(), but guard by record counts
        enc_push_if_non_empty!(
            EnvInfo::get_table_name(),
            self.env_info.len(),
            encode(self.env_info.clone())
        );
        enc_push_if_non_empty!(
            Cells::get_table_name(),
            self.cells.len(),
            encode(self.cells.clone())
        );
        enc_push_if_non_empty!(
            AirBase::get_table_name(),
            self.airbase.len(),
            encode(self.airbase.clone())
        );
        enc_push_if_non_empty!(
            PlaneInfo::get_table_name(),
            self.plane_info.len(),
            encode(self.plane_info.clone())
        );
        enc_push_if_non_empty!(
            OwnSlotItem::get_table_name(),
            self.own_slotitem.len(),
            encode(self.own_slotitem.clone())
        );
        enc_push_if_non_empty!(
            EnemySlotItem::get_table_name(),
            self.enemy_slotitem.len(),
            encode(self.enemy_slotitem.clone())
        );
        enc_push_if_non_empty!(
            FriendSlotItem::get_table_name(),
            self.friend_slotitem.len(),
            encode(self.friend_slotitem.clone())
        );
        enc_push_if_non_empty!(
            OwnShip::get_table_name(),
            self.own_ship.len(),
            encode(self.own_ship.clone())
        );
        enc_push_if_non_empty!(
            EnemyShip::get_table_name(),
            self.enemy_ship.len(),
            encode(self.enemy_ship.clone())
        );
        enc_push_if_non_empty!(
            FriendShip::get_table_name(),
            self.friend_ship.len(),
            encode(self.friend_ship.clone())
        );
        enc_push_if_non_empty!(
            OwnDeck::get_table_name(),
            self.own_deck.len(),
            encode(self.own_deck.clone())
        );
        enc_push_if_non_empty!(
            SupportDeck::get_table_name(),
            self.support_deck.len(),
            encode(self.support_deck.clone())
        );
        enc_push_if_non_empty!(
            EnemyDeck::get_table_name(),
            self.enemy_deck.len(),
            encode(self.enemy_deck.clone())
        );
        enc_push_if_non_empty!(
            FriendDeck::get_table_name(),
            self.friend_deck.len(),
            encode(self.friend_deck.clone())
        );
        enc_push_if_non_empty!(
            AirBaseAirAttack::get_table_name(),
            self.airbase_airattack.len(),
            encode(self.airbase_airattack.clone())
        );
        enc_push_if_non_empty!(
            AirBaseAirAttackList::get_table_name(),
            self.airbase_airattack_list.len(),
            encode(self.airbase_airattack_list.clone())
        );
        enc_push_if_non_empty!(
            AirBaseAssult::get_table_name(),
            self.airbase_assult.len(),
            encode(self.airbase_assult.clone())
        );
        enc_push_if_non_empty!(
            CarrierBaseAssault::get_table_name(),
            self.carrierbase_assault.len(),
            encode(self.carrierbase_assault.clone())
        );
        enc_push_if_non_empty!(
            ClosingRaigeki::get_table_name(),
            self.closing_raigeki.len(),
            encode(self.closing_raigeki.clone())
        );
        enc_push_if_non_empty!(
            FriendlySupportHourai::get_table_name(),
            self.friendly_support_hourai.len(),
            encode(self.friendly_support_hourai.clone())
        );
        enc_push_if_non_empty!(
            FriendlySupportHouraiList::get_table_name(),
            self.friendly_support_hourai_list.len(),
            encode(self.friendly_support_hourai_list.clone())
        );
        enc_push_if_non_empty!(
            Hougeki::get_table_name(),
            self.hougeki.len(),
            encode(self.hougeki.clone())
        );
        enc_push_if_non_empty!(
            HougekiList::get_table_name(),
            self.hougeki_list.len(),
            encode(self.hougeki_list.clone())
        );
        enc_push_if_non_empty!(
            MidnightHougeki::get_table_name(),
            self.midnight_hougeki.len(),
            encode(self.midnight_hougeki.clone())
        );
        enc_push_if_non_empty!(
            MidnightHougekiList::get_table_name(),
            self.midnight_hougeki_list.len(),
            encode(self.midnight_hougeki_list.clone())
        );
        enc_push_if_non_empty!(
            OpeningAirAttack::get_table_name(),
            self.opening_airattack.len(),
            encode(self.opening_airattack.clone())
        );
        enc_push_if_non_empty!(
            OpeningAirAttackList::get_table_name(),
            self.opening_airattack_list.len(),
            encode(self.opening_airattack_list.clone())
        );
        enc_push_if_non_empty!(
            OpeningRaigeki::get_table_name(),
            self.opening_raigeki.len(),
            encode(self.opening_raigeki.clone())
        );
        enc_push_if_non_empty!(
            OpeningTaisen::get_table_name(),
            self.opening_taisen.len(),
            encode(self.opening_taisen.clone())
        );
        enc_push_if_non_empty!(
            OpeningTaisenList::get_table_name(),
            self.opening_taisen_list.len(),
            encode(self.opening_taisen_list.clone())
        );
        enc_push_if_non_empty!(
            SupportAirattack::get_table_name(),
            self.support_airattack.len(),
            encode(self.support_airattack.clone())
        );
        enc_push_if_non_empty!(
            SupportHourai::get_table_name(),
            self.support_hourai.len(),
            encode(self.support_hourai.clone())
        );
        enc_push_if_non_empty!(
            Battle::get_table_name(),
            self.battle.len(),
            encode(self.battle.clone())
        );

        Ok(tables)
    }
}

// pub struct RequireInfoTable {
//     pub slotitem: Vec<OwnSlotItem>,
// }

#[derive(Debug, Clone, Default, FieldSizeChecker)]
pub struct GetDataTable {
    pub mst_ship: Vec<MstShip>,
    pub mst_slot_item: Vec<MstSlotItem>,
    pub mst_equip_exslot_ship: Vec<MstEquipExslotShip>,
    pub mst_equip_exslot: Vec<MstEquipExslot>,
    pub mst_equip_limit_exslot: Vec<MstEquipLimitExslot>,
    pub mst_slot_item_equip_type: Vec<MstSlotItemEquipType>,
    pub mst_equip_ship: Vec<MstEquipShip>,
    pub mst_stype: Vec<MstStype>,
    pub mst_use_item: Vec<MstUseItem>,
    pub mst_map_area: Vec<MstMapArea>,
    pub mst_map_info: Vec<MstMapInfo>,
    pub mst_ship_graph: Vec<MstShipGraph>,
    pub mst_ship_upgrade: Vec<MstShipUpgrade>,
}
#[derive(Debug, Clone, Default)]
pub struct GetDataTableEncode {
    pub mst_ship: Vec<u8>,
    pub mst_slot_item: Vec<u8>,
    pub mst_equip_exslot_ship: Vec<u8>,
    pub mst_equip_exslot: Vec<u8>,
    pub mst_equip_limit_exslot: Vec<u8>,
    pub mst_slot_item_equip_type: Vec<u8>,
    pub mst_equip_ship: Vec<u8>,
    pub mst_stype: Vec<u8>,
    pub mst_use_item: Vec<u8>,
    pub mst_map_area: Vec<u8>,
    pub mst_map_info: Vec<u8>,
    pub mst_ship_graph: Vec<u8>,
    pub mst_ship_upgrade: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum GetDataTableEnum {
    MstShip,
    MstSlotItem,
    MstEquipExslotShip,
    MstEquipExslot,
    MstEquipLimitExslot,
    MstSlotItemEquipType,
    MstEquipShip,
    MstStype,
    MstUseItem,
    MstMapArea,
    MstMapInfo,
    MstShipGraph,
    MstShipUpgrade,
}

pub static GET_DATA_TABLE_NAMES: std::sync::LazyLock<Vec<String>> =
    std::sync::LazyLock::new(|| {
        vec![
            MstShip::get_table_name(),
            MstSlotItem::get_table_name(),
            MstEquipExslotShip::get_table_name(),
            MstEquipExslot::get_table_name(),
            MstEquipLimitExslot::get_table_name(),
            MstSlotItemEquipType::get_table_name(),
            MstEquipShip::get_table_name(),
            MstStype::get_table_name(),
            MstUseItem::get_table_name(),
            MstMapArea::get_table_name(),
            MstMapInfo::get_table_name(),
            MstShipGraph::get_table_name(),
            MstShipUpgrade::get_table_name(),
        ]
    });

impl FromStr for GetDataTableEnum {
    type Err = ();

    fn from_str(input: &str) -> Result<GetDataTableEnum, Self::Err> {
        match input.to_string() {
            x if x == MstShip::get_table_name() => Ok(GetDataTableEnum::MstShip),
            x if x == MstSlotItem::get_table_name() => Ok(GetDataTableEnum::MstSlotItem),
            x if x == MstEquipExslotShip::get_table_name() => {
                Ok(GetDataTableEnum::MstEquipExslotShip)
            }
            x if x == MstEquipExslot::get_table_name() => Ok(GetDataTableEnum::MstEquipExslot),
            x if x == MstEquipLimitExslot::get_table_name() => {
                Ok(GetDataTableEnum::MstEquipLimitExslot)
            }
            x if x == MstSlotItemEquipType::get_table_name() => {
                Ok(GetDataTableEnum::MstSlotItemEquipType)
            }
            x if x == MstEquipShip::get_table_name() => Ok(GetDataTableEnum::MstEquipShip),
            x if x == MstStype::get_table_name() => Ok(GetDataTableEnum::MstStype),
            x if x == MstUseItem::get_table_name() => Ok(GetDataTableEnum::MstUseItem),
            x if x == MstMapArea::get_table_name() => Ok(GetDataTableEnum::MstMapArea),
            x if x == MstMapInfo::get_table_name() => Ok(GetDataTableEnum::MstMapInfo),
            x if x == MstShipGraph::get_table_name() => Ok(GetDataTableEnum::MstShipGraph),
            x if x == MstShipUpgrade::get_table_name() => Ok(GetDataTableEnum::MstShipUpgrade),
            _ => Err(()),
        }
    }
}

impl GetDataTable {
    pub fn new() -> GetDataTable {
        let mst_ship = MstShips::load().mst_ships.values().cloned().collect();
        let mst_slot_item = MstSlotItems::load()
            .mst_slot_items
            .values()
            .cloned()
            .collect();
        let mst_equip_exslot_ship = MstEquipExslotShips::load()
            .mst_equip_ships
            .values()
            .cloned()
            .collect();
        let mst_equip_exslot = MstEquipExslots::load()
            .mst_equip_exslots
            .values()
            .cloned()
            .collect();
        let mst_equip_limit_exslot = MstEquipLimitExslots::load()
            .mst_equip_limit_exslots
            .values()
            .cloned()
            .collect();
        let mst_slot_item_equip_type = MstSlotItemEquipTypes::load()
            .mst_slotitem_equip_types
            .values()
            .cloned()
            .collect();
        let mst_equip_ship = MstEquipShips::load()
            .mst_equip_ships
            .values()
            .cloned()
            .collect();
        let mst_stype = MstStypes::load().mst_stypes.values().cloned().collect();
        let mst_use_item = MstUseItems::load()
            .mst_use_items
            .values()
            .cloned()
            .collect();
        let mst_ship_graph = MstShipGraphs::load()
            .mst_ship_graphs
            .values()
            .cloned()
            .collect();
        let mst_map_area = MstMapAreas::load()
            .mst_map_areas
            .values()
            .cloned()
            .collect();
        let mst_map_info = MstMapInfos::load()
            .mst_map_infos
            .values()
            .cloned()
            .collect();
        let mst_ship_upgrade = MstShipUpgrades::load()
            .mst_ship_upgrades
            .values()
            .cloned()
            .collect();

        GetDataTable {
            mst_ship,
            mst_slot_item,
            mst_equip_exslot_ship,
            mst_equip_exslot,
            mst_equip_limit_exslot,
            mst_slot_item_equip_type,
            mst_equip_ship,
            mst_stype,
            mst_use_item,
            mst_map_area,
            mst_map_info,
            mst_ship_graph,
            mst_ship_upgrade,
        }
    }

    pub fn encode(&self) -> Result<GetDataTableEncode, apache_avro::Error> {
        let mst_ship = encode(self.mst_ship.clone())?;
        let mst_slot_item = encode(self.mst_slot_item.clone())?;
        let mst_equip_exslot_ship = encode(self.mst_equip_exslot_ship.clone())?;
        let mst_equip_exslot = encode(self.mst_equip_exslot.clone())?;
        let mst_equip_limit_exslot = encode(self.mst_equip_limit_exslot.clone())?;
        let mst_slot_item_equip_type = encode(self.mst_slot_item_equip_type.clone())?;
        let mst_equip_ship = encode(self.mst_equip_ship.clone())?;
        let mst_stype = encode(self.mst_stype.clone())?;
        let mst_use_item = encode(self.mst_use_item.clone())?;
        let mst_map_area = encode(self.mst_map_area.clone())?;
        let mst_ship_graph = encode(self.mst_ship_graph.clone())?;
        let mst_map_info = encode(self.mst_map_info.clone())?;
        let mst_ship_upgrade = encode(self.mst_ship_upgrade.clone())?;

        let table_encode = GetDataTableEncode {
            mst_ship,
            mst_slot_item,
            mst_equip_exslot_ship,
            mst_equip_exslot,
            mst_equip_limit_exslot,
            mst_slot_item_equip_type,
            mst_equip_ship,
            mst_stype,
            mst_use_item,
            mst_ship_graph,
            mst_map_area,
            mst_map_info,
            mst_ship_upgrade,
        };
        Ok(table_encode)
    }
}
