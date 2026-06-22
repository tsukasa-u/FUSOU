use chrono::Local;
use rand::Rng;

use crate::InterfaceWrapper;
use kc_api_dto::common as kcapi_common;
use kc_api_dto::common::custom_type::DuoType;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::battle::{
    AirBaseAirAttack, AirBaseAirAttacks, AirBaseAssult, AirDamage, AirFire, Battle, BattleResult,
    BattleType, CarrierBaseAssault, ClosingRaigeki, FriendlyForceAttack, FriendlyForceInfo,
    FriendlySupportHourai, Hougeki, MidnightHougeki, NightSupportAttack, OpeningAirAttack,
    OpeningRaigeki, OpeningTaisen, SupportAiratack, SupportAttack, SupportHourai,
};
use kc_api_interface::cells::KCS_CELLS_INDEX;
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::mst_slot_item::MstSlotItems;
use kc_api_interface::ship::Ships;
use kc_api_interface::slot_item::SlotItems;

pub(crate) fn unwrap_into<T, U>(value: T) -> U
where
    InterfaceWrapper<U>: From<T>,
{
    InterfaceWrapper::from(value).unwrap()
}

fn combine<T>(list: &[Option<Vec<T>>]) -> Option<Vec<T>>
where
    T: Clone,
{
    let mut combined: Vec<T> = Vec::new();
    for x in list {
        match x {
            Some(y) => combined.extend(y.clone()),
            None => continue,
        }
    }
    match combined.is_empty() {
        true => None,
        false => Some(combined),
    }
}

fn has_fractional_part(value: f32) -> bool {
    value.floor() < value
}

fn calc_opening_ydam_protect_flag(ydam_items: &Vec<Option<Vec<f32>>>) -> Vec<bool> {
    ydam_items
        .iter()
        .map(|item| {
            item.as_ref()
                .and_then(|v| v.first().copied())
                .is_some_and(has_fractional_part)
        })
        .collect()
}

#[derive(Clone, Copy)]
enum SpritePlaneTypeSet {
    AirWar,
    AirWarJet,
    AirUnit,
    AirUnitJet,
}

type SpriteCapacity = Vec<Option<i64>>;

const SPRITE_PLANE_TYPES_AIR_WAR: [i32; 12] = [6, 7, 8, 11, 25, 26, 41, 45, 56, 57, 58, 91];
const SPRITE_PLANE_TYPES_AIR_WAR_JET: [i32; 4] = [56, 57, 58, 91];
const SPRITE_PLANE_TYPES_AIR_UNIT: [i32; 19] = [
    6, 7, 8, 9, 10, 11, 25, 26, 41, 45, 47, 48, 49, 53, 56, 57, 58, 59, 91,
];
const SPRITE_PLANE_TYPES_AIR_UNIT_JET: [i32; 5] = [56, 57, 58, 59, 91];
fn sprite_plane_types(set: SpritePlaneTypeSet) -> &'static [i32] {
    match set {
        SpritePlaneTypeSet::AirWar => &SPRITE_PLANE_TYPES_AIR_WAR,
        SpritePlaneTypeSet::AirWarJet => &SPRITE_PLANE_TYPES_AIR_WAR_JET,
        SpritePlaneTypeSet::AirUnit => &SPRITE_PLANE_TYPES_AIR_UNIT,
        SpritePlaneTypeSet::AirUnitJet => &SPRITE_PLANE_TYPES_AIR_UNIT_JET,
    }
}

fn is_sprite_plane_equip_type(set: SpritePlaneTypeSet, equip_type_sp: i32) -> bool {
    sprite_plane_types(set).contains(&equip_type_sp)
}

fn count_ship_sprite_planes_from_mst_slot_ids(
    set: SpritePlaneTypeSet,
    mst_slot_ids: &[i64],
    mst_slots: &MstSlotItems,
) -> i64 {
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

fn build_friend_ship_sprite_capacity(
    deck_id: Option<i64>,
    set: SpritePlaneTypeSet,
) -> Option<SpriteCapacity> {
    let deck_id = deck_id?;
    let decks = DeckPorts::load();
    let deck = decks.deck_ports.get(&deck_id)?;

    let mut ship_ids = deck.ship.clone().unwrap_or_default();
    if should_include_friend_escort(decks.combined_flag, deck_id) {
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

            Some(count_ship_sprite_planes_from_mst_slot_ids(
                set,
                &mst_slot_ids,
                &mst_slots,
            ))
        })
        .collect::<Vec<_>>();

    Some(capacities)
}

fn should_include_friend_escort(combined_flag: Option<i64>, deck_id: i64) -> bool {
    deck_id == 1 && combined_flag.is_some_and(|flag| flag > 0)
}

fn build_enemy_ship_sprite_capacity(
    e_slots: Option<Vec<Vec<i64>>>,
    set: SpritePlaneTypeSet,
) -> Option<SpriteCapacity> {
    let e_slots = e_slots?;
    let mst_slots = MstSlotItems::load();
    Some(
        e_slots
            .iter()
            .map(|slot_list| {
                Some(count_ship_sprite_planes_from_mst_slot_ids(
                    set, slot_list, &mst_slots,
                ))
            })
            .collect(),
    )
}

/// Counts fly sprites for ships listed in `plane_from`, matching main.js `_createPlanes`
/// which builds sprites only for stage3 participants.
/// When `plane_from` is `None` (stage3 data absent), falls back to summing all ships.
/// When `plane_from` is `Some([])` (no stage3 participation), returns `Some(0)`.
fn count_sprite_fly_from_capacity(
    capacity: Option<&SpriteCapacity>,
    plane_from: Option<&[i64]>,
) -> Option<i64> {
    let capacity = capacity?;
    let total: i64 = match plane_from {
        Some(indices) => indices
            .iter()
            .filter_map(|&idx| {
                if idx < 0 {
                    return None;
                }
                capacity.get(idx as usize).and_then(|&c| c)
            })
            .sum(),
        None => capacity.iter().filter_map(|&c| c).sum(),
    };
    Some(total)
}

fn count_support_friend_sprite_fly_from_ship_ids(ship_ids: &[i64]) -> Option<i64> {
    let ships = Ships::load();
    let slot_items = SlotItems::load();
    let mst_slots = MstSlotItems::load();
    let mut count = 0;

    for ship_id in ship_ids {
        if *ship_id <= 0 {
            continue;
        }
        let Some(ship) = ships.ships.get(ship_id) else {
            continue;
        };
        let Some(slot_instance_ids) = ship.slot.as_ref() else {
            continue;
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

        let ship_sprite_planes = count_ship_sprite_planes_from_mst_slot_ids(
            SpritePlaneTypeSet::AirWar,
            &mst_slot_ids,
            &mst_slots,
        );
        if ship_sprite_planes > 0 {
            // Support-air motion count is ship-based: one motion per attacking ship.
            count += 1;
        }
    }

    Some(count.min(6))
}

fn count_friend_sprite_fly_from_airbase_squadrons(counts: &[i64]) -> i64 {
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

fn count_friend_sprite_fly_from_optional_airbase_squadrons(
    counts: Option<&Vec<Option<i64>>>,
) -> Option<i64> {
    let counts = counts?;
    // API may return null for unused squadrons; treat null as 0 instead of
    // dropping the entire metric to keep sprite display stable.
    let resolved = counts
        .iter()
        .map(|count| count.unwrap_or(0))
        .collect::<Vec<_>>();
    Some(count_friend_sprite_fly_from_airbase_squadrons(&resolved))
}

#[cfg(test)]
fn calc_sprite_crash_stage_counts(
    fly_count: Option<i64>,
    loss_stage1: i64,
    total_stage1: i64,
    loss_stage2: i64,
    total_stage2: i64,
) -> (Option<i64>, Option<i64>) {
    let (crash, damage, _non_normal) = calc_sprite_motion_stage_counts(
        fly_count,
        loss_stage1,
        total_stage1,
        loss_stage2,
        total_stage2,
    );
    (crash, damage)
}

fn calc_sprite_motion_stage_counts(
    fly_count: Option<i64>,
    loss_stage1: i64,
    total_stage1: i64,
    loss_stage2: i64,
    total_stage2: i64,
) -> (Option<i64>, Option<i64>, Option<i64>) {
    let mut rng = rand::thread_rng();
    calc_sprite_motion_stage_counts_with_rng(
        fly_count,
        loss_stage1,
        total_stage1,
        loss_stage2,
        total_stage2,
        &mut rng,
    )
}

fn calc_sprite_motion_stage_counts_with_rng<R: Rng + ?Sized>(
    fly_count: Option<i64>,
    loss_stage1: i64,
    total_stage1: i64,
    loss_stage2: i64,
    _total_stage2: i64,
    rng: &mut R,
) -> (Option<i64>, Option<i64>, Option<i64>) {
    let Some(fly_count) = fly_count else {
        return (None, None, None);
    };
    let sprite_total = fly_count.max(0) as usize;
    if sprite_total == 0 {
        return (Some(0), Some(0), Some(0));
    }

    // main.js `_planeDamage` behavior:
    // 1) budget = sprite_total * min(lostcount, count) / count
    // 2) randomly pick each sprite at most once, reducing `power` (initially 1)
    // 3) stage2 continues with stage1 `power` values (carry-over)
    let count = total_stage1.max(0);
    let mut powers = vec![1.0_f64; sprite_total];
    let _stage1 = apply_sprite_budget_damage(count, loss_stage1, &mut powers, rng);
    let _stage2 = apply_sprite_budget_damage(count, loss_stage2, &mut powers, rng);

    // Conservation law: fly_count = crashed + damaged + normal_survived
    // After both stages, classify final sprite states by final power values:
    // - crashed: power == 0 (completely destroyed)
    // - damaged: 0 < power < 1 (partial damage)
    // - non_normal = crashed + damaged (all affected sprites)
    let unique_crashed = powers.iter().filter(|&&p| p <= f64::EPSILON).count() as i64;
    let unique_damaged = powers.iter().filter(|&&p| p > f64::EPSILON && p < 1.0).count() as i64;
    let unique_non_normal = unique_crashed + unique_damaged;

    (
        Some(unique_crashed),
        Some(unique_damaged),
        Some(unique_non_normal),
    )
}

/// Returns `(unique_crash, unique_damage, unique_non_normal)` satisfying conservation law.
/// - unique_crash: distinct sprites that were completely destroyed (power == 0)
/// - unique_damage: distinct sprites that received partial damage (0 < power < 1)
/// - unique_non_normal: crashed + damaged (all affected sprites, always <= fly_count)
/// Conservation holds: fly_count = unique_crash + unique_damage + normal_survived
fn calc_sprite_motion_total(
    fly_count: Option<i64>,
    loss_stage1: i64,
    total_stage1: i64,
    loss_stage2: i64,
    total_stage2: i64,
) -> Option<(i64, i64, i64)> {
    fly_count?;
    let (unique_crashed, unique_damaged, unique_non_normal) =
        calc_sprite_motion_stage_counts(
            fly_count,
            loss_stage1,
            total_stage1,
            loss_stage2,
            total_stage2,
        );
    Some((
        unique_crashed.unwrap_or(0),
        unique_damaged.unwrap_or(0),
        unique_non_normal.unwrap_or(0),
    ))
}

#[derive(Debug, Clone, Copy, Default)]
struct SpriteMotionCount {
    crashed: i64,
    damaged: i64,
}

fn apply_sprite_budget_damage<R: Rng + ?Sized>(
    count: i64,
    lost_count: i64,
    powers: &mut [f64],
    rng: &mut R,
) -> SpriteMotionCount {
    if count <= 0 || lost_count <= 0 || powers.is_empty() {
        return SpriteMotionCount::default();
    }

    let ratio = (lost_count.min(count).max(0) as f64) / count as f64;
    let mut budget = powers.len() as f64 * ratio;
    if budget <= 0.0 {
        return SpriteMotionCount::default();
    }

    let mut candidates: Vec<usize> = (0..powers.len()).collect();
    let mut motion = SpriteMotionCount::default();

    while !candidates.is_empty() && budget > 0.0 {
        let candidate_index = rng.gen_range(0..candidates.len());
        let sprite_index = candidates.swap_remove(candidate_index);
        let power = powers[sprite_index];
        if power > 0.0 {
            let delta = budget.min(power);
            budget -= delta;
            let next_power = power - delta;
            if next_power <= f64::EPSILON {
                powers[sprite_index] = 0.0;
                motion.crashed += 1;
            } else {
                powers[sprite_index] = next_power;
                motion.damaged += 1;
            }
        }
    }

    motion
}

#[cfg(test)]
fn calc_sprite_crash_total(
    fly_count: Option<i64>,
    loss_stage1: i64,
    total_stage1: i64,
    loss_stage2: i64,
    total_stage2: i64,
) -> Option<i64> {
    fly_count?;
    let (stage1, stage2) = calc_sprite_crash_stage_counts(
        fly_count,
        loss_stage1,
        total_stage1,
        loss_stage2,
        total_stage2,
    );
    Some(stage1.unwrap_or(0) + stage2.unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::{
        calc_sprite_crash_stage_counts, calc_sprite_motion_stage_counts_with_rng,
        calc_sprite_crash_total, count_friend_sprite_fly_from_optional_airbase_squadrons,
        count_sprite_fly_from_capacity, parse_plane_from_side, should_include_friend_escort,
    };
    use rand::SeedableRng;

    #[test]
    fn optional_airbase_squadrons_none_is_zero() {
        let counts = vec![Some(18), None, Some(5), Some(0)];
        // 18 -> 2 sprites, None(0) -> 0, 5 -> 1, 0 -> 0
        assert_eq!(
            count_friend_sprite_fly_from_optional_airbase_squadrons(Some(&counts)),
            Some(3)
        );
    }

    #[test]
    fn sprite_crash_none_when_fly_unknown() {
        let (s1, s2) = calc_sprite_crash_stage_counts(None, 10, 30, 5, 20);
        assert_eq!(s1, None);
        assert_eq!(s2, None);
        assert_eq!(calc_sprite_crash_total(None, 10, 30, 5, 20), None);
    }

    #[test]
    fn sprite_crash_zero_when_no_aircraft() {
        // total=0 → no aircraft, no crashes
        let (s1, s2) = calc_sprite_crash_stage_counts(Some(5), 0, 0, 0, 0);
        assert_eq!(s1, Some(0));
        assert_eq!(s2, Some(0));
    }

    #[test]
    fn sprite_crash_total_is_sum_of_stages() {
        let total = calc_sprite_crash_total(Some(3), 50, 50, 50, 50);
        assert_eq!(total, Some(3));
    }

    #[test]
    fn fly_count_filtered_by_plane_from() {
        // capacity: ship0=3, ship1=2, ship2=1
        let capacity: Vec<Option<i64>> = vec![Some(3), Some(2), Some(1)];
        // Only ships 0 and 2 attacked in stage3
        assert_eq!(
            count_sprite_fly_from_capacity(Some(&capacity), Some(&[0, 2])),
            Some(4)
        );
        // No stage3 participation → 0 sprites, matching game (empty planes_f)
        assert_eq!(
            count_sprite_fly_from_capacity(Some(&capacity), Some(&[])),
            Some(0)
        );
        // No plane_from data → fall back to all ships
        assert_eq!(
            count_sprite_fly_from_capacity(Some(&capacity), None),
            Some(6)
        );
    }

    #[test]
    fn fly_count_zero_when_plane_from_ships_have_no_aircraft() {
        // Ship at index 0 has no qualifying equipment.
        // Game creates 0 sprites → crash count must also be 0.
        let capacity: Vec<Option<i64>> = vec![Some(0), Some(2), Some(1)];
        assert_eq!(count_sprite_fly_from_capacity(Some(&capacity), Some(&[0])), Some(0));
    }

    #[test]
    fn fly_count_some_empty_when_plane_from_sub_array_is_null() {
        // plane_from exists but the friend sub-array is null → game uses [] → 0 sprites.
        // Represented as Some([]) after the fix in calc_air_damage (tested via
        // count_sprite_fly_from_capacity with an empty slice).
        let capacity: Vec<Option<i64>> = vec![Some(2), Some(3)];
        assert_eq!(count_sprite_fly_from_capacity(Some(&capacity), Some(&[])), Some(0));
    }

    #[test]
    fn should_include_friend_escort_requires_positive_combined_flag() {
        assert!(!should_include_friend_escort(None, 1));
        assert!(!should_include_friend_escort(Some(0), 1));
        assert!(should_include_friend_escort(Some(1), 1));
    }

    #[test]
    fn should_include_friend_escort_only_for_first_deck() {
        assert!(!should_include_friend_escort(Some(1), 2));
    }

    #[test]
    fn parse_plane_from_side_none_when_plane_from_absent() {
        assert_eq!(parse_plane_from_side(None, 0), None);
    }

    #[test]
    fn parse_plane_from_side_some_empty_when_side_missing() {
        let plane_from = vec![Some(vec![1, 3])];
        assert_eq!(parse_plane_from_side(Some(&plane_from), 1), Some(vec![]));
    }

    #[test]
    fn parse_plane_from_side_converts_to_zero_based() {
        let plane_from = vec![Some(vec![1, 3]), Some(vec![2])];
        assert_eq!(parse_plane_from_side(Some(&plane_from), 0), Some(vec![0, 2]));
        assert_eq!(parse_plane_from_side(Some(&plane_from), 1), Some(vec![1]));
    }

    #[test]
    fn parse_plane_from_side_matches_fixture_style_one_based_data() {
        let plane_from = vec![Some(vec![1, 2]), None];
        assert_eq!(parse_plane_from_side(Some(&plane_from), 0), Some(vec![0, 1]));
        assert_eq!(parse_plane_from_side(Some(&plane_from), 1), Some(vec![]));
    }

    // Conservation law: crash + damage + non_normal must satisfy unique sprite classification.
    // Verify that fly_count = crash + damage + non_normal (all unique, never double-counted).
    #[test]
    fn conservation_law_crash_damage_non_normal() {
        // Try a variety of seeds and parameter combinations to validate conservation formula.
        for seed in 0..200u64 {
            let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
            let fly = 2i64;
            let (crash, damage, non_normal) =
                calc_sprite_motion_stage_counts_with_rng(Some(fly), 10, 10, 10, 10, &mut rng);
            let c = crash.unwrap_or(0);
            let d = damage.unwrap_or(0);
            let nn = non_normal.unwrap_or(0);
            // non_normal must equal crash + damage
            assert_eq!(
                nn, c + d,
                "seed={seed}: non_normal={nn} != crash={c} + damage={d}"
            );
            // The sum must never exceed fly_count (conservation law holds)
            assert!(
                nn <= fly,
                "seed={seed}: non_normal={nn} > fly={fly}"
            );
        }
    }

    #[test]
    fn damaged_in_stage1_then_crashed_in_stage2_counted_once() {
        // fly=1, stage1 partial hit (budget=0.5), stage2 finishes it off (budget=0.5).
        // Same sprite in both stages -> crash + damage must equal unique count (1).
        for seed in 0..100u64 {
            let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
            let fly = 1i64;
            let (crash, damage, non_normal) =
                calc_sprite_motion_stage_counts_with_rng(Some(fly), 5, 10, 5, 10, &mut rng);
            let nn = non_normal.unwrap_or(0);
            assert!(
                nn <= fly,
                "seed={seed}: non_normal={nn} > fly={fly} (crash={crash:?} damage={damage:?})"
            );
        }
    }

    #[test]
    fn non_normal_count_zero_when_no_losses() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        // loss1=0, loss2=0 -> no sprites touched -> crash=0, damage=0, non_normal=0
        let (crash, damage, non_normal) =
            calc_sprite_motion_stage_counts_with_rng(Some(6), 0, 30, 0, 30, &mut rng);
        assert_eq!(crash, Some(0));
        assert_eq!(damage, Some(0));
        assert_eq!(non_normal, Some(0));
    }

    #[test]
    fn conservation_law_all_losses() {
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        // All planes lost in stage1 -> all should be marked as crashed (unique)
        let fly = 4i64;
        let (crash, damage, non_normal) =
            calc_sprite_motion_stage_counts_with_rng(Some(fly), 30, 30, 0, 30, &mut rng);
        let c = crash.unwrap_or(0);
        let d = damage.unwrap_or(0);
        let nn = non_normal.unwrap_or(0);
        // When all are destroyed, damage should be 0 and non_normal should equal fly
        assert_eq!(d, 0, "all destroyed should have damage=0");
        assert_eq!(nn, fly, "all destroyed should have non_normal=fly");
        assert_eq!(c, fly, "all destroyed should have crash=fly");
    }
}

pub(super) fn apply_sprite_metrics(battle: &mut Battle) {
    let f_air_war = build_friend_ship_sprite_capacity(battle.deck_id, SpritePlaneTypeSet::AirWar);
    let e_air_war =
        build_enemy_ship_sprite_capacity(battle.e_slot.clone(), SpritePlaneTypeSet::AirWar);
    let f_air_war_jet =
        build_friend_ship_sprite_capacity(battle.deck_id, SpritePlaneTypeSet::AirWarJet);
    let e_air_war_jet =
        build_enemy_ship_sprite_capacity(battle.e_slot.clone(), SpritePlaneTypeSet::AirWarJet);
    let e_air_unit =
        build_enemy_ship_sprite_capacity(battle.e_slot.clone(), SpritePlaneTypeSet::AirUnit);
    let e_air_unit_jet =
        build_enemy_ship_sprite_capacity(battle.e_slot.clone(), SpritePlaneTypeSet::AirUnitJet);

    if let Some(opening_air_attack) = battle.opening_air_attack.as_mut() {
        for attack in opening_air_attack.iter_mut().flatten() {
            attack.f_sprite_fly_count = count_sprite_fly_from_capacity(
                f_air_war.as_ref(),
                attack.f_damage.plane_from.as_deref(),
            );
            attack.e_sprite_fly_count = count_sprite_fly_from_capacity(
                e_air_war.as_ref(),
                attack.e_damage.plane_from.as_deref(),
            );
            let (f_crash, f_damage, f_non_normal) =
                calc_sprite_motion_stage_counts(
                attack.f_sprite_fly_count,
                attack.f_damage.loss_plane1,
                attack.f_damage.total_plane1,
                attack.f_damage.loss_plane2,
                attack.f_damage.total_plane2,
            );
            let (e_crash, e_damage, e_non_normal) =
                calc_sprite_motion_stage_counts(
                attack.e_sprite_fly_count,
                attack.e_damage.loss_plane1,
                attack.e_damage.total_plane1,
                attack.e_damage.loss_plane2,
                attack.e_damage.total_plane2,
            );
            attack.f_sprite_crash_count = f_crash;
            attack.e_sprite_crash_count = e_crash;
            attack.f_sprite_damage_count = f_damage;
            attack.e_sprite_damage_count = e_damage;
            attack.f_sprite_non_normal_count = f_non_normal;
            attack.e_sprite_non_normal_count = e_non_normal;
        }
    }

    if let Some(carrier_base_assault) = battle.carrier_base_assault.as_mut() {
        carrier_base_assault.f_sprite_fly_count = count_sprite_fly_from_capacity(
            f_air_war_jet.as_ref(),
            carrier_base_assault.f_damage.plane_from.as_deref(),
        );
        carrier_base_assault.e_sprite_fly_count = count_sprite_fly_from_capacity(
            e_air_war_jet.as_ref(),
            carrier_base_assault.e_damage.plane_from.as_deref(),
        );
        let (f_crash, f_damage, f_non_normal) = calc_sprite_motion_stage_counts(
            carrier_base_assault.f_sprite_fly_count,
            carrier_base_assault.f_damage.loss_plane1,
            carrier_base_assault.f_damage.total_plane1,
            carrier_base_assault.f_damage.loss_plane2,
            carrier_base_assault.f_damage.total_plane2,
        );
        let (e_crash, e_damage, e_non_normal) = calc_sprite_motion_stage_counts(
            carrier_base_assault.e_sprite_fly_count,
            carrier_base_assault.e_damage.loss_plane1,
            carrier_base_assault.e_damage.total_plane1,
            carrier_base_assault.e_damage.loss_plane2,
            carrier_base_assault.e_damage.total_plane2,
        );
        carrier_base_assault.f_sprite_crash_count = f_crash;
        carrier_base_assault.e_sprite_crash_count = e_crash;
        carrier_base_assault.f_sprite_damage_count = f_damage;
        carrier_base_assault.e_sprite_damage_count = e_damage;
        carrier_base_assault.f_sprite_non_normal_count = f_non_normal;
        carrier_base_assault.e_sprite_non_normal_count = e_non_normal;
    }

    if let Some(air_base_assault) = battle.air_base_assault.as_mut() {
        air_base_assault.f_sprite_fly_count = Some(count_friend_sprite_fly_from_airbase_squadrons(
            &air_base_assault.squadron_count,
        ));
        air_base_assault.e_sprite_fly_count = count_sprite_fly_from_capacity(
            e_air_unit_jet.as_ref(),
            air_base_assault.e_damage.plane_from.as_deref(),
        );
        let (f_crash, f_damage, f_non_normal) = calc_sprite_motion_stage_counts(
            air_base_assault.f_sprite_fly_count,
            air_base_assault.f_damage.loss_plane1,
            air_base_assault.f_damage.total_plane1,
            air_base_assault.f_damage.loss_plane2,
            air_base_assault.f_damage.total_plane2,
        );
        let (e_crash, e_damage, e_non_normal) = calc_sprite_motion_stage_counts(
            air_base_assault.e_sprite_fly_count,
            air_base_assault.e_damage.loss_plane1,
            air_base_assault.e_damage.total_plane1,
            air_base_assault.e_damage.loss_plane2,
            air_base_assault.e_damage.total_plane2,
        );
        air_base_assault.f_sprite_crash_count = f_crash;
        air_base_assault.e_sprite_crash_count = e_crash;
        air_base_assault.f_sprite_damage_count = f_damage;
        air_base_assault.e_sprite_damage_count = e_damage;
        air_base_assault.f_sprite_non_normal_count = f_non_normal;
        air_base_assault.e_sprite_non_normal_count = e_non_normal;
    }

    if let Some(air_base_air_attacks) = battle.air_base_air_attacks.as_mut() {
        for attack in &mut air_base_air_attacks.attacks {
            attack.f_sprite_fly_count = count_friend_sprite_fly_from_optional_airbase_squadrons(
                attack.squadron_count.as_ref(),
            );
            attack.e_sprite_fly_count = count_sprite_fly_from_capacity(
                e_air_unit.as_ref(),
                attack.e_damage.plane_from.as_deref(),
            );
            let (f_crash, f_damage, f_non_normal) =
                calc_sprite_motion_stage_counts(
                attack.f_sprite_fly_count,
                attack.f_damage.loss_plane1,
                attack.f_damage.total_plane1,
                attack.f_damage.loss_plane2,
                attack.f_damage.total_plane2,
            );
            let (e_crash, e_damage, e_non_normal) =
                calc_sprite_motion_stage_counts(
                attack.e_sprite_fly_count,
                attack.e_damage.loss_plane1,
                attack.e_damage.total_plane1,
                attack.e_damage.loss_plane2,
                attack.e_damage.total_plane2,
            );
            attack.f_sprite_crash_count = f_crash;
            attack.e_sprite_crash_count = e_crash;
            attack.f_sprite_damage_count = f_damage;
            attack.e_sprite_damage_count = e_damage;
            attack.f_sprite_non_normal_count = f_non_normal;
            attack.e_sprite_non_normal_count = e_non_normal;
        }
    }

    if let Some(support_airattack) = battle
        .support_attack
        .as_mut()
        .and_then(|attack| attack.support_airatack.as_mut())
    {
        support_airattack.f_sprite_fly_count =
            count_support_friend_sprite_fly_from_ship_ids(&support_airattack.ship_id);
        support_airattack.e_sprite_fly_count = count_sprite_fly_from_capacity(
            e_air_war.as_ref(),
            support_airattack.e_damage.plane_from.as_deref(),
        );
        let f_motion = calc_sprite_motion_total(
            support_airattack.f_sprite_fly_count,
            support_airattack.f_damage.loss_plane1,
            support_airattack.f_damage.total_plane1,
            support_airattack.f_damage.loss_plane2,
            support_airattack.f_damage.total_plane2,
        );
        let e_motion = calc_sprite_motion_total(
            support_airattack.e_sprite_fly_count,
            support_airattack.e_damage.loss_plane1,
            support_airattack.e_damage.total_plane1,
            support_airattack.e_damage.loss_plane2,
            support_airattack.e_damage.total_plane2,
        );
        support_airattack.f_sprite_crash_count = f_motion.map(|(crash, _, _)| crash);
        support_airattack.e_sprite_crash_count = e_motion.map(|(crash, _, _)| crash);
        support_airattack.f_sprite_damage_count = f_motion.map(|(_, damage, _)| damage);
        support_airattack.e_sprite_damage_count = e_motion.map(|(_, damage, _)| damage);
        support_airattack.f_sprite_non_normal_count = f_motion.map(|(_, _, non_normal)| non_normal);
        support_airattack.e_sprite_non_normal_count = e_motion.map(|(_, _, non_normal)| non_normal);
    }
}

impl From<kcapi_main::api_req_sortie::battleresult::ApiData> for InterfaceWrapper<BattleResult> {
    fn from(battle_result: kcapi_main::api_req_sortie::battleresult::ApiData) -> Self {
        let landing_hp_now = battle_result
            .clone()
            .api_landing_hp
            .and_then(|landing_hp| landing_hp.api_now_hp.trim().parse::<i64>().ok());
        let landing_hp_max = battle_result
            .clone()
            .api_landing_hp
            .and_then(|landing_hp| landing_hp.api_max_hp.trim().parse::<i64>().ok());
        let landing_sub_value = battle_result
            .clone()
            .api_landing_hp
            .and_then(|landing_hp| parse_landing_hp(landing_hp.api_sub_value));
        Self(BattleResult {
            win_rank: battle_result.api_win_rank,
            drop_ship_id: battle_result.api_get_ship.map(|ship| ship.api_ship_id),
            landing_hp_now,
            landing_hp_max,
            landing_sub_value,
        })
    }
}

impl From<kcapi_common::common_air::ApiAirBaseAttack> for InterfaceWrapper<AirBaseAirAttack> {
    fn from(air_base_air_attack: kcapi_common::common_air::ApiAirBaseAttack) -> Self {
        let (f_damage, e_damage) = calc_air_damage(
            air_base_air_attack.api_plane_from.clone(),
            air_base_air_attack.api_stage1.clone(),
            air_base_air_attack.api_stage2.clone(),
            air_base_air_attack.api_stage3.clone(),
            air_base_air_attack.api_stage3_combined.clone(),
        );
        let squadron_plane_src = air_base_air_attack.api_squadron_plane.clone();
        Self(AirBaseAirAttack {
            stage_flag: air_base_air_attack.api_stage_flag,
            squadron_plane: squadron_plane_src.clone().map(|squadron_planes| {
                squadron_planes
                    .iter()
                    .map(|squadron_plane| squadron_plane.api_mst_id)
                    .collect()
            }),
            squadron_count: squadron_plane_src.map(|squadron_planes| {
                squadron_planes
                    .iter()
                    .map(|squadron_plane| squadron_plane.api_count)
                    .collect()
            }),
            base_id: air_base_air_attack.api_base_id,
            f_damage,
            e_damage,
            f_sprite_fly_count: None,
            e_sprite_fly_count: None,
            f_sprite_crash_count: None,
            e_sprite_crash_count: None,
            f_sprite_damage_count: None,
            e_sprite_damage_count: None,
            f_sprite_non_normal_count: None,
            e_sprite_non_normal_count: None,
            f_sprite_crash_stage1_count: None,
            f_sprite_crash_stage2_count: None,
            e_sprite_crash_stage1_count: None,
            e_sprite_crash_stage2_count: None,
            f_sprite_damage_stage1_count: None,
            f_sprite_damage_stage2_count: None,
            e_sprite_damage_stage1_count: None,
            e_sprite_damage_stage2_count: None,
        })
    }
}

impl From<Vec<kcapi_common::common_air::ApiAirBaseAttack>> for InterfaceWrapper<AirBaseAirAttacks> {
    fn from(air_base_air_attacks: Vec<kcapi_common::common_air::ApiAirBaseAttack>) -> Self {
        Self(AirBaseAirAttacks {
            attacks: air_base_air_attacks
                .into_iter()
                .map(|air_base_air_attack| {
                    InterfaceWrapper::<AirBaseAirAttack>::from(air_base_air_attack).unwrap()
                })
                .collect(),
        })
    }
}

pub fn calc_air_damage(
    plane_from: Option<Vec<Option<Vec<i64>>>>,
    stage1: Option<kcapi_common::common_air::ApiStage1>,
    stage2: Option<kcapi_common::common_air::ApiStage2>,
    stage3: Option<kcapi_common::common_air::ApiStage3>,
    stage3_combined: Option<kcapi_common::common_air::ApiStage3>,
) -> (AirDamage, AirDamage) {
    let f_damages: Option<Vec<f32>> = stage3
        .clone()
        .and_then(|stage3| stage3.api_fdam.map(|f_damages| calc_floor(&f_damages)));
    let e_damages: Option<Vec<f32>> = stage3
        .clone()
        .and_then(|stage3| stage3.api_edam.map(|e_damages| calc_floor(&e_damages)));
    let f_damages_combined: Option<Vec<f32>> =
        stage3_combined.clone().and_then(|stage3_combined| {
            stage3_combined
                .api_fdam
                .map(|f_damages| calc_floor(&f_damages))
        });
    let e_damages_combined: Option<Vec<f32>> =
        stage3_combined.clone().and_then(|stage3_combined| {
            stage3_combined
                .api_edam
                .map(|e_damages| calc_floor(&e_damages))
        });

    let f_cl: Option<Vec<i64>> = stage3.clone().and_then(|stage3| {
        stage3
            .api_fcl_flag
            .map(|f_cl| calc_critical(&f_damages.clone().unwrap_or(vec![0_f32; f_cl.len()]), &f_cl))
    });
    let e_cl: Option<Vec<i64>> = stage3.clone().and_then(|stage3| {
        stage3
            .api_ecl_flag
            .map(|e_cl| calc_critical(&e_damages.clone().unwrap_or(vec![0_f32; e_cl.len()]), &e_cl))
    });
    let f_cl_combined: Option<Vec<i64>> = stage3_combined.clone().and_then(|stage3_combined| {
        stage3_combined.api_fcl_flag.map(|f_cl| {
            calc_critical(
                &f_damages_combined
                    .clone()
                    .unwrap_or(vec![0_f32; f_cl.len()]),
                &f_cl,
            )
        })
    });
    let e_cl_combined: Option<Vec<i64>> = stage3_combined.clone().and_then(|stage3_combined| {
        stage3_combined.api_ecl_flag.map(|e_cl| {
            calc_critical(
                &e_damages_combined
                    .clone()
                    .unwrap_or(vec![0_f32; e_cl.len()]),
                &e_cl,
            )
        })
    });

    // Air stage damage paths do not trigger cover shield semantics.
    let f_protect: Option<Vec<bool>> = stage3
        .clone()
        .and_then(|stage3| stage3.api_fdam.map(|values| vec![false; values.len()]));
    let e_protect: Option<Vec<bool>> = stage3
        .clone()
        .and_then(|stage3| stage3.api_edam.map(|values| vec![false; values.len()]));
    let f_protect_combined: Option<Vec<bool>> = stage3_combined
        .clone()
        .and_then(|stage3| stage3.api_fdam.map(|values| vec![false; values.len()]));
    let e_protect_combined: Option<Vec<bool>> = stage3_combined
        .clone()
        .and_then(|stage3| stage3.api_edam.map(|values| vec![false; values.len()]));

    let f_sp: Option<Vec<Option<Vec<i64>>>> =
        stage3.clone().and_then(|stage3| stage3.api_f_sp_list);
    let e_sp: Option<Vec<Option<Vec<i64>>>> =
        stage3.clone().and_then(|stage3| stage3.api_e_sp_list);
    let f_sp_combined: Option<Vec<Option<Vec<i64>>>> = stage3_combined
        .clone()
        .and_then(|stage3_combined| stage3_combined.api_f_sp_list);
    let e_sp_combined: Option<Vec<Option<Vec<i64>>>> = stage3_combined
        .clone()
        .and_then(|stage3_combined| stage3_combined.api_e_sp_list);

    let f_rai_flag: Option<Vec<Option<i64>>> =
        stage3.clone().and_then(|stage3| stage3.api_frai_flag);
    let f_bak_flag: Option<Vec<Option<i64>>> =
        stage3.clone().and_then(|stage3| stage3.api_fbak_flag);
    let f_rai_flag_combined: Option<Vec<Option<i64>>> = stage3_combined
        .clone()
        .and_then(|stage3_combined| stage3_combined.api_frai_flag);
    let f_bak_flag_combined: Option<Vec<Option<i64>>> = stage3_combined
        .clone()
        .and_then(|stage3_combined| stage3_combined.api_fbak_flag);

    let e_rai_flag: Option<Vec<Option<i64>>> =
        stage3.clone().and_then(|stage3| stage3.api_erai_flag);
    let e_bak_flag: Option<Vec<Option<i64>>> =
        stage3.clone().and_then(|stage3| stage3.api_ebak_flag);
    let e_rai_flag_combined: Option<Vec<Option<i64>>> = stage3_combined
        .clone()
        .and_then(|stage3_combined| stage3_combined.api_erai_flag);
    let e_bak_flag_combined: Option<Vec<Option<i64>>> = stage3_combined
        .clone()
        .and_then(|stage3_combined| stage3_combined.api_ebak_flag);

    // api_plane_from layout: [friend_indices, enemy_indices]
    // Raw indices are 1-based in the API, so normalize them to zero-based here.
    // Each sub-array may be null (= side did not participate → 0 sprites, shown as Some([])).
    // When api_plane_from is absent entirely, keep None so fly_count falls back to all ships.
    let f_plane_from: Option<Vec<i64>> = parse_plane_from_side(plane_from.as_ref(), 0);
    let e_plane_from: Option<Vec<i64>> = parse_plane_from_side(plane_from.as_ref(), 1);

    // let f_now_hps = vec![0; f_damages.clone().and_then(|f_damages| Some(f_damages.len())).unwrap_or(12)];
    // let e_now_hps = vec![0; e_damages.clone().and_then(|e_damages| Some(e_damages.len())).unwrap_or(12)];
    let f_now_hps = vec![0; 12];
    let e_now_hps = vec![0; 12];

    (
        AirDamage {
            plane_from: f_plane_from,
            touch_plane: stage1
                .clone()
                .and_then(|stage1| stage1.api_touch_plane.map(|touch_plane| touch_plane[0])),
            total_plane1: stage1.clone().map(|stage1| stage1.api_f_count).unwrap_or(0),
            loss_plane1: stage1
                .clone()
                .map(|stage1| stage1.api_f_lostcount)
                .unwrap_or(0),
            total_plane2: stage2.clone().map(|stage2| stage2.api_f_count).unwrap_or(0),
            loss_plane2: stage2
                .clone()
                .map(|stage2| stage2.api_f_lostcount)
                .unwrap_or(0),
            damages: combine(&[f_damages, f_damages_combined]),
            cl: combine(&[f_cl, f_cl_combined]),
            sp: combine(&[f_sp, f_sp_combined]),
            rai_flag: combine(&[f_rai_flag, f_rai_flag_combined]),
            bak_flag: combine(&[f_bak_flag, f_bak_flag_combined]),
            protect_flag: combine(&[f_protect, f_protect_combined]),
            now_hps: f_now_hps,
        },
        AirDamage {
            plane_from: e_plane_from,
            touch_plane: stage1
                .clone()
                .and_then(|stage1| stage1.api_touch_plane.map(|touch_plane| touch_plane[1])),
            total_plane1: stage1.clone().map(|stage1| stage1.api_e_count).unwrap_or(0),
            loss_plane1: stage1
                .clone()
                .map(|stage1| stage1.api_e_lostcount)
                .unwrap_or(0),
            total_plane2: stage2
                .clone()
                .map(|stage2| stage2.api_e_count.unwrap_or(0))
                .unwrap_or(0),
            loss_plane2: stage2
                .clone()
                .map(|stage2| stage2.api_e_lostcount.unwrap_or(0))
                .unwrap_or(0),
            damages: combine(&[e_damages, e_damages_combined]),
            cl: combine(&[e_cl, e_cl_combined]),
            sp: combine(&[e_sp, e_sp_combined]),
            rai_flag: combine(&[e_rai_flag, e_rai_flag_combined]),
            bak_flag: combine(&[e_bak_flag, e_bak_flag_combined]),
            protect_flag: combine(&[e_protect, e_protect_combined]),
            now_hps: e_now_hps,
        },
    )
}

fn parse_plane_from_side(plane_from: Option<&Vec<Option<Vec<i64>>>>, side_idx: usize) -> Option<Vec<i64>> {
    let plane_from = plane_from?;
    let indices = plane_from
        .get(side_idx)
        .and_then(|entry| entry.as_ref())
        .cloned()
        .unwrap_or_default();
    Some(indices.into_iter().map(|x| x - 1).collect())
}

impl From<kcapi_common::common_air::ApiKouku> for InterfaceWrapper<OpeningAirAttack> {
    fn from(air: kcapi_common::common_air::ApiKouku) -> Self {
        let (f_damage, e_damage) = calc_air_damage(
            air.api_plane_from.clone(),
            air.api_stage1.clone(),
            air.api_stage2.clone(),
            air.api_stage3.clone(),
            air.api_stage3_combined.clone(),
        );
        Self(OpeningAirAttack {
            air_superiority: air
                .api_stage1
                .clone()
                .and_then(|stage1| stage1.api_disp_seiku),
            air_fire: match air
                .api_stage2
                .clone()
                .and_then(|stage2| stage2.api_air_fire)
            {
                Some(air_fire) => Some(AirFire {
                    use_item: air_fire.api_use_items,
                    idx: air_fire.api_idx,
                }),
                None => None,
            },
            f_damage,
            e_damage,
            f_sprite_fly_count: None,
            e_sprite_fly_count: None,
            f_sprite_crash_count: None,
            e_sprite_crash_count: None,
            f_sprite_damage_count: None,
            e_sprite_damage_count: None,
            f_sprite_non_normal_count: None,
            e_sprite_non_normal_count: None,
            f_sprite_crash_count_stage1: None,
            f_sprite_crash_count_stage2: None,
            e_sprite_crash_count_stage1: None,
            e_sprite_crash_count_stage2: None,
            f_sprite_damage_count_stage1: None,
            f_sprite_damage_count_stage2: None,
            e_sprite_damage_count_stage1: None,
            e_sprite_damage_count_stage2: None,
        })
    }
}

impl From<kcapi_common::common_battle::ApiOpeningTaisen> for InterfaceWrapper<OpeningTaisen> {
    fn from(opening_taisen: kcapi_common::common_battle::ApiOpeningTaisen) -> Self {
        let damages: Vec<Vec<f32>> = opening_taisen.api_damage.iter().map(calc_floor).collect();
        let cl_list: Vec<Vec<i64>> = opening_taisen
            .api_cl_list
            .iter()
            .enumerate()
            .map(|(idx, cl_list)| calc_critical(&damages[idx], cl_list))
            .collect();
        let protect_flag: Vec<Vec<bool>> = opening_taisen
            .api_damage
            .iter()
            .map(calc_protect_flag)
            .collect();
        let f_now_hps: Vec<Vec<i64>> = vec![vec![0; 12]; damages.len()];
        let e_now_hps: Vec<Vec<i64>> = vec![vec![0; 12]; damages.len()];

        Self(OpeningTaisen {
            at_list: opening_taisen.api_at_list,
            at_type: opening_taisen.api_at_type,
            df_list: opening_taisen.api_df_list,
            cl_list,
            damage: damages,
            at_eflag: opening_taisen.api_at_eflag,
            si_list: opening_taisen
                .api_si_list
                .iter()
                .map(calc_si_list)
                .collect(),
            protect_flag,
            f_now_hps,
            e_now_hps,
        })
    }
}

impl From<kcapi_common::common_battle::ApiOpeningAtack> for InterfaceWrapper<OpeningRaigeki> {
    fn from(opening_raigeki: kcapi_common::common_battle::ApiOpeningAtack) -> Self {
        let f_damages: Vec<f32> = calc_floor(&opening_raigeki.api_fdam);
        let f_protect_flag: Vec<bool> =
            calc_opening_ydam_protect_flag(&opening_raigeki.api_fydam_list_items);
        let e_damages: Vec<f32> = calc_floor(&opening_raigeki.api_edam);
        // Client behavior uses fydam_list_items path even for enemy shield checks.
        let e_protect_flag: Vec<bool> =
            calc_opening_ydam_protect_flag(&opening_raigeki.api_fydam_list_items);

        let f_cl_list = calc_critical(
            &f_damages,
            &opening_raigeki
                .api_fcl_list_items
                .clone()
                .iter()
                .map(|fcl_list| {
                    fcl_list
                        .clone()
                        .map(|fcl| calc_max_critical(&fcl))
                        .unwrap_or(0)
                })
                .collect::<Vec<i64>>(),
        );
        let e_cl_list = calc_critical(
            &e_damages,
            &opening_raigeki
                .api_ecl_list_items
                .clone()
                .iter()
                .map(|ecl_list| {
                    ecl_list
                        .clone()
                        .map(|ecl| calc_max_critical(&ecl))
                        .unwrap_or(0)
                })
                .collect::<Vec<i64>>(),
        );

        Self(OpeningRaigeki {
            fdam: f_damages,
            edam: e_damages,
            // fydam_list_items: opening_raigeki.api_fydam_list_items,
            // eydam_list_items: opening_raigeki.api_eydam_list_items,
            frai_list_items: opening_raigeki.api_frai_list_items,
            erai_list_items: opening_raigeki.api_erai_list_items,
            fcl_list: f_cl_list,
            ecl_list: e_cl_list,
            f_protect_flag,
            e_protect_flag,
            f_now_hps: vec![0; 12],
            e_now_hps: vec![0; 12],
        })
    }
}

impl From<kcapi_common::common_battle::ApiRaigeki> for InterfaceWrapper<ClosingRaigeki> {
    fn from(closing_raigeki: kcapi_common::common_battle::ApiRaigeki) -> Self {
        let f_damages: Vec<f32> = calc_floor(&closing_raigeki.api_fdam);
        let f_cl = calc_critical(&f_damages, &closing_raigeki.api_fcl.to_vec());
        let f_protect_flag: Vec<bool> = calc_protect_flag(&closing_raigeki.api_fydam);
        let e_damages: Vec<f32> = calc_floor(&closing_raigeki.api_edam);
        let e_cl = calc_critical(&e_damages, &closing_raigeki.api_ecl.to_vec());
        // Client behavior uses fydam path even for enemy shield checks.
        let e_protect_flag: Vec<bool> = calc_protect_flag(&closing_raigeki.api_fydam);

        let f_now_hps: Vec<i64> = vec![0; f_damages.len()];
        let e_now_hps: Vec<i64> = vec![0; e_damages.len()];

        Self(ClosingRaigeki {
            fdam: f_damages,
            edam: e_damages,
            // fydam: closing_raigeki.api_fydam,
            // eydam: closing_raigeki.api_eydam,
            frai: closing_raigeki.api_frai,
            erai: closing_raigeki.api_erai,
            fcl: f_cl,
            ecl: e_cl,
            f_protect_flag,
            e_protect_flag,
            f_now_hps,
            e_now_hps,
        })
    }
}

impl From<kcapi_common::common_battle::ApiHougeki> for InterfaceWrapper<Hougeki> {
    fn from(hougeki: kcapi_common::common_battle::ApiHougeki) -> Self {
        let si_list: Vec<Vec<Option<i64>>> = hougeki.api_si_list.iter().map(calc_si_list).collect();

        let damages_raw: Vec<Vec<f32>> = hougeki
            .api_damage
            .iter()
            .enumerate()
            .map(|(idx, damage)| remove_m1(damage, &hougeki.api_df_list[idx]))
            .enumerate()
            .map(|(idx, damages)| {
                match hougeki.api_at_type[idx] {
                    0..=2 => damages,
                    n if n < 100 => {
                        let df_0 = hougeki.api_df_list[idx][0];
                        if hougeki.api_df_list[idx].iter().all(|x| *x == df_0) {
                            return vec![damages.iter().fold(0_f32, |acc, y| acc + *y)];
                        } else {
                            return damages;
                        }
                    }
                    _ => damages,
                }
                .to_vec()
            })
            .collect();

        let damages: Vec<Vec<f32>> = damages_raw.iter().map(calc_floor).collect();

        let cl_list: Vec<Vec<i64>> = hougeki
            .api_cl_list
            .iter()
            .enumerate()
            .map(|(idx, cl_list)| remove_m1(cl_list, &hougeki.api_df_list[idx]))
            .enumerate()
            .map(|(idx, cl_list)| {
                match hougeki.api_at_type[idx] {
                    0..=2 => cl_list,
                    n if n < 100 => {
                        let df_0 = hougeki.api_df_list[idx][0];
                        if hougeki.api_df_list[idx].iter().all(|x| *x == df_0) {
                            return vec![cl_list.iter().max().unwrap_or(&0).to_owned()];
                        } else {
                            return cl_list;
                        }
                    }
                    _ => cl_list,
                }
                .to_vec()
            })
            .enumerate()
            .map(|(idx, cl_list)| calc_critical(&damages[idx], &cl_list))
            .collect();

        let protect_flag: Vec<Vec<bool>> = damages_raw.iter().map(calc_protect_flag).collect();

        let df_list: Vec<Vec<i64>> = hougeki
            .api_df_list
            .iter()
            .enumerate()
            .map(|(idx, df_list)| remove_m1(df_list, &hougeki.api_df_list[idx]))
            .enumerate()
            .map(|(idx, df_list)| {
                match hougeki.api_at_type[idx] {
                    0..=2 => df_list,
                    n if n < 100 => {
                        let df_0 = df_list[0];
                        if df_list.iter().all(|x| *x == df_0) {
                            return vec![df_0];
                        } else {
                            return df_list;
                        }
                    }
                    _ => df_list,
                }
                .to_vec()
            })
            .collect();

        let f_now_hps: Vec<Vec<i64>> = vec![vec![0; 12]; damages.len()];
        let e_now_hps: Vec<Vec<i64>> = vec![vec![0; 12]; damages.len()];

        Self(Hougeki {
            at_list: hougeki.api_at_list,
            at_type: hougeki.api_at_type,
            df_list,
            cl_list,
            damage: damages,
            at_eflag: hougeki.api_at_eflag,
            si_list,
            protect_flag,
            f_now_hps,
            e_now_hps,
        })
    }
}

impl From<kcapi_common::common_midnight::ApiHougeki> for InterfaceWrapper<MidnightHougeki> {
    fn from(hougeki: kcapi_common::common_midnight::ApiHougeki) -> Self {
        let si_list: Option<Vec<Vec<Option<i64>>>> = hougeki.api_si_list.map(|api_si_list| {
            api_si_list
                .iter()
                .map(|si_list| {
                    calc_si_list(&si_list.iter().map(|si| Some(si.to_owned())).collect())
                })
                .collect()
        });

        let damages_raw: Option<Vec<Vec<f32>>> =
            hougeki.api_damage.clone().and_then(|api_damage| {
                hougeki.api_df_list.clone().and_then(|df_list| {
                    hougeki.api_sp_list.clone().map(|api_sp_list| {
                        api_damage
                            .iter()
                            .enumerate()
                            .map(|(idx, damage)| remove_m1(damage, &df_list[idx]))
                            .enumerate()
                            .map(|(idx, damages)| match api_sp_list[idx] {
                                0 | 1 => damages,
                                n if n < 100 => {
                                    let df_0 = df_list[idx][0];
                                    if df_list[idx].iter().all(|x| *x == df_0) {
                                        vec![damages.iter().fold(0_f32, |acc, y| acc + *y)]
                                    } else {
                                        damages
                                    }
                                }
                                _ => damages,
                            })
                            .collect()
                    })
                })
            });

        let damages: Option<Vec<Vec<f32>>> = damages_raw
            .clone()
            .map(|rows| rows.iter().map(calc_floor).collect());

        let cl_list: Option<Vec<Vec<i64>>> = hougeki.api_cl_list.and_then(|api_cl_list| {
            damages.clone().and_then(|damages| {
                hougeki.api_df_list.clone().and_then(|df_list| {
                    hougeki.api_sp_list.clone().map(|api_sp_list| {
                        api_cl_list
                            .iter()
                            .enumerate()
                            .map(|(idx, cl_list)| remove_m1(cl_list, &df_list[idx]))
                            .enumerate()
                            .map(|(idx, cl_list)| match api_sp_list[idx] {
                                0 | 1 => cl_list,
                                n if n < 100 => {
                                    let df_0 = df_list[idx][0];
                                    if df_list[idx].iter().all(|x| *x == df_0) {
                                        vec![cl_list.iter().max().unwrap_or(&0).to_owned()]
                                    } else {
                                        cl_list
                                    }
                                }
                                _ => cl_list,
                            })
                            .enumerate()
                            .map(|(idx, cl_list)| calc_critical(&damages[idx], &cl_list))
                            .collect()
                    })
                })
            })
        });

        let protect_flag: Option<Vec<Vec<bool>>> = damages_raw
            .clone()
            .map(|rows| rows.iter().map(calc_protect_flag).collect());

        let df_list: Option<Vec<Vec<i64>>> = hougeki.api_df_list.and_then(|api_df_list| {
            hougeki.api_sp_list.clone().map(|api_sp_list| {
                api_df_list
                    .iter()
                    .enumerate()
                    .map(|(idx, df_list)| remove_m1(df_list, &api_df_list[idx]))
                    .enumerate()
                    .map(|(idx, df_list)| match api_sp_list[idx] {
                        0 | 1 => df_list,
                        n if n < 100 => {
                            let df_0 = df_list[0];
                            if df_list.iter().all(|x| *x == df_0) {
                                vec![df_0]
                            } else {
                                df_list
                            }
                        }
                        _ => df_list,
                    })
                    .collect()
            })
        });

        let f_now_hps: Vec<Vec<i64>> = damages
            .clone()
            .map(|damages| vec![vec![0; 12]; damages.len()])
            .unwrap_or({
                vec![0; 12];
                vec![] as Vec<Vec<i64>>
            });
        let e_now_hps: Vec<Vec<i64>> = damages
            .clone()
            .map(|damages| vec![vec![0; 12]; damages.len()])
            .unwrap_or({
                vec![0; 12];
                vec![] as Vec<Vec<i64>>
            });

        Self(MidnightHougeki {
            at_list: hougeki.api_at_list,
            df_list,
            cl_list,
            damage: damages,
            at_eflag: hougeki.api_at_eflag,
            si_list,
            sp_list: hougeki.api_sp_list,
            protect_flag,
            f_now_hps,
            e_now_hps,
        })
    }
}

impl From<kcapi_common::common_battle::ApiSupportInfo> for InterfaceWrapper<SupportAttack> {
    fn from(support_info: kcapi_common::common_battle::ApiSupportInfo) -> Self {
        let support_hourai: Option<SupportHourai> = support_info
            .api_support_hourai
            .map(|support_hourai| InterfaceWrapper::from(support_hourai).unwrap());
        let support_airatack: Option<SupportAiratack> = support_info
            .api_support_airatack
            .map(|support_airatack| InterfaceWrapper::from(support_airatack).unwrap());
        Self(SupportAttack {
            support_hourai,
            support_airatack,
        })
    }
}

impl From<kcapi_common::common_battle::ApiSupportHourai> for InterfaceWrapper<SupportHourai> {
    fn from(support_hourai: kcapi_common::common_battle::ApiSupportHourai) -> Self {
        let raw_damage = support_hourai.api_damage.clone();
        let damages: Vec<f32> = calc_floor(&raw_damage);
        let cl_list: Vec<i64> = calc_critical(&damages, &support_hourai.api_cl_list);
        let protect_flag: Vec<bool> = calc_protect_flag(&raw_damage);
        let now_hps: Vec<i64> = vec![0; damages.len()];

        Self(SupportHourai {
            cl_list,
            damage: damages,
            deck_id: support_hourai.api_deck_id,
            ship_id: support_hourai.api_ship_id,
            protect_flag,
            now_hps,
        })
    }
}

impl From<kcapi_common::common_air::ApiSupportAiratack> for InterfaceWrapper<SupportAiratack> {
    fn from(support_airatack: kcapi_common::common_air::ApiSupportAiratack) -> Self {
        let (f_damage, e_damage) = calc_air_damage(
            Some(support_airatack.api_plane_from.clone()),
            Some(support_airatack.api_stage1.clone()),
            Some(support_airatack.api_stage2.clone()),
            Some(support_airatack.api_stage3.clone()),
            support_airatack.api_stage3_combined.clone(),
        );
        Self(SupportAiratack {
            deck_id: support_airatack.api_deck_id,
            ship_id: support_airatack.api_ship_id,
            f_damage,
            e_damage,
            f_sprite_fly_count: None,
            e_sprite_fly_count: None,
            f_sprite_crash_count: None,
            e_sprite_crash_count: None,
            f_sprite_damage_count: None,
            e_sprite_damage_count: None,
            f_sprite_non_normal_count: None,
            e_sprite_non_normal_count: None,
        })
    }
}

impl From<kcapi_common::common_air::ApiAirBaseInjection> for InterfaceWrapper<AirBaseAssult> {
    fn from(air_base_injection: kcapi_common::common_air::ApiAirBaseInjection) -> Self {
        let (f_damage, e_damage) = calc_air_damage(
            Some(air_base_injection.api_plane_from.clone()),
            Some(air_base_injection.api_stage1.clone()),
            Some(air_base_injection.api_stage2.clone()),
            Some(air_base_injection.api_stage3.clone()),
            air_base_injection.api_stage3_combined.clone(),
        );
        Self(AirBaseAssult {
            squadron_plane: air_base_injection
                .api_air_base_data
                .iter()
                .map(|air_base_data| air_base_data.api_mst_id)
                .collect(),
            squadron_count: air_base_injection
                .api_air_base_data
                .iter()
                .map(|air_base_data| air_base_data.api_count)
                .collect(),
            f_damage,
            e_damage,
            f_sprite_fly_count: None,
            e_sprite_fly_count: None,
            f_sprite_crash_count: None,
            e_sprite_crash_count: None,
            f_sprite_damage_count: None,
            e_sprite_damage_count: None,
            f_sprite_non_normal_count: None,
            e_sprite_non_normal_count: None,
            f_sprite_crash_stage1_count: None,
            f_sprite_crash_stage2_count: None,
            e_sprite_crash_stage1_count: None,
            e_sprite_crash_stage2_count: None,
            f_sprite_damage_stage1_count: None,
            f_sprite_damage_stage2_count: None,
            e_sprite_damage_stage1_count: None,
            e_sprite_damage_stage2_count: None,
        })
    }
}

impl From<kcapi_common::common_air::ApiKouku> for InterfaceWrapper<CarrierBaseAssault> {
    fn from(value: kcapi_common::common_air::ApiKouku) -> Self {
        let (f_damage, e_damage) = calc_air_damage(
            value.api_plane_from.clone(),
            value.api_stage1.clone(),
            value.api_stage2.clone(),
            value.api_stage3.clone(),
            value.api_stage3_combined.clone(),
        );
        Self(CarrierBaseAssault {
            f_damage,
            e_damage,
            f_sprite_fly_count: None,
            e_sprite_fly_count: None,
            f_sprite_crash_count: None,
            e_sprite_crash_count: None,
            f_sprite_damage_count: None,
            e_sprite_damage_count: None,
            f_sprite_non_normal_count: None,
            e_sprite_non_normal_count: None,
            f_sprite_crash_stage1_count: None,
            f_sprite_crash_stage2_count: None,
            e_sprite_crash_stage1_count: None,
            e_sprite_crash_stage2_count: None,
            f_sprite_damage_stage1_count: None,
            f_sprite_damage_stage2_count: None,
            e_sprite_damage_stage1_count: None,
            e_sprite_damage_stage2_count: None,
        })
    }
}

impl From<kcapi_common::common_midnight::ApiFriendlyInfo> for InterfaceWrapper<FriendlyForceInfo> {
    fn from(fleet_info: kcapi_common::common_midnight::ApiFriendlyInfo) -> Self {
        Self(FriendlyForceInfo {
            slot_ex: fleet_info.api_slot_ex,
            max_hps: fleet_info.api_maxhps,
            ship_id: fleet_info.api_ship_id,
            params: fleet_info.api_param,
            ship_lv: fleet_info.api_ship_lv,
            now_hps: fleet_info.api_nowhps,
            slot: fleet_info.api_slot,
        })
    }
}

impl From<kcapi_common::common_midnight::ApiFriendlyBattle>
    for InterfaceWrapper<FriendlySupportHourai>
{
    fn from(friendly_support_hourai: kcapi_common::common_midnight::ApiFriendlyBattle) -> Self {
        let flare_pos: Vec<i64> = friendly_support_hourai.api_flare_pos;
        let hougeki: MidnightHougeki =
            InterfaceWrapper::from(friendly_support_hourai.api_hougeki).unwrap();
        Self(FriendlySupportHourai { flare_pos, hougeki })
    }
}

impl InterfaceWrapper<FriendlyForceAttack> {
    pub fn from_api_data(
        friendly_force_info: kcapi_common::common_midnight::ApiFriendlyInfo,
        friendly_support_hourai: kcapi_common::common_midnight::ApiFriendlyBattle,
    ) -> Self {
        let force_info: FriendlyForceInfo = InterfaceWrapper::from(friendly_force_info).unwrap();
        let support_hourai: Option<FriendlySupportHourai> =
            Some(InterfaceWrapper::from(friendly_support_hourai).unwrap());
        Self(FriendlyForceAttack {
            fleet_info: force_info,
            support_hourai,
        })
    }
}

// impl From<kcapi_common::common_battle::ApiFlavorInfo> for  {
//     fn from(flavor_info: kcapi_common::common_battle::ApiFlavorInfo) -> Self {
//         Self {
//             api_flavor_text: flavor_info.api_flavor_text,
//             api_flavor_voice: flavor_info.api_flavor_voice,
//         }
//     }
// }

pub fn calc_dmg(battle: &mut Battle) {
    if battle.battle_order.is_none() {
        return;
    }

    let mut day_flag: bool = false;
    let mut midnight_flag: bool = false;

    let mut f_total_damages: Vec<i64> = vec![0; 12];
    let mut e_total_damages: Vec<i64> = vec![0; 12];
    let mut friend_total_damages: Vec<i64> = vec![0; 6];
    let mut midnight_f_total_damages: Vec<i64> = vec![0; 12];
    let mut midnight_e_total_damages: Vec<i64> = vec![0; 12];

    let f_nowhps: Vec<i64> = battle.f_nowhps.clone().unwrap_or(vec![0; 12]);
    let e_nowhps: Vec<i64> = battle.e_nowhps.clone().unwrap_or(vec![0; 12]);
    let midnight_f_nowhps: Vec<i64> = battle.midnight_f_nowhps.clone().unwrap_or(vec![0; 12]);
    let midnight_e_nowhps: Vec<i64> = battle.midnight_e_nowhps.clone().unwrap_or(vec![0; 12]);
    let friend_nowhps: Vec<i64> = battle
        .friendly_force_attack
        .clone()
        .map(|friendly_force_attack| friendly_force_attack.fleet_info.now_hps.clone())
        .unwrap_or(vec![0; 6]);

    let Some(battle_order) = battle.battle_order.clone() else {
        return;
    };

    battle_order
        .iter()
        .for_each(|battle_order| match battle_order {
            BattleType::AirBaseAssult(()) => {
                if let Some(air_base_assault) = battle.air_base_assault.as_mut() {
                    day_flag = true;

                    f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                        air_base_assault.f_damage.now_hps[idx] = f_nowhp - f_total_damages[idx];
                    });

                    e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                        air_base_assault.e_damage.now_hps[idx] = e_nowhp - e_total_damages[idx];
                    });

                    air_base_assault
                        .f_damage
                        .damages
                        .clone()
                        .unwrap_or(vec![0_f32; 0])
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            f_total_damages[idx] += x as i64;
                        });

                    air_base_assault
                        .e_damage
                        .damages
                        .clone()
                        .unwrap_or(vec![0_f32; 0])
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            e_total_damages[idx] += x as i64;
                        });
                }
            }
            BattleType::CarrierBaseAssault(()) => {
                if let Some(carrier_base_assault) = battle.carrier_base_assault.as_mut() {
                    day_flag = true;

                    f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                        carrier_base_assault.f_damage.now_hps[idx] = f_nowhp - f_total_damages[idx];
                    });

                    e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                        carrier_base_assault.e_damage.now_hps[idx] = e_nowhp - e_total_damages[idx];
                    });

                    carrier_base_assault
                        .f_damage
                        .damages
                        .clone()
                        .unwrap_or(vec![0_f32; 0])
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            f_total_damages[idx] += x as i64;
                        });

                    carrier_base_assault
                        .e_damage
                        .damages
                        .clone()
                        .unwrap_or(vec![0_f32; 0])
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            e_total_damages[idx] += x as i64;
                        });
                }
            }
            BattleType::AirBaseAirAttack(()) => {
                if let Some(air_base_air_attacks) = battle.air_base_air_attacks.as_mut() {
                    day_flag = true;

                    air_base_air_attacks
                        .attacks
                        .iter_mut()
                        .for_each(|air_base_air_attack| {
                            f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                                air_base_air_attack.f_damage.now_hps[idx] =
                                    f_nowhp - f_total_damages[idx];
                            });

                            air_base_air_attack
                                .f_damage
                                .damages
                                .clone()
                                .unwrap_or(vec![0_f32; 0])
                                .iter()
                                .enumerate()
                                .for_each(|(idx, &x)| {
                                    f_total_damages[idx] += x as i64;
                                });
                        });
                    air_base_air_attacks
                        .attacks
                        .iter_mut()
                        .for_each(|air_base_air_attack| {
                            e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                                air_base_air_attack.e_damage.now_hps[idx] =
                                    e_nowhp - e_total_damages[idx];
                            });

                            air_base_air_attack
                                .e_damage
                                .damages
                                .clone()
                                .unwrap_or(vec![0_f32; 0])
                                .iter()
                                .enumerate()
                                .for_each(|(idx, &x)| {
                                    e_total_damages[idx] += x as i64;
                                });
                        });
                }
            }
            BattleType::OpeningAirAttack(x) => {
                if let Some(opening_air_attack_list) = battle.opening_air_attack.as_mut() {
                    day_flag = true;

                    if let Some(opening_air_attack) = opening_air_attack_list[*x as usize].as_mut()
                    {
                        f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                            opening_air_attack.f_damage.now_hps[idx] =
                                f_nowhp - f_total_damages[idx];
                        });
                        e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                            opening_air_attack.e_damage.now_hps[idx] =
                                e_nowhp - e_total_damages[idx];
                        });

                        opening_air_attack
                            .f_damage
                            .damages
                            .clone()
                            .unwrap_or(vec![0_f32; 0])
                            .iter()
                            .enumerate()
                            .for_each(|(idx, &x)| {
                                f_total_damages[idx] += x as i64;
                            });
                        opening_air_attack
                            .e_damage
                            .damages
                            .clone()
                            .unwrap_or(vec![0_f32; 0])
                            .iter()
                            .enumerate()
                            .for_each(|(idx, &x)| {
                                e_total_damages[idx] += x as i64;
                            });
                    }
                }
            }
            BattleType::SupportAttack(()) => {
                if let Some(support_attack) = battle.support_attack.as_mut() {
                    day_flag = true;

                    if let Some(support_hourai) = support_attack.support_hourai.as_mut() {
                        e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                            support_hourai.now_hps[idx] = e_nowhp - e_total_damages[idx];
                        });

                        support_hourai
                            .damage
                            .iter()
                            .enumerate()
                            .for_each(|(idx, &x)| {
                                e_total_damages[idx] += x as i64;
                            });
                    }
                    if let Some(support_airatack) = support_attack.support_airatack.as_mut() {
                        e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                            support_airatack.e_damage.now_hps[idx] = e_nowhp - e_total_damages[idx];
                        });

                        support_airatack
                            .e_damage
                            .damages
                            .clone()
                            .unwrap_or(vec![0_f32; 0])
                            .iter()
                            .enumerate()
                            .for_each(|(idx, &x)| {
                                e_total_damages[idx] += x as i64;
                            });
                    }
                }
            }
            BattleType::OpeningTaisen(()) => {
                if let Some(opening_taisen) = battle.opening_taisen.as_mut() {
                    day_flag = true;

                    opening_taisen
                        .at_eflag
                        .iter()
                        .enumerate()
                        .for_each(|(eflag_idx, &eflag)| {
                            f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                                opening_taisen.f_now_hps[eflag_idx][idx] =
                                    f_nowhp - f_total_damages[idx];
                            });
                            e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                                opening_taisen.e_now_hps[eflag_idx][idx] =
                                    e_nowhp - e_total_damages[idx];
                            });

                            opening_taisen.df_list[eflag_idx]
                                .iter()
                                .enumerate()
                                .for_each(|(df_idx, &df)| match eflag {
                                    1 => {
                                        f_total_damages[df as usize] +=
                                            opening_taisen.damage[eflag_idx][df_idx] as i64;
                                    }
                                    0 => {
                                        e_total_damages[df as usize] +=
                                            opening_taisen.damage[eflag_idx][df_idx] as i64;
                                    }
                                    _ => {}
                                });
                        });
                }
            }
            BattleType::OpeningRaigeki(()) => {
                if let Some(opening_raigeki) = battle.opening_raigeki.as_mut() {
                    day_flag = true;

                    f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                        opening_raigeki.f_now_hps[idx] = f_nowhp - f_total_damages[idx];
                    });
                    e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                        opening_raigeki.e_now_hps[idx] = e_nowhp - e_total_damages[idx];
                    });

                    opening_raigeki
                        .fdam
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            f_total_damages[idx] += x as i64;
                        });
                    opening_raigeki
                        .edam
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            e_total_damages[idx] += x as i64;
                        });
                };
            }
            BattleType::Hougeki(x) => {
                if let Some(hougeki_list) = battle.hougeki.as_mut() {
                    day_flag = true;

                    if let Some(hougeki) = hougeki_list[*x as usize].as_mut() {
                        hougeki
                            .at_eflag
                            .iter()
                            .enumerate()
                            .for_each(|(eflag_idx, &eflag)| {
                                f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                                    hougeki.f_now_hps[eflag_idx][idx] =
                                        f_nowhp - f_total_damages[idx];
                                });
                                e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                                    hougeki.e_now_hps[eflag_idx][idx] =
                                        e_nowhp - e_total_damages[idx];
                                });

                                hougeki.df_list[eflag_idx].iter().enumerate().for_each(
                                    |(df_idx, &df)| match eflag {
                                        1 => {
                                            f_total_damages[df as usize] +=
                                                hougeki.damage[eflag_idx][df_idx] as i64;
                                        }
                                        0 => {
                                            e_total_damages[df as usize] +=
                                                hougeki.damage[eflag_idx][df_idx] as i64;
                                        }
                                        _ => {}
                                    },
                                );
                            });
                    }
                }
            }
            BattleType::ClosingRaigeki(()) => {
                if let Some(closing_taigeki) = battle.closing_raigeki.as_mut() {
                    day_flag = true;

                    f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
                        closing_taigeki.f_now_hps[idx] = f_nowhp - f_total_damages[idx];
                    });
                    e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
                        closing_taigeki.e_now_hps[idx] = e_nowhp - e_total_damages[idx];
                    });

                    closing_taigeki
                        .fdam
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            f_total_damages[idx] += x as i64;
                        });
                    closing_taigeki
                        .edam
                        .iter()
                        .enumerate()
                        .for_each(|(idx, &x)| {
                            e_total_damages[idx] += x as i64;
                        });
                }
            }
            BattleType::FriendlyForceAttack(()) => {
                if let Some(friendly_force_attack) = battle.friendly_force_attack.as_mut() {
                    midnight_flag = true;

                    if let Some(support_hourai) = friendly_force_attack.support_hourai.as_mut() {
                        if let Some(at_eflag) = &support_hourai.hougeki.at_eflag {
                            at_eflag.iter().enumerate().for_each(|(eflag_idx, &eflag)| {
                                if let Some(df_list) = &support_hourai.hougeki.df_list {
                                    friend_nowhps
                                        .iter()
                                        .enumerate()
                                        .for_each(|(idx, &f_nowhp)| {
                                            support_hourai.hougeki.f_now_hps[eflag_idx][idx] =
                                                f_nowhp - friend_total_damages[idx];
                                        });
                                    midnight_e_nowhps.iter().enumerate().for_each(
                                        |(idx, &e_nowhp)| {
                                            support_hourai.hougeki.e_now_hps[eflag_idx][idx] =
                                                e_nowhp - midnight_e_total_damages[idx];
                                        },
                                    );

                                    df_list[eflag_idx].iter().enumerate().for_each(
                                        |(df_idx, &df)| {
                                            if let Some(damage) = &support_hourai.hougeki.damage {
                                                match eflag {
                                                    1 => {
                                                        friend_total_damages[df as usize] +=
                                                            damage[eflag_idx][df_idx] as i64;
                                                    }
                                                    0 => {
                                                        midnight_e_total_damages[df as usize] +=
                                                            damage[eflag_idx][df_idx] as i64;
                                                    }
                                                    _ => {}
                                                }
                                            }
                                        },
                                    );
                                }
                            });
                        }
                    }
                }
            }
            BattleType::NightSupportAttack(()) => {
                if let Some(night_support_attack) = battle.night_support_attack.as_mut() {
                    midnight_flag = true;

                    if let Some(hourai) = night_support_attack.hourai.as_mut() {
                        midnight_e_nowhps
                            .iter()
                            .enumerate()
                            .for_each(|(idx, &e_nowhp)| {
                                hourai.now_hps[idx] = e_nowhp - midnight_e_total_damages[idx];
                            });

                        hourai.damage.iter().enumerate().for_each(|(idx, &x)| {
                            midnight_e_total_damages[idx] += x as i64;
                        });
                    }

                    if let Some(airatack) = night_support_attack.airatack.as_mut() {
                        midnight_e_nowhps
                            .iter()
                            .enumerate()
                            .for_each(|(idx, &e_nowhp)| {
                                airatack.e_damage.now_hps[idx] =
                                    e_nowhp - midnight_e_total_damages[idx];
                            });

                        if let Some(damages) = &airatack.e_damage.damages {
                            damages.iter().enumerate().for_each(|(idx, &x)| {
                                midnight_e_total_damages[idx] += x as i64;
                            });
                        }
                    }
                }
            }
            BattleType::MidnightHougeki(()) => {
                if let Some(midnight_hougeki) = battle.midnight_hougeki.as_mut() {
                    midnight_flag = true;

                    if let Some(at_eflag) = &midnight_hougeki.at_eflag {
                        at_eflag.iter().enumerate().for_each(|(eflag_idx, &eflag)| {
                            if let Some(df_list) = &midnight_hougeki.df_list {
                                midnight_f_nowhps
                                    .iter()
                                    .enumerate()
                                    .for_each(|(idx, &f_nowhp)| {
                                        midnight_hougeki.f_now_hps[eflag_idx][idx] =
                                            f_nowhp - midnight_f_total_damages[idx];
                                    });
                                midnight_e_nowhps
                                    .iter()
                                    .enumerate()
                                    .for_each(|(idx, &e_nowhp)| {
                                        midnight_hougeki.e_now_hps[eflag_idx][idx] =
                                            e_nowhp - midnight_e_total_damages[idx];
                                    });

                                df_list[eflag_idx]
                                    .iter()
                                    .enumerate()
                                    .for_each(|(df_idx, &df)| {
                                        if let Some(damage) = &midnight_hougeki.damage {
                                            match eflag {
                                                1 => {
                                                    midnight_f_total_damages[df as usize] +=
                                                        damage[eflag_idx][df_idx] as i64;
                                                }
                                                0 => {
                                                    midnight_e_total_damages[df as usize] +=
                                                        damage[eflag_idx][df_idx] as i64;
                                                }
                                                _ => {}
                                            }
                                        }
                                    });
                            }
                        });
                    }
                }
            }
        });

    if day_flag {
        battle.f_total_damages = Some(f_total_damages);
        battle.e_total_damages = Some(e_total_damages);
    } else {
        battle.f_total_damages = None;
        battle.e_total_damages = None;
    }
    if midnight_flag {
        battle.friend_total_damages = Some(friend_total_damages);
        battle.midnight_f_total_damages = Some(midnight_f_total_damages);
        battle.midnight_e_total_damages = Some(midnight_e_total_damages);
    } else {
        battle.friend_total_damages = None;
        battle.midnight_f_total_damages = None;
        battle.midnight_e_total_damages = None;
    }
}

impl From<kcapi_main::api_req_sortie::battleresult::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle_result: kcapi_main::api_req_sortie::battleresult::ApiData) -> Self {
        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let result: BattleResult = InterfaceWrapper::from(battle_result).unwrap();
        Self(Battle {
            battle_order: None,
            timestamp: None,
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: None,
            formation: None,
            enemy_ship_id: None,
            e_lv: None,
            e_params: None,
            f_params: None,
            e_slot: None,
            e_hp_max: None,
            e_combined_flag: None,
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: None,
            escape_idx: None,
            smoke_type: None,
            combat_ration: None,
            balloon_flag: None,
            air_base_assault: None,
            carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            night_support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: None,
            e_nowhps: None,
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
            battle_result: Some(result),
        })
    }
}

impl From<kcapi_main::api_req_sortie::battle::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_sortie::battle::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> = battle
            .api_air_base_attack
            .map(|air_base_air_attack| InterfaceWrapper::from(air_base_air_attack).unwrap());
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> = Some(vec![
            Some(InterfaceWrapper::from(battle.api_kouku).unwrap()),
            None,
        ]);
        let opening_taisen: Option<OpeningTaisen> = battle
            .api_opening_taisen
            .map(|opening_taisen| InterfaceWrapper::from(opening_taisen).unwrap());
        let opening_raigeki: Option<OpeningRaigeki> = battle
            .api_opening_atack
            .map(|opening_attack| InterfaceWrapper::from(opening_attack).unwrap());
        let closing_taigeki: Option<ClosingRaigeki> = battle
            .api_raigeki
            .map(|closing_raigeki| InterfaceWrapper::from(closing_raigeki).unwrap());
        let hougeki_1: Option<Hougeki> = battle
            .api_hougeki1
            .map(|hougeki| InterfaceWrapper::from(hougeki).unwrap());
        let hougeki_2: Option<Hougeki> = battle
            .api_hougeki2
            .map(|hougeki| InterfaceWrapper::from(hougeki).unwrap());
        let hougeki_3: Option<Hougeki> = battle
            .api_hougeki3
            .map(|hougeki| InterfaceWrapper::from(hougeki).unwrap());
        let support_attack: Option<SupportAttack> = battle
            .api_support_info
            .map(|support_info| InterfaceWrapper::from(support_info).unwrap());
        let air_base_assault: Option<AirBaseAssult> = battle
            .api_air_base_injection
            .map(|air_base_injection| InterfaceWrapper::from(air_base_injection).unwrap());
        let carrier_base_assault: Option<CarrierBaseAssault> = battle
            .api_injection_kouku
            .map(|injection_kouku| InterfaceWrapper::from(injection_kouku).unwrap());

        let hougeki: Option<Vec<Option<Hougeki>>> =
            if hougeki_1.is_some() || hougeki_2.is_some() || hougeki_3.is_some() {
                Some(vec![hougeki_1, hougeki_2, hougeki_3])
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = kc_api_interface::battle_order_checked![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::Hougeki(1),
            BattleType::ClosingRaigeki(()),
        ];

        let escape_idx_combined: Option<Vec<i64>> = calc_escape_idx(battle.api_escape_idx, None);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_lv: Some(battle.api_ship_lv),
            e_params: Some(battle.api_e_param),
            f_params: Some(battle.api_f_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
            e_combined_flag: Some(0),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(battle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: battle.api_combat_ration,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            night_support_attack: None,
            opening_taisen,
            opening_raigeki,
            hougeki,
            closing_raigeki: closing_taigeki,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some(battle.api_f_nowhps),
            e_nowhps: Some(battle.api_e_nowhps),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
            battle_result: None,
        });
        apply_sprite_metrics(&mut ret.0);
        calc_dmg(&mut ret.0);
        ret
    }
}

impl From<kcapi_main::api_req_battle_midnight::battle::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_battle_midnight::battle::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> =
            Some(InterfaceWrapper::from(battle.api_hougeki).unwrap());
        let friendly_force_attack: Option<FriendlyForceAttack> =
            match (
                battle.api_friendly_info.clone(),
                battle.api_friendly_battle.clone(),
            ) {
                (Some(info), Some(friendly_battle)) => {
                    Some(InterfaceWrapper::from_api_data(info, friendly_battle).unwrap())
                }
                _ => None,
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = kc_api_interface::battle_order_checked![
            BattleType::FriendlyForceAttack(()),
            BattleType::MidnightHougeki(()),
        ];

        let escape_idx_combined: Option<Vec<i64>> = calc_escape_idx(battle.api_escape_idx, None);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_lv: Some(battle.api_ship_lv),
            e_params: Some(battle.api_e_param),
            f_params: Some(battle.api_f_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
            e_combined_flag: Some(0),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: None,
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault: None,
            carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            night_support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midnight_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki,
            f_nowhps: None,
            e_nowhps: None,
            midnight_f_nowhps: Some(battle.api_f_nowhps),
            midnight_e_nowhps: Some(battle.api_e_nowhps),
            battle_result: None,
        });
        apply_sprite_metrics(&mut ret.0);
        calc_dmg(&mut ret.0);
        ret
    }
}

impl From<kcapi_main::api_req_battle_midnight::sp_midnight::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_battle_midnight::sp_midnight::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> =
            Some(InterfaceWrapper::from(battle.api_hougeki).unwrap());
        let friendly_force_attack: Option<FriendlyForceAttack> = None;
        let has_night_support = battle.api_n_support_flag > 0;
        let night_support_attack: Option<NightSupportAttack> =
            battle.api_n_support_info.map(unwrap_into);

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let mut battle_order: Vec<BattleType> = kc_api_interface::battle_order_checked![
            BattleType::FriendlyForceAttack(()),
            BattleType::MidnightHougeki(()),
        ];
        if has_night_support || night_support_attack.is_some() {
            battle_order.insert(1, BattleType::NightSupportAttack(()));
        }

        let escape_idx_combined: Option<Vec<i64>> = calc_escape_idx(battle.api_escape_idx, None);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: None,
            midnight_timestamp: Some(Local::now().timestamp()),
            cell_id: cell_no,
            deck_id: Some(battle.api_deck_id),
            formation: Some(battle.api_formation),
            enemy_ship_id: Some(battle.api_ship_ke),
            e_lv: Some(battle.api_ship_lv),
            e_params: Some(battle.api_e_param),
            f_params: Some(battle.api_f_param),
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
            e_combined_flag: Some(0),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: None,
            escape_idx: escape_idx_combined,
            smoke_type: Some(battle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(battle.api_balloon_cell),
            air_base_assault: None,
            carrier_base_assault: None,
            air_base_air_attacks: None,
            opening_air_attack: None,
            support_attack: None,
            night_support_attack,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack,
            midnight_flare_pos: Some(battle.api_flare_pos),
            midnight_touchplane: Some(battle.api_touch_plane),
            midnight_hougeki,
            f_nowhps: None,
            e_nowhps: None,
            midnight_f_nowhps: Some(battle.api_f_nowhps),
            midnight_e_nowhps: Some(battle.api_e_nowhps),
            battle_result: None,
        });
        apply_sprite_metrics(&mut ret.0);
        calc_dmg(&mut ret.0);
        ret
    }
}

impl From<kcapi_main::api_req_sortie::ld_airbattle::ApiData> for InterfaceWrapper<Battle> {
    fn from(airbattle: kcapi_main::api_req_sortie::ld_airbattle::ApiData) -> Self {
        let air_base_air_attacks: Option<AirBaseAirAttacks> = airbattle
            .api_air_base_attack
            .map(|air_base_air_attack| InterfaceWrapper::from(air_base_air_attack).unwrap());
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> = Some(vec![
            Some(InterfaceWrapper::from(airbattle.api_kouku).unwrap()),
            None,
        ]);

        // Need to resarch this
        // let support_attack: Option<SupportAttack> = airbattle.api_support_info.and_then(|support_info| Some(support_info.into()));
        // let air_base_assault: Option<AirBaseAssult> = airbattle.api_air_base_injection.and_then(|air_base_injection| Some(air_base_injection.into()));
        // let carrier_base_assault: Option<CarrierBaseAssault> = airbattle.api_injection_kouku.and_then(|injection_kouku| Some(injection_kouku.into());
        let support_attack: Option<SupportAttack> = None;
        let air_base_assault: Option<AirBaseAssult> = None;
        let carrier_base_assault: Option<CarrierBaseAssault> = None;

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = kc_api_interface::battle_order_checked![
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
        ];

        let escape_idx_combined: Option<Vec<i64>> = calc_escape_idx(airbattle.api_escape_idx, None);

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(airbattle.api_deck_id),
            formation: Some(airbattle.api_formation),
            enemy_ship_id: Some(airbattle.api_ship_ke),
            e_lv: Some(airbattle.api_ship_lv),
            e_params: Some(airbattle.api_e_param),
            f_params: Some(airbattle.api_f_param),
            e_slot: Some(airbattle.api_e_slot),
            e_hp_max: Some(airbattle.api_e_maxhps),
            e_combined_flag: Some(0),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(airbattle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(airbattle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(airbattle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            night_support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some(airbattle.api_f_nowhps),
            e_nowhps: Some(airbattle.api_e_nowhps),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
            battle_result: None,
        });
        apply_sprite_metrics(&mut ret.0);
        calc_dmg(&mut ret.0);
        ret
    }
}

impl From<kcapi_main::api_req_sortie::airbattle::ApiData> for InterfaceWrapper<Battle> {
    fn from(airbattle: kcapi_main::api_req_sortie::airbattle::ApiData) -> Self {
        let air_base_air_attacks = None;

        let air_attack_1: Option<OpeningAirAttack> =
            Some(InterfaceWrapper::from(airbattle.api_kouku).unwrap());
        let air_attack_2: Option<OpeningAirAttack> =
            Some(InterfaceWrapper::from(airbattle.api_kouku2).unwrap());
        let opening_air_attack: Option<Vec<Option<OpeningAirAttack>>> =
            Some(vec![air_attack_1, air_attack_2]);

        // Need to resarch this
        // let support_attack: Option<SupportAttack> = airbattle.api_support_info.and_then(|support_info| Some(support_info.into()));
        // let air_base_assault: Option<AirBaseAssult> = airbattle.api_air_base_injection.and_then(|air_base_injection| Some(air_base_injection.into()));
        // let carrier_base_assault: Option<CarrierBaseAssault> = airbattle.api_injection_kouku.and_then(|injection_kouku| Some(injection_kouku.into());
        let support_attack: Option<SupportAttack> = None;
        let air_base_assault: Option<AirBaseAssult> = None;
        let carrier_base_assault: Option<CarrierBaseAssault> = None;

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = kc_api_interface::battle_order_checked![
            BattleType::OpeningAirAttack(0),
            BattleType::OpeningAirAttack(1),
        ];

        // let escape_idx_combined: Option<Vec<i64>> = calc_escape_idx(airbattle.api_escape_idx, None);
        let escape_idx_combined: Option<Vec<i64>> = None;

        let mut ret = Self(Battle {
            battle_order: Some(battle_order),
            timestamp: Some(Local::now().timestamp()),
            midnight_timestamp: None,
            cell_id: cell_no,
            deck_id: Some(airbattle.api_deck_id),
            formation: Some(airbattle.api_formation),
            enemy_ship_id: Some(airbattle.api_ship_ke),
            e_lv: Some(airbattle.api_ship_lv),
            e_params: Some(airbattle.api_e_param),
            f_params: Some(airbattle.api_f_param),
            e_slot: Some(airbattle.api_e_slot),
            e_hp_max: Some(airbattle.api_e_maxhps),
            e_combined_flag: Some(0),
            f_total_damages: None,
            e_total_damages: None,
            friend_total_damages: None,
            midnight_f_total_damages: None,
            midnight_e_total_damages: None,
            reconnaissance: Some(airbattle.api_search),
            escape_idx: escape_idx_combined,
            smoke_type: Some(airbattle.api_smoke_type),
            combat_ration: None,
            balloon_flag: Some(airbattle.api_balloon_cell),
            air_base_assault,
            carrier_base_assault,
            air_base_air_attacks,
            opening_air_attack,
            support_attack,
            night_support_attack: None,
            opening_taisen: None,
            opening_raigeki: None,
            hougeki: None,
            closing_raigeki: None,
            friendly_force_attack: None,
            midnight_flare_pos: None,
            midnight_touchplane: None,
            midnight_hougeki: None,
            f_nowhps: Some(airbattle.api_f_nowhps),
            e_nowhps: Some(airbattle.api_e_nowhps),
            midnight_f_nowhps: None,
            midnight_e_nowhps: None,
            battle_result: None,
        });
        apply_sprite_metrics(&mut ret.0);
        calc_dmg(&mut ret.0);
        ret
    }
}

// impl From<kcapi_main::api_req_map::start::ApiData> for Battles {
//     fn from(start: kcapi_main::api_req_map::start::ApiData) -> Self {
//         let battles = HashMap::new();
//         Self {
//             cells: Vec::new(),
//             battles: battles,
//         }
//     }
// }

fn calc_critical(damages: &Vec<f32>, cl_list: &Vec<i64>) -> Vec<i64> {
    cl_list
        .iter()
        .enumerate()
        .map(|(idx, cl)| match damages[idx] {
            n if n < 15_f32 => 1,
            n if n >= 40_f32 => 2,
            _ => *cl,
        })
        .collect()
}

fn calc_floor(damages: &Vec<f32>) -> Vec<f32> {
    damages.iter().map(|dmg| (*dmg).floor()).collect()
}

fn calc_si_list(si_list: &Vec<Option<DuoType<i64, String>>>) -> Vec<Option<i64>> {
    si_list
        .iter()
        .map(|si| match si {
            Some(si) => match si {
                DuoType::Type1(num) => {
                    if *num == -1 {
                        None
                    } else {
                        Some(*num)
                    }
                }
                DuoType::Type2(string) => string.parse::<i64>().ok(),
            },
            None => None,
        })
        .collect()
}

fn calc_protect_flag(damages: &Vec<f32>) -> Vec<bool> {
    damages.iter().map(|dmg| (*dmg).floor() < *dmg).collect()
}

fn calc_max_critical(cl_list: &Vec<i64>) -> i64 {
    cl_list.iter().max().copied().unwrap_or(0)
}

fn remove_m1<T>(vec: &Vec<T>, df_list: &Vec<i64>) -> Vec<T>
where
    T: Clone,
{
    vec.clone()
        .iter()
        .enumerate()
        .filter_map(|(idx, y)| {
            if df_list[idx] != -1 {
                Some(y.clone())
            } else {
                None
            }
        })
        .collect::<Vec<T>>()
}

pub fn calc_escape_idx(
    escape_idx: Option<Vec<i64>>,
    escape_idx_combine: Option<Vec<i64>>,
) -> Option<Vec<i64>> {
    let escape_idx_combined_unwrap: Vec<i64> = [
        escape_idx.unwrap_or_default(),
        escape_idx_combine
            .unwrap_or_default()
            .iter()
            .map(|idx| *idx + 6)
            .collect(),
    ]
    .concat()
    .iter()
    .map(|v| *v - 1)
    .collect();
    if escape_idx_combined_unwrap.is_empty() {
        None
    } else {
        Some(escape_idx_combined_unwrap)
    }
}

pub fn parse_landing_hp(landing_hp: DuoType<i64, String>) -> Option<i64> {
    match landing_hp {
        DuoType::Type1(num) => Some(num),
        DuoType::Type2(s) => s.trim().parse::<i64>().ok(),
    }
}

impl From<kcapi_common::common_battle::ApiSupportInfo> for InterfaceWrapper<NightSupportAttack> {
    fn from(support_info: kcapi_common::common_battle::ApiSupportInfo) -> Self {
        let hourai: Option<SupportHourai> = support_info
            .api_support_hourai
            .map(|support_hourai| InterfaceWrapper::from(support_hourai).unwrap());
        let airatack: Option<SupportAiratack> = support_info
            .api_support_airatack
            .map(|support_airatack| InterfaceWrapper::from(support_airatack).unwrap());

        Self(NightSupportAttack { hourai, airatack })
    }
}
