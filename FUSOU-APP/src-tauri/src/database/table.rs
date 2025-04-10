use apache_avro::{AvroSchema, Codec, Writer};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::airbase::{AirBase, PlaneInfo};
use crate::database::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, CarrierBaseAssault, ClosingRaigeki,
    FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList, MidnightHougeki,
    MidnightHougekiList, OpeningAirAttack, OpeningRaigeki, OpeningTaisen, OpeningTaisenList,
    SupportAiratack, SupportHourai,
};
use crate::database::cell::Cells;
use crate::database::deck::{EnemyDeck, FriendDeck, OwnDeck};
use crate::database::ship::{EnemyShip, FriendShip, OwnShip};
use crate::database::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};

#[derive(Debug, Clone, Default)]
pub struct Table {
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
    pub opening_raigeki: Vec<OpeningRaigeki>,
    pub opening_taisen: Vec<OpeningTaisen>,
    pub opening_taisen_list: Vec<OpeningTaisenList>,
    pub support_airatack: Vec<SupportAiratack>,
    pub support_hourai: Vec<SupportHourai>,
}
