use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize, Serializer};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_EQUIP_SHIP: Lazy<Mutex<MstEquipShips>> = Lazy::new(|| {
    Mutex::new(MstEquipShips {
        mst_equip_ships: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipShips {
    pub mst_equip_ships: HashMap<i32, MstEquipShip>,
}

#[cfg(not(feature = "20250627"))]
#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipShip {
    pub ship_id: i32,
    pub equip_type: Vec<i32>,
}

#[cfg(feature = "20250627")]
#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipShip {
    pub ship_id: i32,
    #[serde(serialize_with = "serialize_sorted_string_option_vec_map")]
    pub equip_type: HashMap<String, Option<Vec<i32>>>,
}

#[cfg(feature = "20250627")]
fn serialize_sorted_string_option_vec_map<S>(
    value: &HashMap<String, Option<Vec<i32>>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let ordered: std::collections::BTreeMap<&str, &Option<Vec<i32>>> =
        value.iter().map(|(k, v)| (k.as_str(), v)).collect();
    ordered.serialize(serializer)
}

impl MstEquipShips {
    pub fn load() -> Self {
        let equip_ship_map = KCS_MST_EQUIP_SHIP.lock().unwrap();
        equip_ship_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_ship_map = KCS_MST_EQUIP_SHIP.lock().unwrap();
        *equip_ship_map = self.clone();
    }
}

#[cfg(all(test, feature = "20250627"))]
mod tests {
    use super::MstEquipShip;
    use std::collections::HashMap;

    #[test]
    fn serialize_is_deterministic_for_equip_type_map() {
        let mut equip_type_a = HashMap::new();
        equip_type_a.insert("b".to_string(), Some(vec![2, 3]));
        equip_type_a.insert("a".to_string(), Some(vec![1]));

        let mut equip_type_b = HashMap::new();
        equip_type_b.insert("a".to_string(), Some(vec![1]));
        equip_type_b.insert("b".to_string(), Some(vec![2, 3]));

        let a = MstEquipShip {
            ship_id: 1,
            equip_type: equip_type_a,
        };
        let b = MstEquipShip {
            ship_id: 1,
            equip_type: equip_type_b,
        };

        let json_a = serde_json::to_string(&a).expect("serialize a");
        let json_b = serde_json::to_string(&b).expect("serialize b");
        assert_eq!(json_a, json_b);
    }
}
