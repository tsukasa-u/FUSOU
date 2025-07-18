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
use crate::database::table::DATABASE_TABLE_VERSION;
use crate::interface::air_base::AirBases;
use crate::interface::deck_port::DeckPorts;
use crate::interface::ship::Ships;

use register_trait::TraitForEncode;

pub type BattleId = Uuid;
pub type HougekiListId = Uuid;
pub type HougekiId = Uuid;
pub type MidnightHougekiListId = Uuid;
pub type MidnightHougekiId = Uuid;
pub type OpeningTaisenListId = Uuid;
pub type OpeningTaisenId = Uuid;
pub type ClosingRaigekiId = Uuid;
pub type OpeningRaigekiId = Uuid;
pub type OpeningAirAttackId = Uuid;
pub type AirBaseAirAttackListId = Uuid;
pub type AirBaseAirAttackId = Uuid;
pub type AirBaseAssultId = Uuid;
pub type CarrierBaseAssaultId = Uuid;
pub type SupportHouraiId = Uuid;
pub type FriendlySupportHouraiId = Uuid;
pub type SupportAirattackId = Uuid;
pub type FriendlySupportHouraiListId = Uuid;

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct HougekiList {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: HougekiListId,
    pub hougeki: Vec<Vec<HougekiId>>,
}

impl HougekiList {
    pub fn new_ret_uuid(
        data: Vec<Option<crate::interface::battle::Hougeki>>,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        if data.iter().all(|x| x.is_none()) {
            return None;
        }

        let new_uuid = Uuid::new_v4();
        let new_hougeki = data
            .iter()
            .flatten()
            .map(|hougeki| Hougeki::new_ret_uuid(hougeki.clone(), table, env_uuid))
            .collect();

        let new_data = HougekiList {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            hougeki: new_hougeki,
        };

        table.hougeki_list.push(new_data);

        return Some(new_uuid);
    }

    // pub fn encode(data: Vec<HougekiList>) -> Result<Vec<u8>, apache_avro::Error> {
    //     let schema = HougekiList::get_schema();
    //     let mut writer = Writer::with_codec(&schema, Vec::new(), Codec::Deflate);
    //     writer.append_ser(data)?;
    //     writer.into_inner()
    // }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct Hougeki {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: HougekiId,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::Hougeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Vec<Uuid> {
        let data_len = data.at_list.len();
        let new_uuid_list = (0..data_len)
            .map(|i| {
                let new_uuid = Uuid::new_v4();

                let new_data = Hougeki {
                    version: DATABASE_TABLE_VERSION
                        .expect("failed to get table version")
                        .to_string(),
                    env_uuid,
                    uuid: new_uuid,
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

                return new_uuid;
            })
            .collect();

        return new_uuid_list;
    }

    // pub fn encode(data: Vec<HougekiList>) -> Result<Vec<u8>, apache_avro::Error> {
    //     let schema = HougekiList::get_schema();
    //     let mut writer = Writer::with_codec(&schema, Vec::new(), Codec::Deflate);
    //     writer.append_ser(data)?;
    //     writer.into_inner()
    // }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct MidnightHougekiList {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: MidnightHougekiListId,
    pub f_flare_pos: Option<i64>,
    pub f_touch_plane: Option<i64>,
    pub e_flare_pos: Option<i64>,
    pub e_touch_plane: Option<i64>,
    pub midnight_hougeki: Option<Vec<MidnightHougekiId>>,
}

impl MidnightHougekiList {
    pub fn new_ret_uuid(
        data: crate::interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();
        let new_midnight_hougeki = data.midnight_hougeki.and_then(|midnight_hougeki| {
            MidnightHougeki::new_ret_uuid(midnight_hougeki, table, env_uuid)
        });
        let new_data = MidnightHougekiList {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            f_flare_pos: data.midnight_flare_pos.clone().map(|pos| pos[0]),
            f_touch_plane: data.midngiht_touchplane.clone().map(|plane| plane[0]),
            e_flare_pos: data.midnight_flare_pos.clone().map(|pos| pos[1]),
            e_touch_plane: data.midngiht_touchplane.clone().map(|plane| plane[1]),
            midnight_hougeki: new_midnight_hougeki,
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

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct MidnightHougeki {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: MidnightHougekiId,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::MidnightHougeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Vec<Uuid>> {
        let ret = match data.at_list {
            Some(_) => {
                let data_len = data.at_list.clone().unwrap().len();
                let new_uuid_list = (0..data_len)
                    .map(|i| {
                        let new_uuid = Uuid::new_v4();

                        let new_data = MidnightHougeki {
                            version: DATABASE_TABLE_VERSION
                                .expect("failed to get table version")
                                .to_string(),
                            env_uuid,
                            uuid: new_uuid,
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
                    })
                    .collect();
                return Some(new_uuid_list);
            }
            None => None,
        };

        return ret;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct OpeningTaisenList {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningTaisenListId,
    pub opening_taisen: Vec<OpeningTaisenId>,
}

impl OpeningTaisenList {
    pub fn new_ret_uuid(
        data: crate::interface::battle::OpeningTaisen,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();
        let new_opening_taisen = OpeningTaisen::new_ret_uuid(data, table, env_uuid);

        let new_data = OpeningTaisenList {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            opening_taisen: new_opening_taisen,
        };

        table.opening_taisen_list.push(new_data);

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct OpeningTaisen {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningTaisenId,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::OpeningTaisen,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Vec<Uuid> {
        let data_len = data.at_list.clone().len();
        let new_uuid_list = (0..data_len)
            .map(|i| {
                let new_uuid = Uuid::new_v4();

                let new_data = OpeningTaisen {
                    version: DATABASE_TABLE_VERSION
                        .expect("failed to get table version")
                        .to_string(),
                    env_uuid,
                    uuid: new_uuid,
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

                return new_uuid;
            })
            .collect();

        return new_uuid_list;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct ClosingRaigeki {
    pub version: String,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::ClosingRaigeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();

        let new_data = ClosingRaigeki {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct OpeningRaigeki {
    pub version: String,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::OpeningRaigeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();

        let new_data = OpeningRaigeki {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct OpeningAirAttack {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: OpeningAirAttackId,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::OpeningAirAttack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();

        let new_data = OpeningAirAttack {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct AirBaseAirAttackList {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: AirBaseAirAttackListId,
    pub air_base_air_attack: Vec<AirBaseAirAttackId>,
}

impl AirBaseAirAttackList {
    pub fn new_ret_uuid(
        data: crate::interface::battle::AirBaseAirAttacks,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();

        let new_air_base_air_attack = data
            .attacks
            .iter()
            .filter_map(|air_base_air_attack| {
                AirBaseAirAttack::new_ret_uuid(air_base_air_attack.clone(), table, env_uuid)
            })
            .collect();

        let new_data = AirBaseAirAttackList {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            air_base_air_attack: new_air_base_air_attack,
        };

        table.airbase_airattack_list.push(new_data);

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct AirBaseAirAttack {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: AirBaseAirAttackId,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::AirBaseAirAttack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let air_bases = AirBases::load();
        let air_base = air_bases.bases.get(&data.base_id)?;

        let new_uuid = Uuid::new_v4();
        let new_airbase_id = AirBase::new_ret_uuid(air_base.clone(), table, env_uuid);

        let new_data = AirBaseAirAttack {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct AirBaseAssult {
    pub version: String,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::AirBaseAssult,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();

        let new_data = AirBaseAssult {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct CarrierBaseAssault {
    pub version: String,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::CarrierBaseAssault,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Uuid {
        let new_uuid = Uuid::new_v4();

        let new_data = CarrierBaseAssault {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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

        return new_uuid;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct SupportHourai {
    pub version: String,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::SupportHourai,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();

        let decks = DeckPorts::load();
        let deck = decks.deck_ports.get(&data.deck_id)?;

        deck.ship.as_ref()?;
        if deck.ship.clone().unwrap().is_empty() {
            return None;
        }

        let ships = Ships::load();

        let new_f_now_hps = deck
            .ship
            .clone()
            .unwrap()
            .iter()
            .map(|ship_id| {
                let ret = match ships.ships.get(ship_id) {
                    Some(ship) => ship.nowhp,
                    None => Some(0),
                }
                .unwrap_or(0);
                return ret;
            })
            .collect();

        // let new_deck_id = SupportDeck::new_ret_uuid(deck.clone(), table, env_uuid)?;

        let deck_len = deck.ship.clone().unwrap().len();
        let mut new_vec_0 = Vec::with_capacity(deck_len);
        new_vec_0.fill(0);
        let mut new_vec_false = Vec::with_capacity(deck_len);
        new_vec_false.fill(false);

        let new_data = SupportHourai {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct SupportAirattack {
    pub version: String,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::SupportAiratack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();

        let decks = DeckPorts::load();
        let deck = decks.deck_ports.get(&data.deck_id)?;

        deck.ship.as_ref()?;
        if deck.ship.clone().unwrap().is_empty() {
            return None;
        }

        let ships = Ships::load();

        let new_f_now_hps = deck
            .ship
            .clone()
            .unwrap()
            .iter()
            .map(|ship_id| {
                let ret = match ships.ships.get(ship_id) {
                    Some(ship) => ship.nowhp,
                    None => Some(0),
                }
                .unwrap_or(0);
                return ret;
            })
            .collect();

        // let new_deck_id = SupportDeck::new_ret_uuid(deck.clone(), table, env_uuid)?;

        let deck_len = deck.ship.clone().unwrap().len();
        let mut new_vec_0 = Vec::with_capacity(deck_len);
        new_vec_0.fill(0);
        let mut new_vec_false = Vec::with_capacity(deck_len);
        new_vec_false.fill(false);

        let new_data = SupportAirattack {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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
        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct FriendlySupportHouraiList {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: FriendlySupportHouraiListId,
    pub f_flare_pos: Option<i64>,
    pub e_flare_pos: Option<i64>,
    pub hourai_list: Option<Vec<FriendlySupportHouraiId>>,
}

impl FriendlySupportHouraiList {
    pub fn new_ret_uuid(
        data: crate::interface::battle::FriendlySupportHourai,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();
        let new_hourai_list = FriendlySupportHourai::new_ret_uuid(data.hougeki, table, env_uuid);

        let new_f_flare_pos = match data.flare_pos.clone()[0] {
            -1 => None,
            x => Some(x),
        };
        let new_e_flare_pos = match data.flare_pos.clone()[1] {
            -1 => None,
            x => Some(x),
        };

        let new_data = FriendlySupportHouraiList {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
            f_flare_pos: new_f_flare_pos,
            e_flare_pos: new_e_flare_pos,
            hourai_list: new_hourai_list,
        };

        if new_data.f_flare_pos.is_none()
            && new_data.e_flare_pos.is_none()
            && new_data.hourai_list.is_none()
        {
            return None;
        }

        table.friendly_support_hourai_list.push(new_data);

        return Some(new_uuid);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct FriendlySupportHourai {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: FriendlySupportHouraiId,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::MidnightHougeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Vec<Uuid>> {
        let ret = match data.at_list {
            Some(_) => {
                let data_len = data.at_list.clone().unwrap().len();
                let new_uuid_list = (0..data_len)
                    .map(|i| {
                        let new_uuid = Uuid::new_v4();

                        let new_data = MidnightHougeki {
                            version: DATABASE_TABLE_VERSION
                                .expect("failed to get table version")
                                .to_string(),
                            env_uuid,
                            uuid: new_uuid,
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
                    })
                    .collect();
                return Some(new_uuid_list);
            }
            None => None,
        };

        return ret;
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, AvroSchema, TraitForEncode)]
pub struct Battle {
    pub version: String,
    pub env_uuid: EnvInfoId,
    pub uuid: BattleId,
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
    pub opening_air_attack: Option<OpeningAirAttackId>,
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
    pub fn new_ret_uuid(
        data: crate::interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<Uuid> {
        let new_uuid = Uuid::new_v4();

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

        let new_f_deck_id = data
            .clone()
            .deck_id
            .map(|deck_id| OwnDeck::new_ret_uuid(deck_id, table, env_uuid))
            .unwrap_or(None);
        let new_e_deck_id = EnemyDeck::new_ret_uuid(data.clone(), table, env_uuid);
        let new_friend_deck_id = data
            .clone()
            .friendly_force_attack
            .map(|attack| FriendDeck::new_ret_uuid(attack.fleet_info, table, env_uuid))
            .unwrap_or(None);
        let new_support_deck_id = data
            .clone()
            .support_attack
            .map(|attack| {
                attack
                    .support_airatack
                    .map(|air| air.deck_id)
                    .or(attack.support_hourai.map(|hourai| hourai.deck_id))
                    .map(|deck_id| SupportDeck::new_ret_uuid(deck_id, table, env_uuid))
                    .unwrap_or(None)
            })
            .unwrap_or(None);

        let new_air_base_assault = data
            .clone()
            .air_base_assault
            .map(|assult| AirBaseAssult::new_ret_uuid(assult, table, env_uuid));
        let new_carrier_base_assault = data
            .clone()
            .carrier_base_assault
            .map(|assult| CarrierBaseAssault::new_ret_uuid(assult, table, env_uuid));
        let new_air_base_air_attacks = data
            .clone()
            .air_base_air_attacks
            .map(|attacks| AirBaseAirAttackList::new_ret_uuid(attacks, table, env_uuid));
        let new_opening_air_attack = data
            .clone()
            .opening_air_attack
            .map(|attack| OpeningAirAttack::new_ret_uuid(attack, table, env_uuid));
        // let new_support_attack = data
        //     .clone()
        //     .support_attack
        //     .clone()
        //     .map(|attack| {
        //         if let Some(air) = attack.support_airattack {
        //             SupportAirattack::new_ret_uuid(air, table, env_uuid)
        //         } else if let Some(hourai) = attack.support_hourai {
        //             SupportHourai::new_ret_uuid(hourai, table, env_uuid)
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
                    .map(|hourai| SupportHourai::new_ret_uuid(hourai, table, env_uuid))
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
                    .map(|airattack| SupportAirattack::new_ret_uuid(airattack, table, env_uuid))
                    .unwrap_or(None)
            })
            .unwrap_or(None);
        let new_opening_taisen = data
            .clone()
            .opening_taisen
            .map(|taisen| OpeningTaisenList::new_ret_uuid(taisen, table, env_uuid));
        let new_opening_raigeki = data
            .clone()
            .opening_raigeki
            .map(|raigeki| OpeningRaigeki::new_ret_uuid(raigeki, table, env_uuid));
        let new_hougeki = data
            .clone()
            .hougeki
            .map(|hougeki| HougekiList::new_ret_uuid(hougeki, table, env_uuid))
            .unwrap_or(None);
        let new_closing_raigeki = data
            .clone()
            .closing_raigeki
            .map(|raigeki| ClosingRaigeki::new_ret_uuid(raigeki, table, env_uuid));
        let new_friendly_force_attack = data
            .clone()
            .friendly_force_attack
            .map(|attack| {
                attack
                    .support_hourai
                    .map(|hourai| FriendlySupportHouraiList::new_ret_uuid(hourai, table, env_uuid))
                    .unwrap_or(None)
            })
            .unwrap_or(None);
        let new_midnight_hougeki = MidnightHougekiList::new_ret_uuid(data.clone(), table, env_uuid);
        let new_f_nowhps = data.clone().f_nowhps;
        let new_e_nowhps = data.clone().e_nowhps;
        let new_midngiht_f_nowhps = data.clone().midngiht_f_nowhps;
        let new_midngiht_e_nowhps = data.clone().midngiht_e_nowhps;

        let new_data = Battle {
            version: DATABASE_TABLE_VERSION
                .expect("failed to get table version")
                .to_string(),
            env_uuid,
            uuid: new_uuid,
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
        return Some(new_uuid);
    }
}
