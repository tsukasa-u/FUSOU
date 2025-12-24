use apache_avro::AvroSchema;
use kc_api_database::models::battle::{Hougeki, HougekiList, MidnightHougeki, MidnightHougekiList, OpeningTaisen, OpeningTaisenList, ClosingRaigeki};
use kc_api_database::models::env_info::EnvInfoId;
use kc_api_database::models::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use kc_api_database::models::airbase::{AirBase};

fn print_schema<T: AvroSchema>(name: &str) {
    let schema = T::get_schema();
    println!("=== {} ===", name);
    println!("{}", schema.canonical_form());
}

fn main() {
    // Battle-related primary records
    print_schema::<HougekiList>("HougekiList");
    print_schema::<Hougeki>("Hougeki");
    print_schema::<MidnightHougekiList>("MidnightHougekiList");
    print_schema::<MidnightHougeki>("MidnightHougeki");
    print_schema::<OpeningTaisenList>("OpeningTaisenList");
    print_schema::<OpeningTaisen>("OpeningTaisen");
    print_schema::<ClosingRaigeki>("ClosingRaigeki");

    // Deck and AirBase (if needed later)
    print_schema::<EnemyDeck>("EnemyDeck");
    print_schema::<FriendDeck>("FriendDeck");
    print_schema::<OwnDeck>("OwnDeck");
    print_schema::<SupportDeck>("SupportDeck");
    print_schema::<AirBase>("AirBase");
}
