#[cfg(feature = "schema_v0_5")]
use kc_api_interface::deck_port::DeckPorts;
#[cfg(feature = "schema_v0_5")]
use kc_api_interface::mst_ship::MstShips;
#[cfg(feature = "schema_v0_5")]
use kc_api_interface::mst_slot_item::MstSlotItems;
#[cfg(feature = "schema_v0_5")]
use kc_api_interface::ship::Ships;
#[cfg(feature = "schema_v0_5")]
use kc_api_interface::slot_item::SlotItems;

#[cfg(feature = "schema_v0_5")]
#[derive(Clone, Copy)]
pub(super) enum SpritePlaneTypeSet {
    AirWar,
    AirWarJet,
    AirUnit,
    AirUnitJet,
}

#[cfg(feature = "schema_v0_5")]
pub(super) type SpriteCapacity = Vec<Option<i32>>;

#[cfg(feature = "schema_v0_5")]
const SPRITE_PLANE_TYPES_AIR_WAR: [i32; 12] = [6, 7, 8, 11, 25, 26, 41, 45, 56, 57, 58, 91];
#[cfg(feature = "schema_v0_5")]
const SPRITE_PLANE_TYPES_AIR_WAR_JET: [i32; 4] = [56, 57, 58, 91];
#[cfg(feature = "schema_v0_5")]
const SPRITE_PLANE_TYPES_AIR_UNIT: [i32; 19] = [
    6, 7, 8, 9, 10, 11, 25, 26, 41, 45, 47, 48, 49, 53, 56, 57, 58, 59, 91,
];
#[cfg(feature = "schema_v0_5")]
const SPRITE_PLANE_TYPES_AIR_UNIT_JET: [i32; 5] = [56, 57, 58, 59, 91];
#[cfg(feature = "schema_v0_5")]
const SUPPORT_FRIEND_SPRITE_SHIP_TYPES: [i32; 9] = [6, 7, 10, 11, 15, 16, 17, 18, 22];

#[cfg(feature = "schema_v0_5")]
fn sprite_plane_types(set: SpritePlaneTypeSet) -> &'static [i32] {
    match set {
        SpritePlaneTypeSet::AirWar => &SPRITE_PLANE_TYPES_AIR_WAR,
        SpritePlaneTypeSet::AirWarJet => &SPRITE_PLANE_TYPES_AIR_WAR_JET,
        SpritePlaneTypeSet::AirUnit => &SPRITE_PLANE_TYPES_AIR_UNIT,
        SpritePlaneTypeSet::AirUnitJet => &SPRITE_PLANE_TYPES_AIR_UNIT_JET,
    }
}

#[cfg(feature = "schema_v0_5")]
fn is_sprite_plane_equip_type(set: SpritePlaneTypeSet, equip_type_sp: i32) -> bool {
    sprite_plane_types(set).contains(&equip_type_sp)
}

#[cfg(feature = "schema_v0_5")]
fn count_ship_sprite_planes_from_mst_slot_ids(
    set: SpritePlaneTypeSet,
    mst_slot_ids: &[i64],
    mst_slots: &MstSlotItems,
) -> i32 {
    let mut count = 0;
    for mst_slot_id in mst_slot_ids {
        if *mst_slot_id <= 0 {
            continue;
        }
        let Some(mst) = mst_slots.mst_slot_items.get(&(*mst_slot_id as i32)) else {
            continue;
        };
        let Some(equip_type_sp) = mst.r#type.get(2).copied() else {
            continue;
        };
        if is_sprite_plane_equip_type(set, equip_type_sp) {
            count += 1;
            if count >= 3 {
                break;
            }
        }
    }
    count
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn build_friend_ship_sprite_capacity(
    deck_id: Option<i64>,
    set: SpritePlaneTypeSet,
) -> Option<SpriteCapacity> {
    let deck_id = deck_id?;
    let decks = DeckPorts::load();
    let deck = decks.deck_ports.get(&deck_id)?;

    let mut ship_ids = deck.ship.clone().unwrap_or_default();
    if decks.combined_flag.is_some() && deck_id == 1 {
        if let Some(escort) = decks.deck_ports.get(&2).and_then(|d| d.ship.clone()) {
            ship_ids.extend(escort);
        }
    }

    let ships = Ships::load();
    let slot_items = SlotItems::load();
    let mst_slots = MstSlotItems::load();

    let capacities = ship_ids
        .into_iter()
        .map(|ship_id| {
            if ship_id <= 0 {
                return Some(0);
            }
            let Some(ship) = ships.ships.get(&ship_id) else {
                return Some(0);
            };
            let Some(slot_instance_ids) = ship.slot.as_ref() else {
                return Some(0);
            };

            let mut mst_slot_ids = Vec::with_capacity(slot_instance_ids.len());
            for slot_instance_id in slot_instance_ids {
                if *slot_instance_id <= 0 {
                    continue;
                }
                let Some(slot_item) = slot_items.slot_items.get(slot_instance_id) else {
                    continue;
                };
                mst_slot_ids.push(slot_item.slotitem_id);
            }

            Some(count_ship_sprite_planes_from_mst_slot_ids(set, &mst_slot_ids, &mst_slots))
        })
        .collect::<Vec<_>>();

    Some(capacities)
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn build_enemy_ship_sprite_capacity(
    e_slots: Option<Vec<Vec<i64>>>,
    set: SpritePlaneTypeSet,
) -> Option<SpriteCapacity> {
    let e_slots = e_slots?;
    let mst_slots = MstSlotItems::load();
    Some(
        e_slots
            .iter()
            .map(|slot_list| Some(count_ship_sprite_planes_from_mst_slot_ids(set, slot_list, &mst_slots)))
            .collect(),
    )
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn count_sprite_fly_from_plane_from(
    plane_from: Option<&Vec<i64>>,
    ship_sprite_capacity: Option<&SpriteCapacity>,
) -> Option<i32> {
    let plane_from = plane_from?;
    let ship_sprite_capacity = ship_sprite_capacity?;

    let mut total = 0;
    for idx in plane_from {
        if *idx < 0 {
            continue;
        }
        let Some(count) = ship_sprite_capacity.get(*idx as usize) else {
            continue;
        };
        let Some(count) = count.as_ref() else {
            continue;
        };
        total += *count;
    }
    Some(total)
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn count_support_friend_sprite_fly_from_ship_ids(ship_ids: &[i64]) -> Option<i32> {
    let ships = Ships::load();
    let mst_ships = MstShips::load();
    let mut count = 0;

    for ship_id in ship_ids {
        if *ship_id <= 0 {
            continue;
        }
        let Some(ship) = ships.ships.get(ship_id) else {
            continue;
        };
        let Some(mst_ship_id) = ship.ship_id else {
            continue;
        };
        let Some(mst_ship) = mst_ships.mst_ships.get(&(mst_ship_id as i32)) else {
            continue;
        };
        if SUPPORT_FRIEND_SPRITE_SHIP_TYPES.contains(&mst_ship.stype) {
            count += 1;
        }
    }

    Some(count.min(6))
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn count_friend_sprite_fly_from_airbase_squadrons(counts: &[i64]) -> i32 {
    counts
        .iter()
        .map(|count| {
            let mut sprite_count = 0;
            if *count > 0 {
                sprite_count += 1;
            }
            if *count > 6 {
                sprite_count += 1;
            }
            sprite_count
        })
        .sum()
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn count_friend_sprite_fly_from_optional_airbase_squadrons(
    counts: Option<&Vec<Option<i64>>>,
) -> Option<i32> {
    let counts = counts?;
    let mut resolved = Vec::with_capacity(counts.len());
    for count in counts {
        resolved.push(count.as_ref().copied()?);
    }
    Some(count_friend_sprite_fly_from_airbase_squadrons(&resolved))
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn unresolved_sprite_crash_stage_counts() -> (Option<i32>, Option<i32>, Option<i32>, Option<i32>) {
    // lostcount is not equivalent to visible sprite crash count.
    // Client-side crash transitions are distributed stochastically by remaining plane power.
    (None, None, None, None)
}

#[cfg(feature = "schema_v0_5")]
pub(super) fn unresolved_sprite_crash_counts() -> (Option<i32>, Option<i32>) {
    // Same rationale as stage crash counts: no deterministic mapping from loss to crash.
    (None, None)
}

#[cfg(feature = "schema_v0_5")]
#[derive(Clone, Copy)]
pub(super) struct StageSpriteMetrics {
    pub f_fly_count: Option<i32>,
    pub e_fly_count: Option<i32>,
    pub f_crash_stage1_count: Option<i32>,
    pub f_crash_stage2_count: Option<i32>,
    pub e_crash_stage1_count: Option<i32>,
    pub e_crash_stage2_count: Option<i32>,
}

#[cfg(feature = "schema_v0_5")]
impl StageSpriteMetrics {
    pub fn from_fly_counts(f_fly_count: Option<i32>, e_fly_count: Option<i32>) -> Self {
        let (
            f_crash_stage1_count,
            f_crash_stage2_count,
            e_crash_stage1_count,
            e_crash_stage2_count,
        ) = unresolved_sprite_crash_stage_counts();

        Self {
            f_fly_count,
            e_fly_count,
            f_crash_stage1_count,
            f_crash_stage2_count,
            e_crash_stage1_count,
            e_crash_stage2_count,
        }
    }
}

#[cfg(feature = "schema_v0_5")]
#[derive(Clone, Copy)]
pub(super) struct SupportSpriteMetrics {
    pub f_fly_count: Option<i32>,
    pub e_fly_count: Option<i32>,
    pub f_crash_count: Option<i32>,
    pub e_crash_count: Option<i32>,
}

#[cfg(feature = "schema_v0_5")]
impl SupportSpriteMetrics {
    pub fn from_fly_counts(f_fly_count: Option<i32>, e_fly_count: Option<i32>) -> Self {
        let (f_crash_count, e_crash_count) = unresolved_sprite_crash_counts();
        Self {
            f_fly_count,
            e_fly_count,
            f_crash_count,
            e_crash_count,
        }
    }
}

#[cfg(feature = "schema_v0_5")]
#[derive(Clone, Default)]
pub(super) struct SpriteCapacityContext {
    pub f_air_war: Option<SpriteCapacity>,
    pub e_air_war: Option<SpriteCapacity>,
    pub f_air_war_jet: Option<SpriteCapacity>,
    pub e_air_war_jet: Option<SpriteCapacity>,
    pub e_air_unit: Option<SpriteCapacity>,
    pub e_air_unit_jet: Option<SpriteCapacity>,
}

#[cfg(feature = "schema_v0_5")]
impl SpriteCapacityContext {
    pub fn from_battle(data: &kc_api_interface::battle::Battle) -> Self {
        Self {
            f_air_war: build_friend_ship_sprite_capacity(data.deck_id, SpritePlaneTypeSet::AirWar),
            e_air_war: build_enemy_ship_sprite_capacity(
                data.e_slot.clone(),
                SpritePlaneTypeSet::AirWar,
            ),
            f_air_war_jet: build_friend_ship_sprite_capacity(
                data.deck_id,
                SpritePlaneTypeSet::AirWarJet,
            ),
            e_air_war_jet: build_enemy_ship_sprite_capacity(
                data.e_slot.clone(),
                SpritePlaneTypeSet::AirWarJet,
            ),
            e_air_unit: build_enemy_ship_sprite_capacity(
                data.e_slot.clone(),
                SpritePlaneTypeSet::AirUnit,
            ),
            e_air_unit_jet: build_enemy_ship_sprite_capacity(
                data.e_slot.clone(),
                SpritePlaneTypeSet::AirUnitJet,
            ),
        }
    }
}
