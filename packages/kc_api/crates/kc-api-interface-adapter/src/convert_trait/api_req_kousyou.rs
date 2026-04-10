use kc_api_interface::interface::{EmitData, Set};
use kc_api_interface::remodel::{
    PENDING_DETAIL_REQ_CAP, RemodelDetail, RemodelSlotList, RemodelSlotListEntry,
    PENDING_DETAIL_REQ,
};
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::ship::Ships;

use kc_api_dto::endpoints::api_req_kousyou::*;

use crate::{register_trait, TraitForConvert};

register_trait!(
    Req,
    (
        createitem,
        createship,
        destroyitem2,
        destroyship,
        getship,
        remodel_slot,
        remodel_slotlist
    )
);
register_trait!(
    Res,
    (
        createitem,
        createship,
        destroyitem2,
        destroyship,
        getship,
        remodel_slot
    )
);

// --- ヘルパー: 秘書艦・曜日コンテキスト取得 ---

fn get_secretary_ship_master_id() -> Option<i64> {
    let deck_ports = DeckPorts::load();
    let first_fleet = deck_ports.deck_ports.get(&1)?;
    let first_ship_instance_id = first_fleet.ship.as_ref()?.first()?;
    let ships = Ships::load();
    let ship = ships.ships.get(first_ship_instance_id)?;
    ship.ship_id
}

fn weekday_jst() -> i64 {
    use chrono::{Datelike, FixedOffset, Utc};
    let jst = FixedOffset::east_opt(9 * 3600).unwrap();
    let now = Utc::now().with_timezone(&jst);
    now.weekday().num_days_from_monday() as i64
}

// --- remodel_slotlist: 改修条件一覧 ---

impl TraitForConvert for remodel_slotlist::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let secretary = match get_secretary_ship_master_id() {
            Some(v) => v,
            None => {
                eprintln!(
                    "remodel_slotlist: secretary ship not found; skip"
                );
                return Some(vec![]);
            }
        };
        let weekday = weekday_jst();
        let entries = self
            .api_data
            .iter()
            .map(|d| RemodelSlotListEntry {
                remodel_id: d.api_id,
                slotitem_master_id: d.api_slot_id,
                sp_type: d.api_sp_type,
                req_fuel: d.api_req_fuel,
                req_bull: d.api_req_bull,
                req_steel: d.api_req_steel,
                req_bauxite: d.api_req_bauxite,
                req_buildkit: d.api_req_buildkit,
                req_remodelkit: d.api_req_remodelkit,
                req_slot_id: d.api_req_slot_id,
                req_slot_num: d.api_req_slot_num,
            })
            .collect();
        let data = RemodelSlotList {
            secretary_ship_master_id: secretary,
            weekday_jst: weekday,
            entries,
        };
        Some(vec![EmitData::Set(Set::RemodelSlotList(data))])
    }
}

// --- remodel_slotlist_detail ---

impl TraitForConvert for remodel_slotlist_detail::Req {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let mut q = PENDING_DETAIL_REQ.lock().unwrap();
        if q.len() >= PENDING_DETAIL_REQ_CAP {
            eprintln!(
                "PENDING_DETAIL_REQ overflow (cap={}); dropping oldest entry",
                PENDING_DETAIL_REQ_CAP
            );
            q.pop_front();
        }
        q.push_back((self.api_slot_id, self.api_id));
        Some(vec![])
    }
}

impl TraitForConvert for remodel_slotlist_detail::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let ctx = PENDING_DETAIL_REQ.lock().unwrap().pop_front();
        let (master_id, step_id) = match ctx {
            Some(v) => v,
            None => {
                eprintln!(
                    "remodel_slotlist_detail: Req context not found (spawn race); skip"
                );
                return Some(vec![]);
            }
        };
        let d = &self.api_data;
        let detail = RemodelDetail {
            slotitem_master_id: master_id,
            remodel_id: step_id,
            certain_buildkit: d.api_certain_buildkit,
            certain_remodelkit: d.api_certain_remodelkit,
            change_flag: d.api_change_flag,
            req_useitem_id: d.api_req_useitem_id,
            req_useitem_id2: d.api_req_useitem_id2,
            req_useitem_num: d.api_req_useitem_num,
            req_useitem_num2: d.api_req_useitem_num2,
        };
        Some(vec![EmitData::Set(Set::RemodelDetail(detail))])
    }
}
