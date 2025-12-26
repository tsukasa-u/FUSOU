use apache_avro::AvroSchema;
use kc_api_database::models::airbase::{AirBase, PlaneInfo};
use kc_api_database::models::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle,
    CarrierBaseAssault, ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList,
    Hougeki, HougekiList, MidnightHougeki, MidnightHougekiList, OpeningAirAttack,
    OpeningAirAttackList, OpeningRaigeki, OpeningTaisen, OpeningTaisenList, SupportAirattack,
    SupportHourai,
};
use kc_api_database::models::cell::Cells;
use kc_api_database::models::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use kc_api_database::models::env_info::EnvInfo;
use kc_api_database::models::ship::{EnemyShip, FriendShip, OwnShip};
use kc_api_database::models::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};
use kc_api_database::DATABASE_TABLE_VERSION;
use serde_json::json;

fn get_schema_json<T: AvroSchema>(name: &str) -> serde_json::Value {
    let schema = T::get_schema();
    let canonical = schema.canonical_form();
    json!({
        "table_name": name,
        "schema": canonical
    })
}

fn main() {
    let mut schemas = vec![];

    // Core tables
    schemas.push(get_schema_json::<EnvInfo>("env_info"));
    schemas.push(get_schema_json::<Cells>("cells"));

    // AirBase and PlaneInfo
    schemas.push(get_schema_json::<AirBase>("airbase"));
    schemas.push(get_schema_json::<PlaneInfo>("plane_info"));

    // SlotItems
    schemas.push(get_schema_json::<OwnSlotItem>("own_slotitem"));
    schemas.push(get_schema_json::<EnemySlotItem>("enemy_slotitem"));
    schemas.push(get_schema_json::<FriendSlotItem>("friend_slotitem"));

    // Ships
    schemas.push(get_schema_json::<OwnShip>("own_ship"));
    schemas.push(get_schema_json::<EnemyShip>("enemy_ship"));
    schemas.push(get_schema_json::<FriendShip>("friend_ship"));

    // Decks
    schemas.push(get_schema_json::<OwnDeck>("own_deck"));
    schemas.push(get_schema_json::<SupportDeck>("support_deck"));
    schemas.push(get_schema_json::<EnemyDeck>("enemy_deck"));
    schemas.push(get_schema_json::<FriendDeck>("friend_deck"));

    // Battle components
    schemas.push(get_schema_json::<AirBaseAirAttack>("airbase_airattack"));
    schemas.push(get_schema_json::<AirBaseAirAttackList>("airbase_airattack_list"));
    schemas.push(get_schema_json::<AirBaseAssult>("airbase_assult"));
    schemas.push(get_schema_json::<CarrierBaseAssault>("carrierbase_assault"));
    schemas.push(get_schema_json::<ClosingRaigeki>("closing_raigeki"));
    schemas.push(get_schema_json::<FriendlySupportHourai>("friendly_support_hourai"));
    schemas.push(get_schema_json::<FriendlySupportHouraiList>("friendly_support_hourai_list"));
    schemas.push(get_schema_json::<Hougeki>("hougeki"));
    schemas.push(get_schema_json::<HougekiList>("hougeki_list"));
    schemas.push(get_schema_json::<MidnightHougeki>("midnight_hougeki"));
    schemas.push(get_schema_json::<MidnightHougekiList>("midnight_hougeki_list"));
    schemas.push(get_schema_json::<OpeningAirAttack>("opening_airattack"));
    schemas.push(get_schema_json::<OpeningAirAttackList>("opening_airattack_list"));
    schemas.push(get_schema_json::<OpeningRaigeki>("opening_raigeki"));
    schemas.push(get_schema_json::<OpeningTaisen>("opening_taisen"));
    schemas.push(get_schema_json::<OpeningTaisenList>("opening_taisen_list"));
    schemas.push(get_schema_json::<SupportAirattack>("support_airattack"));
    schemas.push(get_schema_json::<SupportHourai>("support_hourai"));
    schemas.push(get_schema_json::<Battle>("battle"));

    // Output as JSON with table_version metadata
    let output = json!({
        "table_version": DATABASE_TABLE_VERSION,
        "schemas": schemas
    });
    println!("{}", serde_json::to_string_pretty(&output).unwrap());
}
