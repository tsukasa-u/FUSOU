// use dotenvy_macro::dotenv;

use std::str::FromStr;

use crate::models::airbase::{AirBase, PlaneInfo};
use crate::models::battle::{
    AirBaseAirAttack, AirBaseAirAttackList, AirBaseAssult, Battle, CarrierBaseAssault, ClosingRaigeki, FriendlySupportHourai, FriendlySupportHouraiList, Hougeki, HougekiList, MidnightHougeki, MidnightHougekiList, OpeningAirAttack, OpeningAirAttackList, OpeningRaigeki, OpeningTaisen, OpeningTaisenList, SupportAirattack, SupportHourai
};
#[cfg(feature = "schema_v0_5")]
use crate::models::battle::NightSupportHourai;
#[cfg(feature = "schema_v0_5")]
use crate::models::battle::BattleResult;

use crate::models::cell::Cells;
use crate::models::deck::{EnemyDeck, FriendDeck, OwnDeck, SupportDeck};
use crate::models::env_info::{EnvInfo, UserEnv};
use crate::models::ship::{EnemyShip, FriendShip, OwnShip};
use crate::models::slotitem::{EnemySlotItem, FriendSlotItem, OwnSlotItem};

use kc_api_interface::mst_equip_exslot::{MstEquipExslot, MstEquipExslots};
use kc_api_interface::mst_equip_exslot_ship::{MstEquipExslotShip, MstEquipExslotShips};
use kc_api_interface::mst_equip_limit_exslot::{MstEquipLimitExslot, MstEquipLimitExslots};
use kc_api_interface::mst_equip_ship::{MstEquipShip, MstEquipShips};
use kc_api_interface::mst_maparea::{MstMapArea, MstMapAreas};
use kc_api_interface::mst_mapinfo::{MstMapInfo, MstMapInfos};
use kc_api_interface::mst_ship::{MstShip, MstShips};
use kc_api_interface::mst_ship_graph::{MstShipGraph, MstShipGraphs};
use kc_api_interface::mst_ship_upgrade::{MstShipUpgrade, MstShipUpgrades};
use kc_api_interface::mst_slot_item::{MstSlotItem, MstSlotItems};
use kc_api_interface::mst_slot_item_equip_type::{MstSlotItemEquipType, MstSlotItemEquipTypes};
use kc_api_interface::mst_stype::{MstStype, MstStypes};
use kc_api_interface::mst_use_item::{MstUseItem, MstUseItems};

use register_trait::FieldSizeChecker;
use uuid::Uuid;

// Import DATABASE_TABLE_VERSION from schema_version module
pub use crate::schema_version::DATABASE_TABLE_VERSION;

/// Generic enum-keyed encode container shared by all table groups.
///
/// `*Encode` types in this module (e.g. `PortTableEncode`, `GetDataTableEncode`)
/// are type aliases over `TableEncode<K>`. Storing bytes keyed by a typed enum
/// (rather than as named `Vec<u8>` struct fields) eliminates the
/// "all-fields-have-the-same-type" footgun where a developer can silently swap
/// payloads between unrelated tables.
///
/// Iteration order follows the variant's `Ord` implementation, which is derived
/// in declaration order on each enum, giving deterministic, declaration-aligned
/// iteration without any extra bookkeeping.
#[derive(Debug, Clone)]
pub struct TableEncode<K: Copy + Ord + 'static> {
    entries: std::collections::BTreeMap<K, Vec<u8>>,
}

impl<K: Copy + Ord + 'static> Default for TableEncode<K> {
    fn default() -> Self {
        Self {
            entries: std::collections::BTreeMap::new(),
        }
    }
}

impl<K: Copy + Ord + 'static> TableEncode<K> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert encoded bytes for `variant`. Replaces any prior entry.
    pub fn insert(&mut self, variant: K, bytes: Vec<u8>) -> Option<Vec<u8>> {
        self.entries.insert(variant, bytes)
    }

    pub fn get(&self, variant: K) -> Option<&[u8]> {
        self.entries.get(&variant).map(|v| v.as_slice())
    }

    /// Convenience: returns an empty slice when `variant` is absent.
    /// Useful for upload payloads that must include all expected tables.
    pub fn get_or_empty(&self, variant: K) -> &[u8] {
        self.entries
            .get(&variant)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    pub fn contains(&self, variant: K) -> bool {
        self.entries.contains_key(&variant)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Iterate (variant, bytes) pairs in `K`'s `Ord` order (declaration order).
    pub fn iter(&self) -> impl Iterator<Item = (K, &[u8])> {
        self.entries.iter().map(|(k, v)| (*k, v.as_slice()))
    }
}

impl<K: Copy + Ord + 'static> From<Vec<(K, Vec<u8>)>> for TableEncode<K> {
    fn from(items: Vec<(K, Vec<u8>)>) -> Self {
        let mut encode = Self::new();
        for (variant, bytes) in items {
            encode.insert(variant, bytes);
        }
        encode
    }
}

/// Defines the entire port table schema from a single source list.
///
/// Entry format:
/// `Variant => field_name: RustType => getter_name => "table_name"`
///
/// What is generated from each entry:
/// - `PortTableEnum` variant (`Copy + Ord` so it works as a `BTreeMap` key)
/// - `PortTable` field (`Vec<RustType>`)
/// - `PortTableEnum::table_name()` arm
/// - `PortTable::record_count_for_variant` arm
/// - `PortTable::encode_for_variant` arm (clones the per-variant `Vec<RustType>`
///   and runs the avro encoder)
/// - type-level table-name getter (e.g. `Type::get_table_name()`)
///
/// `PortTableEncode` itself is a type alias over the enum-keyed
/// [`TableEncode`] so it cannot be field-mismatched.
///
/// For schema-specific entries, place `#[cfg(feature = "...")]` on the entry.
macro_rules! define_port_table_schema {
    (
        $(
            $(#[$meta:meta])*
            $variant:ident => $field:ident : $ty:ty => $getter:ident => $name:literal,
        )+
    ) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum PortTableEnum {
            $(
                $(#[$meta])*
                $variant,
            )+
        }

        impl PortTableEnum {
            pub const ALL: &'static [PortTableEnum] = &[
                $(
                    $(#[$meta])*
                    PortTableEnum::$variant,
                )+
            ];

            pub fn variants() -> &'static [PortTableEnum] {
                Self::ALL
            }

            pub const fn table_name(self) -> &'static str {
                match self {
                    $(
                        $(#[$meta])*
                        PortTableEnum::$variant => $name,
                    )+
                }
            }
        }

        #[derive(Debug, Clone, Default, FieldSizeChecker)]
        pub struct PortTable {
            $(
                $(#[$meta])*
                pub $field: Vec<$ty>,
            )+
        }

        impl PortTable {
            fn record_count_for_variant(&self, variant: PortTableEnum) -> usize {
                match variant {
                    $(
                        $(#[$meta])*
                        PortTableEnum::$variant => self.$field.len(),
                    )+
                }
            }

            fn encode_for_variant(
                &self,
                variant: PortTableEnum,
            ) -> Result<Vec<u8>, apache_avro::Error> {
                match variant {
                    $(
                        $(#[$meta])*
                        PortTableEnum::$variant => $crate::encode::encode(self.$field.clone()),
                    )+
                }
            }
        }

        $(
            $(#[$meta])*
            impl $ty {
                pub fn $getter() -> String {
                    $name.to_string()
                }
            }
        )+
    };
}

/// Defines the entire master / get_data table schema from a single source list.
///
/// Entry format:
/// `Variant => field_name: RustType => "table_name"`
///
/// What is generated from each entry:
/// - `GetDataTableEnum` variant (`Copy + Ord` so it works as a `BTreeMap` key)
/// - `GetDataTable` field (`Vec<RustType>`)
/// - `GetDataTableEnum::table_name()` arm
/// - `GetDataTable::record_count_for_variant` arm
/// - `GetDataTable::encode_for_variant` arm
///
/// `GetDataTableEncode` itself is a type alias over the enum-keyed
/// [`TableEncode`].
///
/// (Type-level `Type::get_table_name()` getters are intentionally NOT generated
/// here, because the `Mst*` types live in `kc-api-interface` and Rust's orphan
/// rules forbid inherent impls on foreign types from this crate.)
///
/// **No `Default` is derived for `GetDataTable`** — the contract is that every
/// master table must be populated at construction time (via
/// [`GetDataTable::new`], which uses an exhaustive struct literal). Allowing
/// `GetDataTable::default()` would let callers silently skip loading after a
/// new variant is added. A `#[cfg(test)] fn empty_for_test()` constructor is
/// auto-generated by the macro for testing purposes only; it lists every field
/// explicitly so that adding a new variant immediately produces a compile
/// error in both `new()` and the test helper.
macro_rules! define_get_data_table_schema {
    (
        $(
            $(#[$meta:meta])*
            $variant:ident => $field:ident : $ty:ty => $name:literal,
        )+
    ) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum GetDataTableEnum {
            $(
                $(#[$meta])*
                $variant,
            )+
        }

        impl GetDataTableEnum {
            pub const ALL: &'static [GetDataTableEnum] = &[
                $(
                    $(#[$meta])*
                    GetDataTableEnum::$variant,
                )+
            ];

            pub fn variants() -> &'static [GetDataTableEnum] {
                Self::ALL
            }

            pub const fn table_name(self) -> &'static str {
                match self {
                    $(
                        $(#[$meta])*
                        GetDataTableEnum::$variant => $name,
                    )+
                }
            }
        }

        // Intentionally NO `Default` derive — see macro doc. Forces every call
        // site to enumerate all fields, so adding a variant becomes a compile
        // error at construction sites (e.g. GetDataTable::new) instead of a
        // silent "load missed" hazard.
        #[derive(Debug, Clone, FieldSizeChecker)]
        pub struct GetDataTable {
            $(
                $(#[$meta])*
                pub $field: Vec<$ty>,
            )+
        }

        #[cfg(test)]
        impl GetDataTable {
            /// Test-only empty constructor. Lists every field explicitly so
            /// that adding a new variant to `define_get_data_table_schema!`
            /// also forces this helper to be regenerated by the macro.
            pub(crate) fn empty_for_test() -> Self {
                Self {
                    $(
                        $(#[$meta])*
                        $field: Vec::new(),
                    )+
                }
            }
        }

        impl GetDataTable {
            fn record_count_for_variant(&self, variant: GetDataTableEnum) -> usize {
                match variant {
                    $(
                        $(#[$meta])*
                        GetDataTableEnum::$variant => self.$field.len(),
                    )+
                }
            }

            fn encode_for_variant(
                &self,
                variant: GetDataTableEnum,
            ) -> Result<Vec<u8>, apache_avro::Error> {
                match variant {
                    $(
                        $(#[$meta])*
                        GetDataTableEnum::$variant => $crate::encode::encode(self.$field.clone()),
                    )+
                }
            }
        }
    };
}

pub type PortTableEncode = TableEncode<PortTableEnum>;
pub type GetDataTableEncode = TableEncode<GetDataTableEnum>;

define_port_table_schema! {
    EnvInfo => env_info: EnvInfo => get_table_name => "env_info",
    Cells => cells: Cells => get_table_name => "cells",
    AirBase => airbase: AirBase => get_table_name => "airbase",
    PlaneInfo => plane_info: PlaneInfo => get_table_name => "plane_info",
    OwnSlotItem => own_slotitem: OwnSlotItem => get_table_name => "own_slotitem",
    EnemySlotItem => enemy_slotitem: EnemySlotItem => get_table_name => "enemy_slotitem",
    FriendSlotItem => friend_slotitem: FriendSlotItem => get_table_name => "friend_slotitem",
    OwnShip => own_ship: OwnShip => get_table_name => "own_ship",
    EnemyShip => enemy_ship: EnemyShip => get_table_name => "enemy_ship",
    FriendShip => friend_ship: FriendShip => get_table_name => "friend_ship",
    OwnDeck => own_deck: OwnDeck => get_table_name => "own_deck",
    SupportDeck => support_deck: SupportDeck => get_table_name => "support_deck",
    EnemyDeck => enemy_deck: EnemyDeck => get_table_name => "enemy_deck",
    FriendDeck => friend_deck: FriendDeck => get_table_name => "friend_deck",
    AirBaseAirAttack => airbase_airattack: AirBaseAirAttack => get_table_name => "airbase_airattack",
    AirBaseAirAttackList => airbase_airattack_list: AirBaseAirAttackList => get_table_name => "airbase_airattack_list",
    AirBaseAssult => airbase_assult: AirBaseAssult => get_table_name => "airbase_assult",
    CarrierBaseAssault => carrierbase_assault: CarrierBaseAssault => get_table_name => "carrierbase_assault",
    ClosingRaigeki => closing_raigeki: ClosingRaigeki => get_table_name => "closing_raigeki",
    FriendlySupportHourai => friendly_support_hourai: FriendlySupportHourai => get_table_name => "friendly_support_hourai",
    FriendlySupportHouraiList => friendly_support_hourai_list: FriendlySupportHouraiList => get_table_name => "friendly_support_hourai_list",
    Hougeki => hougeki: Hougeki => get_table_name => "hougeki",
    HougekiList => hougeki_list: HougekiList => get_table_name => "hougeki_list",
    MidnightHougeki => midnight_hougeki: MidnightHougeki => get_table_name => "midnight_hougeki",
    MidnightHougekiList => midnight_hougeki_list: MidnightHougekiList => get_table_name => "midnight_hougeki_list",
    #[cfg(feature = "schema_v0_5")]
    NightSupportHourai => night_support_hourai: NightSupportHourai => get_table_name => "night_support_hourai",
    #[cfg(feature = "schema_v0_5")]
    NightSupportAirattack => night_support_airattack: SupportAirattack => get_night_table_name => "night_support_airattack",
    OpeningAirAttack => opening_airattack: OpeningAirAttack => get_table_name => "opening_airattack",
    OpeningAirAttackList => opening_airattack_list: OpeningAirAttackList => get_table_name => "opening_airattack_list",
    OpeningRaigeki => opening_raigeki: OpeningRaigeki => get_table_name => "opening_raigeki",
    OpeningTaisen => opening_taisen: OpeningTaisen => get_table_name => "opening_taisen",
    OpeningTaisenList => opening_taisen_list: OpeningTaisenList => get_table_name => "opening_taisen_list",
    SupportAirattack => support_airattack: SupportAirattack => get_table_name => "support_airattack",
    SupportHourai => support_hourai: SupportHourai => get_table_name => "support_hourai",
    Battle => battle: Battle => get_table_name => "battle",
    #[cfg(feature = "schema_v0_5")]
    BattleResult => battle_result: BattleResult => get_table_name => "battle_result",
}

pub static PORT_TABLE_NAMES: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(|| {
    PortTableEnum::variants()
        .iter()
        .map(|variant| variant.table_name().to_string())
        .collect()
});

impl FromStr for PortTableEnum {
    type Err = ();

    fn from_str(input: &str) -> Result<PortTableEnum, Self::Err> {
        PortTableEnum::variants()
            .iter()
            .copied()
            .find(|variant| variant.table_name() == input)
            .ok_or(())
    }
}

impl PortTable {
    pub fn new(
        interface_cells: kc_api_interface::cells::Cells,
        user_env: UserEnv,
        timestamp: i64,
    ) -> PortTable {
        let mut table = PortTable::default();
        let mut dedup = crate::dedup::DedupCache::new();
        let timestamp_context = uuid::ContextV7::new().with_additional_precision();
        let ts: uuid::Timestamp =
            uuid::Timestamp::from_unix(&timestamp_context, timestamp as u64, 0);
        let env_uuid = EnvInfo::new_ret_uuid(ts, (user_env, timestamp), &mut table);
        {
            let uuid = Uuid::new_v7(ts);
            Cells::new_ret_option(ts, uuid, interface_cells.clone(), &mut table, &mut dedup, env_uuid)
        };
        tracing::debug!(
            "PortTable::new created with {} cells, maparea_id={}, mapinfo_no={}, battles={}",
            table.cells.len(),
            interface_cells.maparea_id,
            interface_cells.mapinfo_no,
            interface_cells.battles.len()
        );
        table
    }

    pub fn encode(&self) -> Result<PortTableEncode, apache_avro::Error> {
        let mut table_encode = PortTableEncode::default();
        for variant in PortTableEnum::variants().iter().copied() {
            let bytes = self.encode_for_variant(variant)?;
            if variant == PortTableEnum::Cells {
                tracing::debug!(
                    "PortTable::encode - cells: {} records, {} bytes",
                    self.cells.len(),
                    bytes.len()
                );
            }
            table_encode.insert(variant, bytes);
        }
        Ok(table_encode)
    }

    /// Encode only non-empty tables and return Vec of (table enum, avro_bytes)
    pub fn encode_non_empty_tables(
        &self,
    ) -> Result<Vec<(PortTableEnum, Vec<u8>)>, apache_avro::Error> {
        let mut tables: Vec<(PortTableEnum, Vec<u8>)> = Vec::new();

        for variant in PortTableEnum::variants().iter().copied() {
            if self.record_count_for_variant(variant) == 0 {
                continue;
            }

            let bytes = self.encode_for_variant(variant)?;
            if !bytes.is_empty() {
                tables.push((variant, bytes));
            }
        }

        Ok(tables)
    }
}

// pub struct RequireInfoTable {
//     pub slotitem: Vec<OwnSlotItem>,
// }

define_get_data_table_schema! {
    MstShip => mst_ship: MstShip => "mst_ship",
    MstSlotItem => mst_slot_item: MstSlotItem => "mst_slot_item",
    MstEquipExslotShip => mst_equip_exslot_ship: MstEquipExslotShip => "mst_equip_exslot_ship",
    MstEquipExslot => mst_equip_exslot: MstEquipExslot => "mst_equip_exslot",
    MstEquipLimitExslot => mst_equip_limit_exslot: MstEquipLimitExslot => "mst_equip_limit_exslot",
    MstSlotItemEquipType => mst_slot_item_equip_type: MstSlotItemEquipType => "mst_slot_item_equip_type",
    MstEquipShip => mst_equip_ship: MstEquipShip => "mst_equip_ship",
    MstStype => mst_stype: MstStype => "mst_stype",
    MstUseItem => mst_use_item: MstUseItem => "mst_use_item",
    MstMapArea => mst_map_area: MstMapArea => "mst_map_area",
    MstMapInfo => mst_map_info: MstMapInfo => "mst_map_info",
    MstShipGraph => mst_ship_graph: MstShipGraph => "mst_ship_graph",
    MstShipUpgrade => mst_ship_upgrade: MstShipUpgrade => "mst_ship_upgrade",
}

pub static GET_DATA_TABLE_NAMES: std::sync::LazyLock<Vec<String>> =
    std::sync::LazyLock::new(|| {
        GetDataTableEnum::variants()
            .iter()
            .copied()
            .map(|variant| variant.table_name().to_string())
            .collect()
    });

impl FromStr for GetDataTableEnum {
    type Err = ();

    fn from_str(input: &str) -> Result<GetDataTableEnum, Self::Err> {
        GetDataTableEnum::variants()
            .iter()
            .copied()
            .find(|variant| variant.table_name() == input)
            .ok_or(())
    }
}

impl GetDataTable {
    #[allow(clippy::new_without_default)]
    pub fn new() -> GetDataTable {
        let mst_ship = MstShips::load().mst_ships.values().cloned().collect();
        let mst_slot_item = MstSlotItems::load()
            .mst_slot_items
            .values()
            .cloned()
            .collect();
        let mst_equip_exslot_ship = MstEquipExslotShips::load()
            .mst_equip_ships
            .values()
            .cloned()
            .collect();
        let mst_equip_exslot = MstEquipExslots::load()
            .mst_equip_exslots
            .values()
            .cloned()
            .collect();
        let mst_equip_limit_exslot = MstEquipLimitExslots::load()
            .mst_equip_limit_exslots
            .values()
            .cloned()
            .collect();
        let mst_slot_item_equip_type = MstSlotItemEquipTypes::load()
            .mst_slotitem_equip_types
            .values()
            .cloned()
            .collect();
        let mst_equip_ship = MstEquipShips::load()
            .mst_equip_ships
            .values()
            .cloned()
            .collect();
        let mst_stype = MstStypes::load().mst_stypes.values().cloned().collect();
        let mst_use_item = MstUseItems::load()
            .mst_use_items
            .values()
            .cloned()
            .collect();
        let mst_ship_graph = MstShipGraphs::load()
            .mst_ship_graphs
            .values()
            .cloned()
            .collect();
        let mst_map_area = MstMapAreas::load()
            .mst_map_areas
            .values()
            .cloned()
            .collect();
        let mst_map_info = MstMapInfos::load()
            .mst_map_infos
            .values()
            .cloned()
            .collect();
        let mst_ship_upgrade = MstShipUpgrades::load()
            .mst_ship_upgrades
            .values()
            .cloned()
            .collect();

        GetDataTable {
            mst_ship,
            mst_slot_item,
            mst_equip_exslot_ship,
            mst_equip_exslot,
            mst_equip_limit_exslot,
            mst_slot_item_equip_type,
            mst_equip_ship,
            mst_stype,
            mst_use_item,
            mst_map_area,
            mst_map_info,
            mst_ship_graph,
            mst_ship_upgrade,
        }
    }

    pub fn encode(&self) -> Result<GetDataTableEncode, apache_avro::Error> {
        let mut table_encode = GetDataTableEncode::default();
        for variant in GetDataTableEnum::variants().iter().copied() {
            let bytes = self.encode_for_variant(variant)?;
            table_encode.insert(variant, bytes);
        }
        Ok(table_encode)
    }

    pub fn encode_non_empty_tables(
        &self,
    ) -> Result<Vec<(GetDataTableEnum, Vec<u8>)>, apache_avro::Error> {
        let mut tables: Vec<(GetDataTableEnum, Vec<u8>)> = Vec::new();

        for variant in GetDataTableEnum::variants().iter().copied() {
            if self.record_count_for_variant(variant) == 0 {
                continue;
            }

            let bytes = self.encode_for_variant(variant)?;
            if !bytes.is_empty() {
                tables.push((variant, bytes));
            }
        }

        Ok(tables)
    }
}

#[cfg(test)]
mod schema_invariants {
    //! Compile-time + runtime safety net for the macro-generated table schemas.
    //!
    //! These tests guarantee that `#[cfg(feature = "...")]`-driven additions or
    //! removals of variants cannot silently break the system:
    //!
    //! * Every variant has a non-empty, unique `table_name` (no typo collisions).
    //! * `FromStr` is a perfect inverse of `table_name` for every variant.
    //! * `*Encode` (BTreeMap-backed) preserves all variants as distinct keys
    //!   in declaration order.
    //! * `record_count_for_variant` / `encode_for_variant` are callable for
    //!   every variant — exhaustiveness is enforced at compile time by the
    //!   generated `match`, and exercised at runtime here.
    //!
    //! When a new variant is added to `define_port_table_schema!` or
    //! `define_get_data_table_schema!` (with or without `#[cfg(...)]`), all
    //! tests below remain valid by construction; they only fail if a future
    //! refactor breaks one of the above invariants.
    use super::*;
    use std::collections::HashSet;
    use std::str::FromStr;

    #[test]
    fn port_table_names_are_unique_and_nonempty() {
        let mut seen = HashSet::new();
        for v in PortTableEnum::variants().iter().copied() {
            let name = v.table_name();
            assert!(!name.is_empty(), "PortTableEnum::{:?} has empty table_name", v);
            assert!(seen.insert(name), "duplicate PortTableEnum table_name: {}", name);
        }
        assert_eq!(seen.len(), PortTableEnum::variants().len());
    }

    #[test]
    fn get_data_table_names_are_unique_and_nonempty() {
        let mut seen = HashSet::new();
        for v in GetDataTableEnum::variants().iter().copied() {
            let name = v.table_name();
            assert!(!name.is_empty(), "GetDataTableEnum::{:?} has empty table_name", v);
            assert!(seen.insert(name), "duplicate GetDataTableEnum table_name: {}", name);
        }
        assert_eq!(seen.len(), GetDataTableEnum::variants().len());
    }

    #[test]
    fn port_table_from_str_roundtrip() {
        for v in PortTableEnum::variants().iter().copied() {
            assert_eq!(PortTableEnum::from_str(v.table_name()), Ok(v));
        }
        assert!(PortTableEnum::from_str("__not_a_real_table__").is_err());
    }

    #[test]
    fn get_data_table_from_str_roundtrip() {
        for v in GetDataTableEnum::variants().iter().copied() {
            assert_eq!(GetDataTableEnum::from_str(v.table_name()), Ok(v));
        }
        assert!(GetDataTableEnum::from_str("__not_a_real_table__").is_err());
    }

    #[test]
    fn port_table_encode_keys_match_variants() {
        let mut encode = PortTableEncode::default();
        for v in PortTableEnum::variants().iter().copied() {
            encode.insert(v, Vec::new());
        }
        assert_eq!(encode.len(), PortTableEnum::variants().len());
        let collected: Vec<_> = encode.iter().map(|(k, _)| k).collect();
        assert_eq!(collected, PortTableEnum::variants().to_vec());
    }

    #[test]
    fn get_data_table_encode_keys_match_variants() {
        let mut encode = GetDataTableEncode::default();
        for v in GetDataTableEnum::variants().iter().copied() {
            encode.insert(v, Vec::new());
        }
        assert_eq!(encode.len(), GetDataTableEnum::variants().len());
        let collected: Vec<_> = encode.iter().map(|(k, _)| k).collect();
        assert_eq!(collected, GetDataTableEnum::variants().to_vec());
    }

    #[test]
    fn port_table_encode_for_every_variant_is_callable() {
        let table = PortTable::default();
        for v in PortTableEnum::variants().iter().copied() {
            assert_eq!(
                table.record_count_for_variant(v),
                0,
                "default PortTable should have 0 records for {:?}",
                v
            );
            table
                .encode_for_variant(v)
                .unwrap_or_else(|e| panic!("encode_for_variant({:?}) failed: {}", v, e));
        }
    }

    #[test]
    fn get_data_table_encode_for_every_variant_is_callable() {
        // Intentionally use empty_for_test() instead of any Default impl —
        // see macro doc on define_get_data_table_schema! for rationale.
        let table = GetDataTable::empty_for_test();
        for v in GetDataTableEnum::variants().iter().copied() {
            assert_eq!(
                table.record_count_for_variant(v),
                0,
                "default GetDataTable should have 0 records for {:?}",
                v
            );
            table
                .encode_for_variant(v)
                .unwrap_or_else(|e| panic!("encode_for_variant({:?}) failed: {}", v, e));
        }
    }
}
