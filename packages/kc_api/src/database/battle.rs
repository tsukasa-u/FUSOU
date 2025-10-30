use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::database::airbase::AirBase;
use crate::database::airbase::AirBaseId;
use crate::database::deck::EnemyDeck;
use crate::database::deck::EnemyDeckId;
use crate::database::deck::FriendDeck;
use crate::database::deck::FriendDeckId;
use crate::database::deck::OwnDeck;
use crate::database::deck::OwnDeckId;
use crate::database::deck::SupportDeck;
use crate::database::deck::SupportDeckId;
use crate::database::env_info::EnvInfoId;
use crate::database::table::PortTable;
use crate::interface::air_base::AirBases;
use crate::interface::deck_port::DeckPorts;
use crate::interface::ship::Ships;

use register_trait::{FieldSizeChecker, TraitForDecode, TraitForEncode};

pub type BattleId = Uuid;
pub type HougekiListId = Uuid;
pub type HougekiId = Uuid;
pub type MidnightHougekiListId = Uuid;
pub type MidnightHougekiId = Uuid;
pub type OpeningTaisenListId = Uuid;
pub type OpeningTaisenId = Uuid;
pub type ClosingRaigekiId = Uuid;
pub type OpeningRaigekiId = Uuid;
pub type OpeningAirAttackListId = Uuid;
pub type OpeningAirAttackId = Uuid;
pub type AirBaseAirAttackListId = Uuid;
pub type AirBaseAirAttackId = Uuid;
pub type AirBaseAssultId = Uuid;
pub type CarrierBaseAssaultId = Uuid;
pub type SupportHouraiId = Uuid;
pub type FriendlySupportHouraiId = Uuid;
pub type SupportAirattackId = Uuid;
pub type FriendlySupportHouraiListId = Uuid;

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct HougekiList {
    pub env_uuid: EnvInfoId,
    pub uuid: HougekiListId,
    pub hougeki: Option<HougekiId>,
}

impl HougekiList {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: Vec<Option<crate::interface::battle::Hougeki>>,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        if data.iter().all(|x| x.is_none()) {
            return None;
        }

        let new_hougeki = Uuid::new_v7(ts);
        let result = data
            .iter()
            .enumerate()
            .map(|(hougeki_index, hougeki)| match hougeki {
                Some(hougeki) => Hougeki::new(
                    ts,
                    new_hougeki,
                    hougeki.clone(),
                    table,
                    env_uuid,
                    hougeki_index,
                ),
                None => None,
            })
            .collect::<Vec<_>>();
        let new_hougeki_wrap = match result.iter().any(|x| x.is_some()) {
            true => Some(new_hougeki),
            false => None,
        };

        let new_data = HougekiList {
            env_uuid,
            uuid,
            hougeki: new_hougeki_wrap,
        };

        table.hougeki_list.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct Hougeki {
    pub env_uuid: EnvInfoId,
    pub uuid: HougekiId,
    pub index_1: i64,
    pub index_2: i64,
    pub at: i64,
    pub at_type: i64,
    pub df: Vec<i64>,
    pub cl: Vec<i64>,
    pub damage: Vec<i64>,
    pub at_eflag: i64,
    pub si: Vec<Option<i64>>,
    pub protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i64>,
    pub e_now_hps: Vec<i64>,
}

impl Hougeki {
    pub fn new(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::Hougeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let data_len = data.at_list.len();
        (0..data_len).for_each(|i| {
            let new_data = Hougeki {
                env_uuid,
                uuid,
                index_1: index as i64,
                index_2: i as i64,
                at: data.at_list[i],
                at_type: data.at_type[i],
                df: data.df_list[i].clone(),
                cl: data.cl_list[i].clone(),
                damage: data.damage[i].iter().map(|x| *x as i64).collect(),
                at_eflag: data.at_eflag[i],
                si: data.si_list[i].clone(),
                protect_flag: data.protect_flag[i].clone(),
                f_now_hps: data.f_now_hps[i].clone(),
                e_now_hps: data.e_now_hps[i].clone(),
            };

            table.hougeki.push(new_data);
        });

        Some(())
    }

    // pub fn encode(data: Vec<HougekiList>) -> Result<Vec<u8>, apache_avro::Error> {
    //     let schema = HougekiList::get_schema();
    //     let mut writer = Writer::with_codec(&schema, Vec::new(), Codec::Deflate);
    //     writer.append_ser(data)?;
    //     writer.into_inner()
    // }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct MidnightHougekiList {
    pub env_uuid: EnvInfoId,
    pub uuid: MidnightHougekiListId,
    pub f_flare_pos: Option<i64>,
    pub f_touch_plane: Option<i64>,
    pub e_flare_pos: Option<i64>,
    pub e_touch_plane: Option<i64>,
    pub midnight_hougeki: Option<MidnightHougekiId>,
}

impl MidnightHougekiList {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_midnight_hougeki = Uuid::new_v7(ts);
        let result = data.midnight_hougeki.and_then(|midnight_hougeki| {
            MidnightHougeki::new(ts, new_midnight_hougeki, midnight_hougeki, table, env_uuid)
        });
        let new_midnight_hougeki_wrap = match result {
            Some(_) => Some(new_midnight_hougeki),
            None => None,
        };
        let new_data = MidnightHougekiList {
            env_uuid,
            uuid,
            f_flare_pos: data.midnight_flare_pos.clone().map(|pos| pos[0]),
            f_touch_plane: data.midnight_touchplane.clone().map(|plane| plane[0]),
            e_flare_pos: data.midnight_flare_pos.clone().map(|pos| pos[1]),
            e_touch_plane: data.midnight_touchplane.clone().map(|plane| plane[1]),
            midnight_hougeki: new_midnight_hougeki_wrap,
        };

        if new_data.f_flare_pos.is_none()
            && new_data.f_touch_plane.is_none()
            && new_data.e_flare_pos.is_none()
            && new_data.e_touch_plane.is_none()
            && new_data.midnight_hougeki.is_none()
        {
            return None;
        }

        table.midnight_hougeki_list.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct MidnightHougeki {
    pub env_uuid: EnvInfoId,
    pub uuid: MidnightHougekiId,
    pub index: i64,
    pub at: Option<i64>,
    pub df: Option<Vec<i64>>,
    pub cl: Option<Vec<i64>>,
    pub damage: Option<Vec<i64>>,
    pub at_eflag: Option<i64>,
    pub si: Option<Vec<Option<i64>>>,
    pub protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Option<Vec<i64>>,
    pub e_now_hps: Option<Vec<i64>>,
}

impl MidnightHougeki {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::MidnightHougeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let ret = match data.at_list {
            Some(_) => {
                let data_len = data.at_list.clone().unwrap().len();
                (0..data_len).for_each(|i| {
                    let new_data = MidnightHougeki {
                        env_uuid,
                        uuid,
                        index: i as i64,
                        at: data.at_list.clone().map(|x| x[i]),
                        df: data.df_list.clone().map(|x| x[i].clone()),
                        cl: data.cl_list.clone().map(|x| x[i].clone()),
                        damage: data
                            .damage
                            .clone()
                            .map(|x| x[i].iter().map(|x| *x as i64).collect()),
                        at_eflag: data.at_eflag.clone().map(|x| x[i]),
                        si: data.si_list.clone().map(|x| x[i].clone()),
                        protect_flag: data.protect_flag.clone().map(|x| x[i].clone()),
                        f_now_hps: Some(data.f_now_hps.clone()[i].clone()),
                        e_now_hps: Some(data.e_now_hps.clone()[i].clone()),
                    };

                    table.midnight_hougeki.push(new_data);
                });
                return Some(());
            }
            None => None,
        };

        return ret;
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct OpeningTaisenList {
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningTaisenListId,
    pub opening_taisen: Option<OpeningTaisenId>,
}

impl OpeningTaisenList {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::OpeningTaisen,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_opening_taisen = Uuid::new_v7(ts);
        let result = OpeningTaisen::new(ts, new_opening_taisen, data, table, env_uuid);
        let new_opening_taisen_wrap = match result {
            Some(_) => Some(new_opening_taisen),
            None => None,
        };

        let new_data = OpeningTaisenList {
            env_uuid,
            uuid,
            opening_taisen: new_opening_taisen_wrap,
        };

        table.opening_taisen_list.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct OpeningTaisen {
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningTaisenId,
    pub index: i64,
    pub at: i64,
    pub at_type: i64,
    pub df: Vec<i64>,
    pub cl: Vec<i64>,
    pub damage: Vec<i64>,
    pub at_eflag: i64,
    pub si: Vec<Option<i64>>,
    pub protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i64>,
    pub e_now_hps: Vec<i64>,
}

impl OpeningTaisen {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::OpeningTaisen,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let data_len = data.at_list.clone().len();
        (0..data_len).for_each(|i| {
            let new_data = OpeningTaisen {
                env_uuid,
                uuid,
                index: i as i64,
                at: data.at_list.clone()[i],
                at_type: data.at_list.clone()[i],
                df: data.df_list.clone()[i].clone(),
                cl: data.cl_list.clone()[i].clone(),
                damage: data.damage.clone()[i].iter().map(|x| *x as i64).collect(),
                at_eflag: data.at_eflag.clone()[i],
                si: data.si_list.clone()[i].clone(),
                protect_flag: data.protect_flag.clone()[i].clone(),
                f_now_hps: data.f_now_hps.clone()[i].clone(),
                e_now_hps: data.e_now_hps.clone()[i].clone(),
            };

            table.opening_taisen.push(new_data);
        });

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct ClosingRaigeki {
    pub env_uuid: EnvInfoId,
    pub uuid: ClosingRaigekiId,
    pub f_dam: Vec<i64>,
    pub e_dam: Vec<i64>,
    pub f_rai: Vec<i64>,
    pub e_rai: Vec<i64>,
    pub f_cl: Vec<i64>,
    pub e_cl: Vec<i64>,
    pub f_protect_flag: Vec<bool>,
    pub e_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i64>,
    pub e_now_hps: Vec<i64>,
}

impl ClosingRaigeki {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::ClosingRaigeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = ClosingRaigeki {
            env_uuid,
            uuid,
            f_dam: data.fdam.iter().map(|x| *x as i64).collect(),
            e_dam: data.edam.iter().map(|x| *x as i64).collect(),
            f_rai: data.frai,
            e_rai: data.erai,
            f_cl: data.fcl,
            e_cl: data.ecl,
            f_protect_flag: data.f_protect_flag,
            e_protect_flag: data.e_protect_flag,
            f_now_hps: data.f_now_hps,
            e_now_hps: data.e_now_hps,
        };

        table.closing_raigeki.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct OpeningRaigeki {
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningRaigekiId,
    pub f_dam: Vec<i64>,
    pub e_dam: Vec<i64>,
    pub f_rai: Vec<Option<Vec<i64>>>,
    pub e_rai: Vec<Option<Vec<i64>>>,
    pub f_cl: Vec<i64>,
    pub e_cl: Vec<i64>,
    pub f_protect_flag: Vec<bool>,
    pub e_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i64>,
    pub e_now_hps: Vec<i64>,
}

impl OpeningRaigeki {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::OpeningRaigeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = OpeningRaigeki {
            env_uuid,
            uuid,
            f_dam: data.fdam.iter().map(|x| *x as i64).collect(),
            e_dam: data.edam.iter().map(|x| *x as i64).collect(),
            f_rai: data.frai_list_items,
            e_rai: data.erai_list_items,
            f_cl: data.fcl_list,
            e_cl: data.ecl_list,
            f_protect_flag: data.f_protect_flag,
            e_protect_flag: data.e_protect_flag,
            f_now_hps: data.f_now_hps,
            e_now_hps: data.e_now_hps,
        };

        table.opening_raigeki.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct OpeningAirAttackList {
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningAirAttackListId,
    pub opening_air_attack: Option<OpeningAirAttackId>,
}

impl OpeningAirAttackList {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: Vec<Option<crate::interface::battle::OpeningAirAttack>>,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        if data.iter().all(|x| x.is_none()) {
            return None;
        }

        let new_opening_air_attack = Uuid::new_v7(ts);
        let result = data
            .iter()
            .enumerate()
            .map(
                |(opening_air_attack_index, opening_air_attack)| match opening_air_attack {
                    Some(opening_air_attack) => OpeningAirAttack::new(
                        ts,
                        new_opening_air_attack,
                        opening_air_attack.clone(),
                        table,
                        env_uuid,
                        opening_air_attack_index,
                    ),
                    None => None,
                },
            )
            .collect::<Vec<_>>();
        let new_opening_air_attack_wrap = match result.iter().any(|x| x.is_some()) {
            true => Some(new_opening_air_attack),
            false => None,
        };

        let new_data = OpeningAirAttackList {
            env_uuid,
            uuid,
            opening_air_attack: new_opening_air_attack_wrap,
        };

        table.opening_airattack_list.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct OpeningAirAttack {
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningAirAttackId,
    pub index: i64,
    pub f_plane_from: Option<Vec<i64>>,
    pub f_touch_plane: Option<i64>,
    pub f_loss_plane1: i64,
    pub f_loss_plane2: i64,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i64>>,
    pub f_rai_flag: Option<Vec<Option<i64>>>,
    pub f_bak_flag: Option<Vec<Option<i64>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i64>,
    pub e_plane_from: Option<Vec<i64>>,
    pub e_touch_plane: Option<i64>,
    pub e_loss_plane1: i64,
    pub e_loss_plane2: i64,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i64>>,
    pub e_rai_flag: Option<Vec<Option<i64>>>,
    pub e_bak_flag: Option<Vec<Option<i64>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i64>,
    pub airfire_idx: Option<i64>,
    pub airfire_use_item: Option<Vec<i64>>,
    pub air_superiority: Option<i64>,
}

impl OpeningAirAttack {
    pub fn new(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::OpeningAirAttack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let new_data = OpeningAirAttack {
            env_uuid,
            uuid,
            index: index as i64,
            f_plane_from: data.f_damage.plane_from,
            f_touch_plane: data.f_damage.touch_plane,
            f_loss_plane1: data.f_damage.loss_plane1,
            f_loss_plane2: data.f_damage.loss_plane2,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl,
            f_rai_flag: data.f_damage.rai_flag,
            f_bak_flag: data.f_damage.bak_flag,
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data.f_damage.now_hps,
            e_plane_from: data.e_damage.plane_from,
            e_touch_plane: data.e_damage.touch_plane,
            e_loss_plane1: data.e_damage.loss_plane1,
            e_loss_plane2: data.e_damage.loss_plane2,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl,
            e_rai_flag: data.e_damage.rai_flag,
            e_bak_flag: data.e_damage.bak_flag,
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data.e_damage.now_hps,
            airfire_idx: data.air_fire.clone().map(|fire| fire.idx),
            airfire_use_item: data.air_fire.clone().map(|fire| fire.use_item),
            air_superiority: data.air_superiority,
        };

        table.opening_airattack.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct AirBaseAirAttackList {
    pub env_uuid: EnvInfoId,
    pub uuid: AirBaseAirAttackListId,
    pub air_base_air_attack: Option<AirBaseAirAttackId>,
}

impl AirBaseAirAttackList {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::AirBaseAirAttacks,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_air_base_air_attack = Uuid::new_v7(ts);
        let result = data
            .attacks
            .iter()
            .enumerate()
            .map(|(air_base_air_attack_index, air_base_air_attack)| {
                AirBaseAirAttack::new(
                    ts,
                    new_air_base_air_attack,
                    air_base_air_attack.clone(),
                    table,
                    env_uuid,
                    air_base_air_attack_index,
                )
            })
            .collect::<Vec<_>>();
        let new_air_base_air_attack_wrap = match result.iter().any(|x| x.is_some()) {
            true => Some(new_air_base_air_attack),
            false => None,
        };

        let new_data = AirBaseAirAttackList {
            env_uuid,
            uuid,
            air_base_air_attack: new_air_base_air_attack_wrap,
        };

        table.airbase_airattack_list.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct AirBaseAirAttack {
    pub env_uuid: EnvInfoId,
    pub uuid: AirBaseAirAttackId,
    pub index: i64,
    pub f_plane_from: Option<Vec<i64>>,
    pub f_touch_plane: Option<i64>,
    pub f_loss_plane1: i64,
    pub f_loss_plane2: i64,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i64>>,
    pub f_rai_flag: Option<Vec<Option<i64>>>,
    pub f_bak_flag: Option<Vec<Option<i64>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i64>,
    pub e_plane_from: Option<Vec<i64>>,
    pub e_touch_plane: Option<i64>,
    pub e_loss_plane1: i64,
    pub e_loss_plane2: i64,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i64>>,
    pub e_rai_flag: Option<Vec<Option<i64>>>,
    pub e_bak_flag: Option<Vec<Option<i64>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i64>,
    pub airbase_id: AirBaseId,
    pub squadron_plane: Option<Vec<Option<i64>>>,
}

impl AirBaseAirAttack {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::AirBaseAirAttack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let air_bases = AirBases::load();
        let air_base = match air_bases.bases.get(&(data.base_id).to_string()) {
            Some(air_base) => air_base,
            None => return None,
        };

        // ------------------------------------------------------------------------
        // Create AirBase record
        let new_airbase_id = Uuid::new_v7(ts);
        let result = AirBase::new(ts, new_airbase_id, air_base.clone(), table, env_uuid);
        let _new_airbase_id_wrap = match result {
            Some(_) => Some(new_airbase_id),
            None => None,
        };
        // ------------------------------------------------------------------------

        let new_data = AirBaseAirAttack {
            env_uuid,
            uuid,
            index: index as i64,
            f_plane_from: data.f_damage.plane_from,
            f_touch_plane: data.f_damage.touch_plane,
            f_loss_plane1: data.f_damage.loss_plane1,
            f_loss_plane2: data.f_damage.loss_plane2,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl,
            f_rai_flag: data.f_damage.rai_flag,
            f_bak_flag: data.f_damage.bak_flag,
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data.f_damage.now_hps,
            e_plane_from: data.e_damage.plane_from,
            e_touch_plane: data.e_damage.touch_plane,
            e_loss_plane1: data.e_damage.loss_plane1,
            e_loss_plane2: data.e_damage.loss_plane2,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl,
            e_rai_flag: data.e_damage.rai_flag,
            e_bak_flag: data.e_damage.bak_flag,
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data.e_damage.now_hps,
            airbase_id: new_airbase_id,
            squadron_plane: data.squadron_plane,
        };

        table.airbase_airattack.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct AirBaseAssult {
    pub env_uuid: EnvInfoId,
    pub uuid: AirBaseAssultId,
    pub squadron_plane: Vec<i64>,
    pub f_plane_from: Option<Vec<i64>>,
    pub f_touch_plane: Option<i64>,
    pub f_loss_plane1: i64,
    pub f_loss_plane2: i64,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i64>>,
    pub f_rai_flag: Option<Vec<Option<i64>>>,
    pub f_bak_flag: Option<Vec<Option<i64>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i64>,
    pub e_plane_from: Option<Vec<i64>>,
    pub e_touch_plane: Option<i64>,
    pub e_loss_plane1: i64,
    pub e_loss_plane2: i64,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i64>>,
    pub e_rai_flag: Option<Vec<Option<i64>>>,
    pub e_bak_flag: Option<Vec<Option<i64>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i64>,
}

impl AirBaseAssult {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::AirBaseAssult,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = AirBaseAssult {
            env_uuid,
            uuid,
            squadron_plane: data.squadron_plane,
            f_plane_from: data.f_damage.plane_from,
            f_touch_plane: data.f_damage.touch_plane,
            f_loss_plane1: data.f_damage.loss_plane1,
            f_loss_plane2: data.f_damage.loss_plane2,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl,
            f_rai_flag: data.f_damage.rai_flag,
            f_bak_flag: data.f_damage.bak_flag,
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data.f_damage.now_hps,
            e_plane_from: data.e_damage.plane_from,
            e_touch_plane: data.e_damage.touch_plane,
            e_loss_plane1: data.e_damage.loss_plane1,
            e_loss_plane2: data.e_damage.loss_plane2,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl,
            e_rai_flag: data.e_damage.rai_flag,
            e_bak_flag: data.e_damage.bak_flag,
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data.e_damage.now_hps,
        };

        table.airbase_assult.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct CarrierBaseAssault {
    pub env_uuid: EnvInfoId,
    pub uuid: CarrierBaseAssaultId,
    pub f_plane_from: Option<Vec<i64>>,
    pub f_touch_plane: Option<i64>,
    pub f_loss_plane1: i64,
    pub f_loss_plane2: i64,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i64>>,
    pub f_rai_flag: Option<Vec<Option<i64>>>,
    pub f_bak_flag: Option<Vec<Option<i64>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i64>,
    pub e_plane_from: Option<Vec<i64>>,
    pub e_touch_plane: Option<i64>,
    pub e_loss_plane1: i64,
    pub e_loss_plane2: i64,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i64>>,
    pub e_rai_flag: Option<Vec<Option<i64>>>,
    pub e_bak_flag: Option<Vec<Option<i64>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i64>,
}

impl CarrierBaseAssault {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::CarrierBaseAssault,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = CarrierBaseAssault {
            env_uuid,
            uuid,
            f_plane_from: data.f_damage.plane_from,
            f_touch_plane: data.f_damage.touch_plane,
            f_loss_plane1: data.f_damage.loss_plane1,
            f_loss_plane2: data.f_damage.loss_plane2,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl,
            f_rai_flag: data.f_damage.rai_flag,
            f_bak_flag: data.f_damage.bak_flag,
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data.f_damage.now_hps,
            e_plane_from: data.e_damage.plane_from,
            e_touch_plane: data.e_damage.touch_plane,
            e_loss_plane1: data.e_damage.loss_plane1,
            e_loss_plane2: data.e_damage.loss_plane2,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl,
            e_rai_flag: data.e_damage.rai_flag,
            e_bak_flag: data.e_damage.bak_flag,
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data.e_damage.now_hps,
        };

        table.carrierbase_assault.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct SupportHourai {
    pub env_uuid: EnvInfoId,
    pub uuid: SupportHouraiId,
    pub f_cl: Vec<i64>,
    pub f_damage: Vec<i64>,
    pub f_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i64>,
    pub e_cl: Vec<i64>,
    pub e_damage: Vec<i64>,
    pub e_protect_flag: Vec<bool>,
    pub e_now_hps: Vec<i64>,
}

impl SupportHourai {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::SupportHourai,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let decks = DeckPorts::load();
        let deck = decks.deck_ports.get(&data.deck_id)?;

        match deck.ship.clone() {
            Some(ship) if !ship.is_empty() => { /* do nothing */ }
            _ => return None,
        }

        let ships = Ships::load();

        let new_f_now_hps = deck
            .ship
            .clone()
            .unwrap()
            .iter()
            .map(|ship_id| {
                match ships.ships.get(ship_id) {
                    Some(ship) => ship.nowhp,
                    None => Some(0),
                }
                .unwrap_or(0)
            })
            .collect();

        // let new_deck_id = SupportDeck::new(deck.clone(), table, env_uuid)?;

        let deck_len = deck.ship.clone().unwrap().len();
        let mut new_vec_0 = Vec::with_capacity(deck_len);
        new_vec_0.fill(0);
        let mut new_vec_false = Vec::with_capacity(deck_len);
        new_vec_false.fill(false);

        let new_data = SupportHourai {
            env_uuid,
            uuid,
            f_cl: new_vec_0.clone(),
            f_damage: new_vec_0,
            f_protect_flag: new_vec_false,
            f_now_hps: new_f_now_hps,
            e_cl: data.cl_list,
            e_damage: data.damage.iter().map(|x| *x as i64).collect(),
            e_protect_flag: data.protect_flag,
            e_now_hps: data.now_hps,
        };

        table.support_hourai.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct SupportAirattack {
    pub env_uuid: EnvInfoId,
    pub uuid: SupportAirattackId,
    pub f_plane_from: Option<Vec<i64>>,
    pub f_touch_plane: Option<i64>,
    pub f_loss_plane: i64,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i64>>,
    pub f_rai_flag: Option<Vec<Option<i64>>>,
    pub f_bak_flag: Option<Vec<Option<i64>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i64>,
    pub e_plane_from: Option<Vec<i64>>,
    pub e_touch_plane: Option<i64>,
    pub e_loss_plane: i64,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i64>>,
    pub e_rai_flag: Option<Vec<Option<i64>>>,
    pub e_bak_flag: Option<Vec<Option<i64>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i64>,
}

impl SupportAirattack {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::SupportAiratack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let decks = DeckPorts::load();
        let deck = decks.deck_ports.get(&data.deck_id)?;

        match deck.ship.clone() {
            Some(ship) if !ship.is_empty() => { /* do nothing */ }
            _ => return None,
        }

        let ships = Ships::load();

        let new_f_now_hps = deck
            .ship
            .clone()
            .unwrap()
            .iter()
            .map(|ship_id| {
                match ships.ships.get(ship_id) {
                    Some(ship) => ship.nowhp,
                    None => Some(0),
                }
                .unwrap_or(0)
            })
            .collect();

        // let new_deck_id = SupportDeck::new(deck.clone(), table, env_uuid)?;

        let deck_len = deck.ship.clone().unwrap().len();
        let mut new_vec_0 = Vec::with_capacity(deck_len);
        new_vec_0.fill(0);
        let mut new_vec_false = Vec::with_capacity(deck_len);
        new_vec_false.fill(false);

        let new_data = SupportAirattack {
            env_uuid,
            uuid,
            f_plane_from: data.f_damage.plane_from,
            f_touch_plane: data.f_damage.touch_plane,
            f_loss_plane: data.f_damage.loss_plane1,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl,
            f_rai_flag: data.f_damage.rai_flag,
            f_bak_flag: data.f_damage.bak_flag,
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: new_f_now_hps,
            e_plane_from: data.e_damage.plane_from,
            e_touch_plane: data.e_damage.touch_plane,
            e_loss_plane: data.e_damage.loss_plane1,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl,
            e_rai_flag: data.e_damage.rai_flag,
            e_bak_flag: data.e_damage.bak_flag,
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data.e_damage.now_hps,
        };
        table.support_airattack.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct FriendlySupportHouraiList {
    pub env_uuid: EnvInfoId,
    pub uuid: FriendlySupportHouraiListId,
    pub f_flare_pos: Option<i64>,
    pub e_flare_pos: Option<i64>,
    pub hourai_list: Option<FriendlySupportHouraiId>,
}

impl FriendlySupportHouraiList {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::FriendlySupportHourai,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_hourai_list = Uuid::new_v7(ts);
        let result = FriendlySupportHourai::new(ts, new_hourai_list, data.hougeki, table, env_uuid);
        let new_hourai_list_wrap = match result {
            Some(_) => Some(new_hourai_list),
            None => None,
        };

        let new_f_flare_pos = match data.flare_pos.clone()[0] {
            -1 => None,
            x => Some(x),
        };
        let new_e_flare_pos = match data.flare_pos.clone()[1] {
            -1 => None,
            x => Some(x),
        };

        let new_data = FriendlySupportHouraiList {
            env_uuid,
            uuid,
            f_flare_pos: new_f_flare_pos,
            e_flare_pos: new_e_flare_pos,
            hourai_list: new_hourai_list_wrap,
        };

        if new_data.f_flare_pos.is_none()
            && new_data.e_flare_pos.is_none()
            && new_data.hourai_list.is_none()
        {
            return None;
        }

        table.friendly_support_hourai_list.push(new_data);

        Some(())
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct FriendlySupportHourai {
    pub env_uuid: EnvInfoId,
    pub uuid: FriendlySupportHouraiId,
    pub index: i64,
    pub at: Option<i64>,
    pub df: Option<Vec<i64>>,
    pub cl: Option<Vec<i64>>,
    pub damage: Option<Vec<i64>>,
    pub at_eflag: Option<i64>,
    pub si: Option<Vec<Option<i64>>>,
    pub protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Option<Vec<i64>>,
    pub e_now_hps: Option<Vec<i64>>,
}

impl FriendlySupportHourai {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::MidnightHougeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let ret = match data.at_list {
            Some(_) => {
                let data_len = data.at_list.clone().unwrap().len();
                (0..data_len).for_each(|i| {
                    let new_data = MidnightHougeki {
                        env_uuid,
                        uuid,
                        index: i as i64,
                        at: data.at_list.clone().map(|x| x[i]),
                        df: data.df_list.clone().map(|x| x[i].clone()),
                        cl: data.cl_list.clone().map(|x| x[i].clone()),
                        damage: data
                            .damage
                            .clone()
                            .map(|x| x[i].iter().map(|x| *x as i64).collect()),
                        at_eflag: data.at_eflag.clone().map(|x| x[i]),
                        si: data.si_list.clone().map(|x| x[i].clone()),
                        protect_flag: data.protect_flag.clone().map(|x| x[i].clone()),
                        f_now_hps: Some(data.f_now_hps.clone()[i].clone()),
                        e_now_hps: Some(data.e_now_hps.clone()[i].clone()),
                    };

                    table.midnight_hougeki.push(new_data);

                    return new_uuid;
                });
                Some(())
            }
            None => None,
        };

        return ret;
    }
}

#[derive(
    Debug,
    Clone,
    Deserialize,
    Serialize,
    AvroSchema,
    TraitForEncode,
    TraitForDecode,
    FieldSizeChecker,
)]
pub struct Battle {
    pub env_uuid: EnvInfoId,
    pub uuid: BattleId,
    pub index: i64,
    pub battle_order: Vec<i64>,
    pub timestamp: Option<i64>,
    pub midnight_timestamp: Option<i64>,
    pub cell_id: i64,
    pub f_deck_id: Option<OwnDeckId>,
    pub e_deck_id: Option<EnemyDeckId>,
    pub friend_deck_id: Option<FriendDeckId>,
    pub support_deck_id: Option<SupportDeckId>,
    pub f_formation: Option<i64>,
    pub e_formation: Option<i64>,
    pub f_total_damages: Option<Vec<i64>>,
    pub e_total_damages: Option<Vec<i64>>,
    pub friend_total_damages: Option<Vec<i64>>,
    pub midnight_f_total_damages: Option<Vec<i64>>,
    pub midnight_e_total_damages: Option<Vec<i64>>,
    pub f_reconnaissance: Option<i64>,
    pub e_reconnaissance: Option<i64>,
    pub f_escape_idx: Option<Vec<i64>>,
    pub smoke_type: Option<i64>,
    pub f_combat_ration: Option<Vec<i64>>,
    pub balloon_flag: Option<i64>,
    pub air_base_assault: Option<AirBaseAssultId>,
    pub carrier_base_assault: Option<CarrierBaseAssaultId>,
    pub air_base_air_attacks: Option<AirBaseAirAttackListId>,
    pub opening_air_attack: Option<OpeningAirAttackListId>,
    pub support_hourai: Option<SupportHouraiId>,
    pub support_airattack: Option<SupportAirattackId>,
    pub opening_taisen: Option<OpeningTaisenListId>,
    pub opening_raigeki: Option<OpeningRaigekiId>,
    pub hougeki: Option<HougekiListId>,
    pub closing_raigeki: Option<ClosingRaigekiId>,
    pub friendly_force_attack: Option<FriendlySupportHouraiListId>,
    pub midnight_hougeki: Option<MidnightHougekiListId>,
    pub f_nowhps: Option<Vec<i64>>,
    pub e_nowhps: Option<Vec<i64>>,
    pub midngiht_f_nowhps: Option<Vec<i64>>,
    pub midngiht_e_nowhps: Option<Vec<i64>>,
}

impl Battle {
    pub fn new(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: crate::interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) {
        let new_battle_order: Vec<i64> = data
            .clone()
            .battle_order
            .map(|order| {
                order
                    .iter()
                    .map(|battle_type| battle_type.clone().into())
                    .collect()
            })
            .unwrap_or_default();

        let new_f_deck_id = Uuid::new_v7(ts);
        data.clone()
            .deck_id
            .map(|deck_id| OwnDeck::new(ts, new_f_deck_id, deck_id, table, env_uuid));

        let new_e_deck_id = EnemyDeck::new(data.clone(), table, env_uuid);
        let new_friend_deck_id = data
            .clone()
            .friendly_force_attack
            .map(|attack| FriendDeck::new(attack.fleet_info, table, env_uuid))
            .unwrap_or(None);
        let new_support_deck_id = data
            .clone()
            .support_attack
            .map(|attack| {
                attack
                    .support_airatack
                    .map(|air| air.deck_id)
                    .or(attack.support_hourai.map(|hourai| hourai.deck_id))
                    .map(|deck_id| SupportDeck::new(deck_id, table, env_uuid))
                    .unwrap_or(None)
            })
            .unwrap_or(None);

        let new_air_base_assault = data
            .clone()
            .air_base_assault
            .map(|assult| AirBaseAssult::new(assult, table, env_uuid));
        let new_carrier_base_assault = data
            .clone()
            .carrier_base_assault
            .map(|assult| CarrierBaseAssault::new(assult, table, env_uuid));
        let new_air_base_air_attacks = data
            .clone()
            .air_base_air_attacks
            .map(|attacks| AirBaseAirAttackList::new(attacks, table, env_uuid));
        let new_opening_air_attack = data
            .clone()
            .opening_air_attack
            .map(|attack| OpeningAirAttackList::new(attack, table, env_uuid))
            .unwrap_or(None);
        // let new_support_attack = data
        //     .clone()
        //     .support_attack
        //     .clone()
        //     .map(|attack| {
        //         if let Some(air) = attack.support_airattack {
        //             SupportAirattack::new(air, table, env_uuid)
        //         } else if let Some(hourai) = attack.support_hourai {
        //             SupportHourai::new(hourai, table, env_uuid)
        //         } else {
        //             None
        //         }
        //     })
        //     .unwrap_or(None);
        let new_support_hourai = data
            .clone()
            .support_attack
            .clone()
            .map(|attack| {
                attack
                    .support_hourai
                    .map(|hourai| SupportHourai::new(hourai, table, env_uuid))
                    .unwrap_or(None)
            })
            .unwrap_or(None);
        let new_support_airattack = data
            .clone()
            .support_attack
            .clone()
            .map(|attack| {
                attack
                    .support_airatack
                    .map(|airattack| SupportAirattack::new(airattack, table, env_uuid))
                    .unwrap_or(None)
            })
            .unwrap_or(None);
        let new_opening_taisen = data
            .clone()
            .opening_taisen
            .map(|taisen| OpeningTaisenList::new(taisen, table, env_uuid));
        let new_opening_raigeki = data
            .clone()
            .opening_raigeki
            .map(|raigeki| OpeningRaigeki::new(raigeki, table, env_uuid));
        let new_hougeki = data
            .clone()
            .hougeki
            .map(|hougeki| HougekiList::new(hougeki, table, env_uuid))
            .unwrap_or(None);
        let new_closing_raigeki = data
            .clone()
            .closing_raigeki
            .map(|raigeki| ClosingRaigeki::new(raigeki, table, env_uuid));
        let new_friendly_force_attack = data
            .clone()
            .friendly_force_attack
            .map(|attack| {
                attack
                    .support_hourai
                    .map(|hourai| FriendlySupportHouraiList::new(hourai, table, env_uuid))
                    .unwrap_or(None)
            })
            .unwrap_or(None);
        let new_midnight_hougeki = MidnightHougekiList::new(data.clone(), table, env_uuid);
        let new_f_nowhps = data.clone().f_nowhps;
        let new_e_nowhps = data.clone().e_nowhps;
        let new_midngiht_f_nowhps = data.clone().midngiht_f_nowhps;
        let new_midngiht_e_nowhps = data.clone().midngiht_e_nowhps;

        let new_data = Battle {
            env_uuid,
            uuid,
            battle_order: new_battle_order,
            timestamp: data.clone().timestamp,
            midnight_timestamp: data.clone().midnight_timestamp,
            cell_id: data.clone().cell_id,
            f_deck_id: new_f_deck_id,
            e_deck_id: new_e_deck_id,
            friend_deck_id: new_friend_deck_id,
            support_deck_id: new_support_deck_id,
            f_formation: data.clone().formation.map(|formation| formation[0]),
            e_formation: data.clone().formation.map(|formation| formation[1]),
            f_total_damages: data.clone().f_total_damages,
            e_total_damages: data.clone().e_total_damages,
            friend_total_damages: data.clone().friend_total_damages,
            midnight_f_total_damages: data.clone().midnight_f_total_damages,
            midnight_e_total_damages: data.clone().midnight_e_total_damages,
            f_reconnaissance: data.clone().reconnaissance.map(|recon| recon[0]),
            e_reconnaissance: data.clone().reconnaissance.map(|recon| recon[1]),
            f_escape_idx: data.clone().escape_idx,
            smoke_type: data.clone().smoke_type,
            f_combat_ration: data.clone().combat_ration,
            balloon_flag: data.clone().balloon_flag,
            air_base_assault: new_air_base_assault,
            carrier_base_assault: new_carrier_base_assault,
            air_base_air_attacks: new_air_base_air_attacks,
            opening_air_attack: new_opening_air_attack,
            // support_attack: new_support_attack,
            support_hourai: new_support_hourai,
            support_airattack: new_support_airattack,
            opening_taisen: new_opening_taisen,
            opening_raigeki: new_opening_raigeki,
            hougeki: new_hougeki,
            closing_raigeki: new_closing_raigeki,
            friendly_force_attack: new_friendly_force_attack,
            midnight_hougeki: new_midnight_hougeki,
            f_nowhps: new_f_nowhps,
            e_nowhps: new_e_nowhps,
            midngiht_f_nowhps: new_midngiht_f_nowhps,
            midngiht_e_nowhps: new_midngiht_e_nowhps,
        };

        table.battle.push(new_data);
    }
}
