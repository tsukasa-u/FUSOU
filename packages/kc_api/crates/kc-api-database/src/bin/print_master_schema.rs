use apache_avro::AvroSchema;
use kc_api_database::DATABASE_TABLE_VERSION;
use kc_api_interface::mst_equip_exslot::MstEquipExslot;
use kc_api_interface::mst_equip_exslot_ship::MstEquipExslotShip;
use kc_api_interface::mst_equip_limit_exslot::MstEquipLimitExslot;
use kc_api_interface::mst_equip_ship::MstEquipShip;
use kc_api_interface::mst_maparea::MstMapArea;
use kc_api_interface::mst_mapinfo::MstMapInfo;
use kc_api_interface::mst_ship::MstShip;
use kc_api_interface::mst_ship_graph::MstShipGraph;
use kc_api_interface::mst_ship_upgrade::MstShipUpgrade;
use kc_api_interface::mst_slot_item::MstSlotItem;
use kc_api_interface::mst_slot_item_equip_type::MstSlotItemEquipType;
use kc_api_interface::mst_stype::MstStype;
use kc_api_interface::mst_use_item::MstUseItem;
use serde_json::json;

fn get_schema_json<T: AvroSchema>(name: &str) -> serde_json::Value {
    let schema = T::get_schema();
    let schema_str = serde_json::to_string(&schema).expect("Failed to serialize schema");

    json!({
        "table_name": name,
        "schema": schema_str
    })
}

fn main() {
    let schemas = vec![
        get_schema_json::<MstShip>(&MstShip::get_table_name()),
        get_schema_json::<MstSlotItem>(&MstSlotItem::get_table_name()),
        get_schema_json::<MstEquipExslotShip>(&MstEquipExslotShip::get_table_name()),
        get_schema_json::<MstEquipExslot>(&MstEquipExslot::get_table_name()),
        get_schema_json::<MstEquipLimitExslot>(&MstEquipLimitExslot::get_table_name()),
        get_schema_json::<MstSlotItemEquipType>(&MstSlotItemEquipType::get_table_name()),
        get_schema_json::<MstEquipShip>(&MstEquipShip::get_table_name()),
        get_schema_json::<MstStype>(&MstStype::get_table_name()),
        get_schema_json::<MstUseItem>(&MstUseItem::get_table_name()),
        get_schema_json::<MstMapArea>(&MstMapArea::get_table_name()),
        get_schema_json::<MstMapInfo>(&MstMapInfo::get_table_name()),
        get_schema_json::<MstShipGraph>(&MstShipGraph::get_table_name()),
        get_schema_json::<MstShipUpgrade>(&MstShipUpgrade::get_table_name()),
    ];

    let output = json!({
        "table_version": DATABASE_TABLE_VERSION,
        "schemas": schemas
    });

    println!("{}", serde_json::to_string_pretty(&output).unwrap());
}
