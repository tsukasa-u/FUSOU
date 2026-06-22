use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::ser::SerializeStruct;
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

#[derive(Debug, Clone, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstStype {
    pub id: i32,
    pub sortno: i32,
    pub name: String,
    pub equip_type: HashMap<String, i32>,
}

fn sorted_string_i32_map(value: &HashMap<String, i32>) -> std::collections::BTreeMap<&str, i32> {
    let ordered: std::collections::BTreeMap<&str, &i32> =
        value.iter().map(|(k, v)| (k.as_str(), v)).collect();
    ordered.into_iter().map(|(k, v)| (k, *v)).collect()
}

impl Serialize for MstStype {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("MstStype", 4)?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("sortno", &self.sortno)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("equip_type", &sorted_string_i32_map(&self.equip_type))?;
        state.end()
    }
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
