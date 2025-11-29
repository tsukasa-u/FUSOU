pub struct FleetSnapshot{
    pub ships: Option<Vec<Ship>>,
    pub materials: Option<Vec<Material>>,
    pub slot_items: Option<Vec<SlotItem>>,
    pub plane_base_info: Option<Vec<PlaneBaseInfo>>,
};



pub struct Ship {
    pub id: i64,
    pub sortno: i64,
    pub ship_id: i64,
    pub lv: i64,
    pub exp: i64,
    pub soku: i64,
    pub leng: i64,
    pub slot: Vec<i64>,
    pub onslot: Vec<i64>,
    pub slot_ex: i64,
    pub kyouka: i64,
    pub slotnum: i64,
    pub cond: i64,
    pub karyoku: i64,
    pub raisou: i64,
    pub taiku: i64,
    pub soukou: i64,
    pub kaihi: i64,
    pub taisen: i64,
    pub sakuteki: i64,
    pub lucky: i64,
    pub locked: i64,
    pub locked_equip: i64,
    pub sally_area: Option<i64>,
    pub sp_effect_items: Option<Vec<SpEffectItem>>,
}

pub struct SpEffectItem {
    pub kind: i64,
    pub raig: Option<i64>,
    pub souk: Option<i64>,
    pub houg: Option<i64>,
    pub kaih: Option<i64>,
}

pub struct Material {
    pub member_id: i64,
    pub id: i64,
    pub value: i64,
}

pub struct SlotItem {

}

pub struct PlaneBaseInfo {

}