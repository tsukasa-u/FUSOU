// Common logic for resolving table data from encoded tables

use kc_api::database::table::{GetDataTableEncode, GetDataTableEnum, PortTableEncode, PortTableEnum, GET_DATA_TABLE_NAMES, PORT_TABLE_NAMES};

/// Iterator over all get_data tables with their names and byte contents
pub struct GetDataTableIterator<'a> {
    table: &'a GetDataTableEncode,
    names: std::slice::Iter<'a, String>,
}

impl<'a> GetDataTableIterator<'a> {
    pub fn new(table: &'a GetDataTableEncode) -> Self {
        Self {
            table,
            names: GET_DATA_TABLE_NAMES.iter(),
        }
    }
}

impl<'a> Iterator for GetDataTableIterator<'a> {
    type Item = (&'a str, &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        while let Some(table_name) = self.names.next() {
            if let Some(bytes) = resolve_get_data_bytes(self.table, table_name) {
                return Some((table_name.as_str(), bytes));
            }
        }
        None
    }
}

/// Iterator over all port tables with their names and byte contents
pub struct PortTableIterator<'a> {
    table: &'a PortTableEncode,
    names: std::slice::Iter<'a, String>,
}

impl<'a> PortTableIterator<'a> {
    pub fn new(table: &'a PortTableEncode) -> Self {
        Self {
            table,
            names: PORT_TABLE_NAMES.iter(),
        }
    }
}

impl<'a> Iterator for PortTableIterator<'a> {
    type Item = (&'a str, &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        while let Some(table_name) = self.names.next() {
            if let Some(bytes) = resolve_port_table_bytes(self.table, table_name) {
                return Some((table_name.as_str(), bytes));
            }
        }
        None
    }
}

/// Get an iterator over all get_data tables
pub fn get_all_get_data_tables(table: &GetDataTableEncode) -> GetDataTableIterator<'_> {
    GetDataTableIterator::new(table)
}

/// Get an iterator over all port tables
pub fn get_all_port_tables(table: &PortTableEncode) -> PortTableIterator<'_> {
    PortTableIterator::new(table)
}

/// Resolve byte content for a specific get_data table by name
pub fn resolve_get_data_bytes<'a>(
    table: &'a GetDataTableEncode,
    table_name: &str,
) -> Option<&'a [u8]> {
    let variant = table_name.parse::<GetDataTableEnum>().ok()?;
    let bytes = match variant {
        GetDataTableEnum::MstShip => &table.mst_ship,
        GetDataTableEnum::MstSlotItem => &table.mst_slot_item,
        GetDataTableEnum::MstEquipExslotShip => &table.mst_equip_exslot_ship,
        GetDataTableEnum::MstEquipExslot => &table.mst_equip_exslot,
        GetDataTableEnum::MstEquipLimitExslot => &table.mst_equip_limit_exslot,
        GetDataTableEnum::MstSlotItemEquipType => &table.mst_slot_item_equip_type,
        GetDataTableEnum::MstEquipShip => &table.mst_equip_ship,
        GetDataTableEnum::MstStype => &table.mst_stype,
        GetDataTableEnum::MstUseItem => &table.mst_use_item,
        GetDataTableEnum::MstMapArea => &table.mst_map_area,
        GetDataTableEnum::MstMapInfo => &table.mst_map_info,
        GetDataTableEnum::MstShipGraph => &table.mst_ship_graph,
        GetDataTableEnum::MstShipUpgrade => &table.mst_ship_upgrade,
    };
    Some(bytes.as_slice())
}

/// Resolve byte content for a specific port table by name
pub fn resolve_port_table_bytes<'a>(
    table: &'a PortTableEncode,
    table_name: &str,
) -> Option<&'a [u8]> {
    let variant = table_name.parse::<PortTableEnum>().ok()?;
    let bytes = match variant {
        PortTableEnum::EnvInfo => &table.env_info,
        PortTableEnum::Cells => &table.cells,
        PortTableEnum::AirBase => &table.airbase,
        PortTableEnum::PlaneInfo => &table.plane_info,
        PortTableEnum::OwnSlotItem => &table.own_slotitem,
        PortTableEnum::EnemySlotItem => &table.enemy_slotitem,
        PortTableEnum::FriendSlotItem => &table.friend_slotitem,
        PortTableEnum::OwnShip => &table.own_ship,
        PortTableEnum::EnemyShip => &table.enemy_ship,
        PortTableEnum::FriendShip => &table.friend_ship,
        PortTableEnum::OwnDeck => &table.own_deck,
        PortTableEnum::SupportDeck => &table.support_deck,
        PortTableEnum::EnemyDeck => &table.enemy_deck,
        PortTableEnum::FriendDeck => &table.friend_deck,
        PortTableEnum::AirBaseAirAttack => &table.airbase_airattack,
        PortTableEnum::AirBaseAirAttackList => &table.airbase_airattack_list,
        PortTableEnum::AirBaseAssult => &table.airbase_assult,
        PortTableEnum::CarrierBaseAssault => &table.carrierbase_assault,
        PortTableEnum::ClosingRaigeki => &table.closing_raigeki,
        PortTableEnum::FriendlySupportHourai => &table.friendly_support_hourai,
        PortTableEnum::FriendlySupportHouraiList => &table.friendly_support_hourai_list,
        PortTableEnum::Hougeki => &table.hougeki,
        PortTableEnum::HougekiList => &table.hougeki_list,
        PortTableEnum::MidnightHougeki => &table.midnight_hougeki,
        PortTableEnum::MidnightHougekiList => &table.midnight_hougeki_list,
        PortTableEnum::OpeningAirAttack => &table.opening_airattack,
        PortTableEnum::OpeningAirAttackList => &table.opening_airattack_list,
        PortTableEnum::OpeningRaigeki => &table.opening_raigeki,
        PortTableEnum::OpeningTaisen => &table.opening_taisen,
        PortTableEnum::OpeningTaisenList => &table.opening_taisen_list,
        PortTableEnum::SupportAirattack => &table.support_airattack,
        PortTableEnum::SupportHourai => &table.support_hourai,
        PortTableEnum::Battle => &table.battle,
    };
    Some(bytes.as_slice())
}
