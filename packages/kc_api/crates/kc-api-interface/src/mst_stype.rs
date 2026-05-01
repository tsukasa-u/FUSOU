use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize, Serializer};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_STYPES: Lazy<Mutex<MstStypes>> = Lazy::new(|| {
    Mutex::new(MstStypes {
        mst_stypes: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstStypes {
    pub mst_stypes: HashMap<i32, MstStype>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstStype {
    pub id: i32,
    pub sortno: i32,
    pub name: String,
    #[serde(serialize_with = "serialize_sorted_string_i32_map")]
    pub equip_type: HashMap<String, i32>,
}

fn serialize_sorted_string_i32_map<S>(
    value: &HashMap<String, i32>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    let ordered: std::collections::BTreeMap<&str, &i32> =
        value.iter().map(|(k, v)| (k.as_str(), v)).collect();
    ordered.serialize(serializer)
}

impl MstStypes {
    pub fn load() -> Self {
        let stype_map = KCS_MST_STYPES.lock().unwrap();
        stype_map.clone()
    }

    pub fn restore(&self) {
        let mut stype_map = KCS_MST_STYPES.lock().unwrap();
        *stype_map = self.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::MstStype;
    use std::collections::HashMap;

    #[test]
    fn serialize_is_deterministic_for_equip_type_map() {
        let mut equip_type_a = HashMap::new();
        equip_type_a.insert("2".to_string(), 20);
        equip_type_a.insert("1".to_string(), 10);

        let mut equip_type_b = HashMap::new();
        equip_type_b.insert("1".to_string(), 10);
        equip_type_b.insert("2".to_string(), 20);

        let a = MstStype {
            id: 1,
            sortno: 1,
            name: "test".to_string(),
            equip_type: equip_type_a,
        };
        let b = MstStype {
            id: 1,
            sortno: 1,
            name: "test".to_string(),
            equip_type: equip_type_b,
        };

        let json_a = serde_json::to_string(&a).expect("serialize a");
        let json_b = serde_json::to_string(&b).expect("serialize b");
        assert_eq!(json_a, json_b);
    }
}
