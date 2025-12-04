// Common integration logic for port table data

use kc_api::database::integrate::integrate;
use kc_api::database::models::airbase::{AirBase, PlaneInfo};
use kc_api::database::models::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle, CarrierBaseAssault,
    ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList,
    MidnightHougeki, MidnightHougekiList, OpeningAirAttack, OpeningAirAttackList, OpeningRaigeki,
    OpeningTaisen, OpeningTaisenList, SupportAirattack, SupportHourai,
};
use kc_api::database::models::cell::Cells;
use kc_api::database::models::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use kc_api::database::models::env_info::EnvInfo;
use kc_api::database::models::ship::{EnemyShip, FriendShip, OwnShip};
use kc_api::database::models::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};
use kc_api::database::table::PortTableEnum;

/// Integrate multiple port table files by table name
/// Returns the integrated bytes or an error
pub fn integrate_by_table_name(
    table_name: &str,
    file_contents: Vec<Vec<u8>>,
) -> Result<Vec<u8>, String> {
    let table_enum = table_name.parse::<PortTableEnum>()
        .map_err(|_| format!("Invalid table name: {}", table_name))?;
    
    match table_enum {
        PortTableEnum::EnvInfo => integrate::<EnvInfo>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::Cells => integrate::<Cells>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::AirBase => integrate::<AirBase>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::PlaneInfo => integrate::<PlaneInfo>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OwnSlotItem => integrate::<OwnSlotItem>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::EnemySlotItem => integrate::<EnemySlotItem>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::FriendSlotItem => integrate::<FriendSlotItem>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OwnShip => integrate::<OwnShip>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::EnemyShip => integrate::<EnemyShip>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::FriendShip => integrate::<FriendShip>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OwnDeck => integrate::<OwnDeck>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::SupportDeck => integrate::<SupportDeck>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::EnemyDeck => integrate::<EnemyDeck>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::FriendDeck => integrate::<FriendDeck>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::AirBaseAirAttack => integrate::<AirBaseAirAttack>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::AirBaseAirAttackList => integrate::<AirBaseAirAttackList>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::AirBaseAssult => integrate::<AirBaseAssult>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::CarrierBaseAssault => integrate::<CarrierBaseAssault>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::ClosingRaigeki => integrate::<ClosingRaigeki>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::FriendlySupportHourai => integrate::<FriendlySupportHourai>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::FriendlySupportHouraiList => integrate::<FriendlySupportHouraiList>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::Hougeki => integrate::<Hougeki>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::HougekiList => integrate::<HougekiList>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::MidnightHougeki => integrate::<MidnightHougeki>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::MidnightHougekiList => integrate::<MidnightHougekiList>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OpeningAirAttack => integrate::<OpeningAirAttack>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OpeningAirAttackList => integrate::<OpeningAirAttackList>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OpeningRaigeki => integrate::<OpeningRaigeki>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OpeningTaisen => integrate::<OpeningTaisen>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::OpeningTaisenList => integrate::<OpeningTaisenList>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::SupportAirattack => integrate::<SupportAirattack>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::SupportHourai => integrate::<SupportHourai>(file_contents).map_err(|e| e.to_string()),
        PortTableEnum::Battle => integrate::<Battle>(file_contents).map_err(|e| e.to_string()),
    }
}
