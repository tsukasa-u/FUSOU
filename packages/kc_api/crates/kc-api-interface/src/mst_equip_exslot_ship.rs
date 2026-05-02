use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize, Serializer};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_EQUIP_EXSLOT_SHIP: Lazy<Mutex<MstEquipExslotShips>> = Lazy::new(|| {
    Mutex::new(MstEquipExslotShips {
        mst_equip_ships: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipExslotShips {
    pub mst_equip_ships: HashMap<String, MstEquipExslotShip>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipExslotShip {
    pub slotitem_id: i32,
    #[serde(serialize_with = "serialize_sorted_optional_string_i32_map")]
    pub ship_ids: Option<HashMap<String, i32>>,
    #[serde(serialize_with = "serialize_sorted_optional_string_i32_map")]
    pub stypes: Option<HashMap<String, i32>>,
    #[serde(serialize_with = "serialize_sorted_optional_string_i32_map")]
    pub ctypes: Option<HashMap<String, i32>>,
    pub req_level: i32,
}

fn serialize_sorted_optional_string_i32_map<S>(
    value: &Option<HashMap<String, i32>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(map) => {
            let ordered: std::collections::BTreeMap<&str, &i32> =
                map.iter().map(|(k, v)| (k.as_str(), v)).collect();
            ordered.serialize(serializer)
        }
        None => serializer.serialize_none(),
    }
}

impl MstEquipExslotShips {
    pub fn load() -> Self {
        let equip_ship_map = KCS_MST_EQUIP_EXSLOT_SHIP.lock().unwrap();
        equip_ship_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_ship_map = KCS_MST_EQUIP_EXSLOT_SHIP.lock().unwrap();
        *equip_ship_map = self.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::MstEquipExslotShip;
    use std::collections::HashMap;

    #[test]
    fn serialize_is_deterministic_for_optional_maps() {
        let mut ship_ids_a = HashMap::new();
        ship_ids_a.insert("b".to_string(), 2);
        ship_ids_a.insert("a".to_string(), 1);

        let mut ship_ids_b = HashMap::new();
        ship_ids_b.insert("a".to_string(), 1);
        ship_ids_b.insert("b".to_string(), 2);

        let a = MstEquipExslotShip {
            slotitem_id: 10,
            ship_ids: Some(ship_ids_a),
            stypes: None,
            ctypes: None,
            req_level: 0,
        };
        let b = MstEquipExslotShip {
            slotitem_id: 10,
            ship_ids: Some(ship_ids_b),
            stypes: None,
            ctypes: None,
            req_level: 0,
        };

        let json_a = serde_json::to_string(&a).expect("serialize a");
        let json_b = serde_json::to_string(&b).expect("serialize b");
        assert_eq!(json_a, json_b);
    }
}
