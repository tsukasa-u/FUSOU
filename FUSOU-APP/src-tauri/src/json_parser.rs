use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use serde::{Serialize, Deserialize};
use serde_json::Value;


#[derive(Serialize, Deserialize)]
struct Test {
    id: String,
    username: String,

    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

fn check_updated(json_str: String) -> (bool, String) {
    let mut updated = false;
    let mut message = String::new();
    let mut file = File::open("src-tauri/src/data.json").unwrap();
    let mut data = String::new();
    file.read_to_string(&mut data).unwrap();
    let mut json: Value = serde_json::from_str(&data).unwrap();
    let mut last_updated = json["last_updated"].as_str().unwrap();
    let mut last_updated = last_updated.parse::<DateTime<Utc>>().unwrap();
    let mut now = Utc::now();
    let mut diff = now.signed_duration_since(last_updated);
    if diff.num_days() > 0 {
        updated = true;
        message = format!("Data is {} days old", diff.num_days());
    }
    (updated, message)
}

fn main() {

}