use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::models::airbase::AirBase;
use crate::models::airbase::AirBaseId;
use crate::models::deck::EnemyDeck;
use crate::models::deck::EnemyDeckId;
use crate::models::deck::FriendDeck;
use crate::models::deck::FriendDeckId;
use crate::models::deck::OwnDeck;
use crate::models::deck::OwnDeckId;
use crate::models::deck::SupportDeck;
use crate::models::deck::SupportDeckId;
use crate::models::env_info::EnvInfoId;
use crate::table::PortTable;
use kc_api_interface::air_base::AirBases;
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::ship::Ships;

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

trait IntoI32 {
    type Output;
    fn into_i32(self) -> Self::Output;
}

impl IntoI32 for i64 {
    type Output = i32;

    fn into_i32(self) -> Self::Output {
        self as i32
    }
}

impl IntoI32 for f32 {
    type Output = i32;

    fn into_i32(self) -> Self::Output {
        self as i32
    }
}

impl<T: IntoI32> IntoI32 for Option<T> {
    type Output = Option<T::Output>;

    fn into_i32(self) -> Self::Output {
        self.map(|value| value.into_i32())
    }
}

impl<T: IntoI32> IntoI32 for Vec<T> {
    type Output = Vec<T::Output>;

    fn into_i32(self) -> Self::Output {
        self.into_iter().map(|value| value.into_i32()).collect()
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
pub struct HougekiList {
    pub env_uuid: EnvInfoId,
    pub uuid: HougekiListId,
    pub hougeki: Option<HougekiId>,
}

impl HougekiList {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: Vec<Option<kc_api_interface::battle::Hougeki>>,
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
                Some(hougeki) => Hougeki::new_ret_option(
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

        new_data.hougeki?;

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
    pub index_1: i32,
    pub index_2: i32,
    pub at: i32,
    pub at_type: i32,
    pub df: Vec<i32>,
    pub cl: Vec<i32>,
    pub damage: Vec<i32>,
    pub at_eflag: i32,
    pub si: Vec<Option<i32>>,
    pub protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i32>,
    pub e_now_hps: Vec<i32>,
}

impl Hougeki {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::Hougeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let data_len = data.at_list.len();
        (0..data_len).for_each(|i| {
            let new_data = Hougeki {
                env_uuid,
                uuid,
                index_1: index as i32,
                index_2: i as i32,
                at: data.at_list[i] as i32,
                at_type: data.at_type[i] as i32,
                df: data.df_list[i].clone().into_i32(),
                cl: data.cl_list[i].clone().into_i32(),
                damage: data.damage[i].clone().into_i32(),
                at_eflag: data.at_eflag[i] as i32,
                si: data.si_list[i].clone().into_i32(),
                protect_flag: data.protect_flag[i].clone(),
                f_now_hps: data.f_now_hps[i].clone().into_i32(),
                e_now_hps: data.e_now_hps[i].clone().into_i32(),
            };

            table.hougeki.push(new_data);
        });

        Some(())
    }

    // pub fn encode(data: Vec<HougekiList>) -> Result<Vec<u8>, apache_avro::Error> {
    //     let schema = HougekiList::get_schema();
    //     let mut writer = Writer::with_codec(&schema, Vec::new_ret_option(), Codec::Deflate);
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
    pub f_flare_pos: Option<i32>,
    pub f_touch_plane: Option<i32>,
    pub e_flare_pos: Option<i32>,
    pub e_touch_plane: Option<i32>,
    pub midnight_hougeki: Option<MidnightHougekiId>,
}

impl MidnightHougekiList {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_midnight_hougeki = Uuid::new_v7(ts);
        let result = data.midnight_hougeki.and_then(|midnight_hougeki| {
            MidnightHougeki::new_ret_option(
                ts,
                new_midnight_hougeki,
                midnight_hougeki,
                table,
                env_uuid,
            )
            .map(|_| new_midnight_hougeki)
        });
        let new_midnight_hougeki_wrap = result.map(|_| new_midnight_hougeki);

        let new_data = MidnightHougekiList {
            env_uuid,
            uuid,
            f_flare_pos: data
                .midnight_flare_pos
                .clone()
                .map(|pos| pos[0] as i32),
            f_touch_plane: data
                .midnight_touchplane
                .clone()
                .map(|plane| plane[0] as i32),
            e_flare_pos: data
                .midnight_flare_pos
                .clone()
                .map(|pos| pos[1] as i32),
            e_touch_plane: data
                .midnight_touchplane
                .clone()
                .map(|plane| plane[1] as i32),
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
    pub index: i32,
    pub at: Option<i32>,
    pub df: Option<Vec<i32>>,
    pub cl: Option<Vec<i32>>,
    pub damage: Option<Vec<i32>>,
    pub at_eflag: Option<i32>,
    pub si: Option<Vec<Option<i32>>>,
    pub protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Option<Vec<i32>>,
    pub e_now_hps: Option<Vec<i32>>,
}

impl MidnightHougeki {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::MidnightHougeki,
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
                        index: i as i32,
                        at: data
                            .at_list
                            .clone()
                            .map(|values| values[i] as i32),
                        df: data
                            .df_list
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        cl: data
                            .cl_list
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        damage: data
                            .damage
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        at_eflag: data
                            .at_eflag
                            .clone()
                            .map(|values| values[i] as i32),
                        si: data
                            .si_list
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        protect_flag: data.protect_flag.clone().map(|x| x[i].clone()),
                        f_now_hps: Some(data.f_now_hps.clone()[i].clone().into_i32()),
                        e_now_hps: Some(data.e_now_hps.clone()[i].clone().into_i32()),
                    };

                    table.midnight_hougeki.push(new_data);
                });
                return Some(());
            }
            None => None,
        };

        ret
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
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::OpeningTaisen,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_opening_taisen = Uuid::new_v7(ts);
        let result = OpeningTaisen::new_ret_option(ts, new_opening_taisen, data, table, env_uuid);
        let new_opening_taisen_wrap = result.map(|_| new_opening_taisen);

        let new_data = OpeningTaisenList {
            env_uuid,
            uuid,
            opening_taisen: new_opening_taisen_wrap,
        };

        new_data.opening_taisen?;

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
    pub index: i32,
    pub at: i32,
    pub at_type: i32,
    pub df: Vec<i32>,
    pub cl: Vec<i32>,
    pub damage: Vec<i32>,
    pub at_eflag: i32,
    pub si: Vec<Option<i32>>,
    pub protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i32>,
    pub e_now_hps: Vec<i32>,
}

impl OpeningTaisen {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::OpeningTaisen,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let data_len = data.at_list.clone().len();
        (0..data_len).for_each(|i| {
            let new_data = OpeningTaisen {
                env_uuid,
                uuid,
                index: i as i32,
                at: data.at_list.clone()[i] as i32,
                at_type: data.at_type.clone()[i] as i32,
                df: data.df_list.clone()[i].clone().into_i32(),
                cl: data.cl_list.clone()[i].clone().into_i32(),
                damage: data.damage.clone()[i].clone().into_i32(),
                at_eflag: data.at_eflag.clone()[i] as i32,
                si: data.si_list.clone()[i].clone().into_i32(),
                protect_flag: data.protect_flag.clone()[i].clone(),
                f_now_hps: data.f_now_hps.clone()[i].clone().into_i32(),
                e_now_hps: data.e_now_hps.clone()[i].clone().into_i32(),
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
    pub f_dam: Vec<i32>,
    pub e_dam: Vec<i32>,
    pub f_rai: Vec<i32>,
    pub e_rai: Vec<i32>,
    pub f_cl: Vec<i32>,
    pub e_cl: Vec<i32>,
    pub f_protect_flag: Vec<bool>,
    pub e_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i32>,
    pub e_now_hps: Vec<i32>,
}

impl ClosingRaigeki {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::ClosingRaigeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = ClosingRaigeki {
            env_uuid,
            uuid,
            f_dam: data.fdam.clone().into_i32(),
            e_dam: data.edam.clone().into_i32(),
            f_rai: data
                .frai
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_rai: data
                .erai
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            f_cl: data
                .fcl
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_cl: data
                .ecl
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            f_protect_flag: data.f_protect_flag,
            e_protect_flag: data.e_protect_flag,
            f_now_hps: data
                .f_now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_now_hps: data
                .e_now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
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
    pub f_dam: Vec<i32>,
    pub e_dam: Vec<i32>,
    pub f_rai: Vec<Option<Vec<i32>>>,
    pub e_rai: Vec<Option<Vec<i32>>>,
    pub f_cl: Vec<i32>,
    pub e_cl: Vec<i32>,
    pub f_protect_flag: Vec<bool>,
    pub e_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i32>,
    pub e_now_hps: Vec<i32>,
}

impl OpeningRaigeki {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::OpeningRaigeki,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = OpeningRaigeki {
            env_uuid,
            uuid,
            f_dam: data.fdam.clone().into_i32(),
            e_dam: data.edam.clone().into_i32(),
            f_rai: data
                .frai_list_items
                .into_iter()
                .map(|value| value.into_i32())
                .collect(),
            e_rai: data
                .erai_list_items
                .into_iter()
                .map(|value| value.into_i32())
                .collect(),
            f_cl: data
                .fcl_list
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_cl: data
                .ecl_list
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            f_protect_flag: data.f_protect_flag,
            e_protect_flag: data.e_protect_flag,
            f_now_hps: data
                .f_now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_now_hps: data
                .e_now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
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
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: Vec<Option<kc_api_interface::battle::OpeningAirAttack>>,
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
                    Some(opening_air_attack) => OpeningAirAttack::new_ret_option(
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

        new_data.opening_air_attack?;

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
    pub index: i32,
    pub f_plane_from: Option<Vec<i32>>,
    pub f_touch_plane: Option<i32>,
    pub f_loss_plane1: i32,
    pub f_loss_plane2: i32,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i32>>,
    pub f_rai_flag: Option<Vec<Option<i32>>>,
    pub f_bak_flag: Option<Vec<Option<i32>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i32>,
    pub e_plane_from: Option<Vec<i32>>,
    pub e_touch_plane: Option<i32>,
    pub e_loss_plane1: i32,
    pub e_loss_plane2: i32,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i32>>,
    pub e_rai_flag: Option<Vec<Option<i32>>>,
    pub e_bak_flag: Option<Vec<Option<i32>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i32>,
    pub airfire_idx: Option<i32>,
    pub airfire_use_item: Option<Vec<i32>>,
    pub air_superiority: Option<i32>,
}

impl OpeningAirAttack {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::OpeningAirAttack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let new_data = OpeningAirAttack {
            env_uuid,
            uuid,
            index: index as i32,
            f_plane_from: data.f_damage.plane_from.into_i32(),
            f_touch_plane: data.f_damage.touch_plane.into_i32(),
            f_loss_plane1: data.f_damage.loss_plane1 as i32,
            f_loss_plane2: data.f_damage.loss_plane2 as i32,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl.into_i32(),
            f_rai_flag: data.f_damage.rai_flag.into_i32(),
            f_bak_flag: data.f_damage.bak_flag.into_i32(),
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data.f_damage.now_hps.into_iter().map(|value| value as i32).collect(),
            e_plane_from: data.e_damage.plane_from.into_i32(),
            e_touch_plane: data.e_damage.touch_plane.into_i32(),
            e_loss_plane1: data.e_damage.loss_plane1 as i32,
            e_loss_plane2: data.e_damage.loss_plane2 as i32,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl.into_i32(),
            e_rai_flag: data.e_damage.rai_flag.into_i32(),
            e_bak_flag: data.e_damage.bak_flag.into_i32(),
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data.e_damage.now_hps.into_iter().map(|value| value as i32).collect(),
            airfire_idx: data.air_fire.clone().map(|fire| fire.idx as i32),
            airfire_use_item: data
                .air_fire
                .clone()
                .map(|fire| fire.use_item.into_iter().map(|value| value as i32).collect()),
            air_superiority: data.air_superiority.map(|value| value as i32),
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
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::AirBaseAirAttacks,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_air_base_air_attack = Uuid::new_v7(ts);
        let result = data
            .attacks
            .iter()
            .enumerate()
            .map(|(air_base_air_attack_index, air_base_air_attack)| {
                AirBaseAirAttack::new_ret_option(
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

        new_data.air_base_air_attack?;

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
    pub index: i32,
    pub f_plane_from: Option<Vec<i32>>,
    pub f_touch_plane: Option<i32>,
    pub f_loss_plane1: i32,
    pub f_loss_plane2: i32,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i32>>,
    pub f_rai_flag: Option<Vec<Option<i32>>>,
    pub f_bak_flag: Option<Vec<Option<i32>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i32>,
    pub e_plane_from: Option<Vec<i32>>,
    pub e_touch_plane: Option<i32>,
    pub e_loss_plane1: i32,
    pub e_loss_plane2: i32,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i32>>,
    pub e_rai_flag: Option<Vec<Option<i32>>>,
    pub e_bak_flag: Option<Vec<Option<i32>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i32>,
    pub airbase_id: AirBaseId,
    pub squadron_plane: Option<Vec<Option<i32>>>,
}

impl AirBaseAirAttack {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::AirBaseAirAttack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) -> Option<()> {
        let air_bases = AirBases::load();
        let air_base = match air_bases.bases.get(&(data.base_id).to_string()) {
            Some(air_base) => air_base,
            None => {
                tracing::warn!("AirBaseAirAttack: AirBase ID {} not found", data.base_id);
                return None;
            }
        };

        // ------------------------------------------------------------------------
        // Create AirBase record
        let new_airbase_id = Uuid::new_v7(ts);
        let result = AirBase::new_ret_option(ts, new_airbase_id, air_base.clone(), table, env_uuid);
        let _new_airbase_id_wrap = result.map(|_| new_airbase_id);
        // ------------------------------------------------------------------------

        let new_data = AirBaseAirAttack {
            env_uuid,
            uuid,
            index: index as i32,
            f_plane_from: data.f_damage.plane_from.into_i32(),
            f_touch_plane: data.f_damage.touch_plane.into_i32(),
            f_loss_plane1: data.f_damage.loss_plane1 as i32,
            f_loss_plane2: data.f_damage.loss_plane2 as i32,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl.into_i32(),
            f_rai_flag: data.f_damage.rai_flag.into_i32(),
            f_bak_flag: data.f_damage.bak_flag.into_i32(),
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data
                .f_damage
                .now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_plane_from: data.e_damage.plane_from.into_i32(),
            e_touch_plane: data.e_damage.touch_plane.into_i32(),
            e_loss_plane1: data.e_damage.loss_plane1 as i32,
            e_loss_plane2: data.e_damage.loss_plane2 as i32,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl.into_i32(),
            e_rai_flag: data.e_damage.rai_flag.into_i32(),
            e_bak_flag: data.e_damage.bak_flag.into_i32(),
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data
                .e_damage
                .now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            airbase_id: new_airbase_id,
            squadron_plane: data.squadron_plane.into_i32(),
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
    pub squadron_plane: Vec<i32>,
    pub f_plane_from: Option<Vec<i32>>,
    pub f_touch_plane: Option<i32>,
    pub f_loss_plane1: i32,
    pub f_loss_plane2: i32,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i32>>,
    pub f_rai_flag: Option<Vec<Option<i32>>>,
    pub f_bak_flag: Option<Vec<Option<i32>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i32>,
    pub e_plane_from: Option<Vec<i32>>,
    pub e_touch_plane: Option<i32>,
    pub e_loss_plane1: i32,
    pub e_loss_plane2: i32,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i32>>,
    pub e_rai_flag: Option<Vec<Option<i32>>>,
    pub e_bak_flag: Option<Vec<Option<i32>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i32>,
}

impl AirBaseAssult {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::AirBaseAssult,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = AirBaseAssult {
            env_uuid,
            uuid,
            squadron_plane: data
                .squadron_plane
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            f_plane_from: data.f_damage.plane_from.into_i32(),
            f_touch_plane: data.f_damage.touch_plane.into_i32(),
            f_loss_plane1: data.f_damage.loss_plane1 as i32,
            f_loss_plane2: data.f_damage.loss_plane2 as i32,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl.into_i32(),
            f_rai_flag: data.f_damage.rai_flag.into_i32(),
            f_bak_flag: data.f_damage.bak_flag.into_i32(),
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data
                .f_damage
                .now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_plane_from: data.e_damage.plane_from.into_i32(),
            e_touch_plane: data.e_damage.touch_plane.into_i32(),
            e_loss_plane1: data.e_damage.loss_plane1 as i32,
            e_loss_plane2: data.e_damage.loss_plane2 as i32,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl.into_i32(),
            e_rai_flag: data.e_damage.rai_flag.into_i32(),
            e_bak_flag: data.e_damage.bak_flag.into_i32(),
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data
                .e_damage
                .now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
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
    pub f_plane_from: Option<Vec<i32>>,
    pub f_touch_plane: Option<i32>,
    pub f_loss_plane1: i32,
    pub f_loss_plane2: i32,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i32>>,
    pub f_rai_flag: Option<Vec<Option<i32>>>,
    pub f_bak_flag: Option<Vec<Option<i32>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i32>,
    pub e_plane_from: Option<Vec<i32>>,
    pub e_touch_plane: Option<i32>,
    pub e_loss_plane1: i32,
    pub e_loss_plane2: i32,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i32>>,
    pub e_rai_flag: Option<Vec<Option<i32>>>,
    pub e_bak_flag: Option<Vec<Option<i32>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i32>,
}

impl CarrierBaseAssault {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::CarrierBaseAssault,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_data = CarrierBaseAssault {
            env_uuid,
            uuid,
            f_plane_from: data.f_damage.plane_from.into_i32(),
            f_touch_plane: data.f_damage.touch_plane.into_i32(),
            f_loss_plane1: data.f_damage.loss_plane1 as i32,
            f_loss_plane2: data.f_damage.loss_plane2 as i32,
            f_damages: data.f_damage.damages,
            f_cl: data.f_damage.cl.into_i32(),
            f_rai_flag: data.f_damage.rai_flag.into_i32(),
            f_bak_flag: data.f_damage.bak_flag.into_i32(),
            f_protect_flag: data.f_damage.protect_flag,
            f_now_hps: data
                .f_damage
                .now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_plane_from: data.e_damage.plane_from.into_i32(),
            e_touch_plane: data.e_damage.touch_plane.into_i32(),
            e_loss_plane1: data.e_damage.loss_plane1 as i32,
            e_loss_plane2: data.e_damage.loss_plane2 as i32,
            e_damages: data.e_damage.damages,
            e_cl: data.e_damage.cl.into_i32(),
            e_rai_flag: data.e_damage.rai_flag.into_i32(),
            e_bak_flag: data.e_damage.bak_flag.into_i32(),
            e_protect_flag: data.e_damage.protect_flag,
            e_now_hps: data
                .e_damage
                .now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
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
    pub f_cl: Vec<i32>,
    pub f_damage: Vec<i32>,
    pub f_protect_flag: Vec<bool>,
    pub f_now_hps: Vec<i32>,
    pub e_cl: Vec<i32>,
    pub e_damage: Vec<i32>,
    pub e_protect_flag: Vec<bool>,
    pub e_now_hps: Vec<i32>,
}

impl SupportHourai {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::SupportHourai,
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
                as i32
            })
            .collect();

        // let new_deck_id = SupportDeck::new_ret_option(deck.clone(), table, env_uuid)?;

        let deck_len = deck.ship.clone().unwrap().len();
        let new_vec_0 = vec![0i32; deck_len];
        let new_vec_false = vec![false; deck_len];

        let new_data = SupportHourai {
            env_uuid,
            uuid,
            f_cl: new_vec_0.clone(),
            f_damage: new_vec_0,
            f_protect_flag: new_vec_false,
            f_now_hps: new_f_now_hps,
            e_cl: data
                .cl_list
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            e_damage: data.damage.iter().map(|x| (*x) as i32).collect(),
            e_protect_flag: data.protect_flag,
            e_now_hps: data
                .now_hps
                .into_iter()
                .map(|value| value as i32)
                .collect(),
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
    pub f_plane_from: Option<Vec<i32>>,
    pub f_touch_plane: Option<i32>,
    pub f_loss_plane: i32,
    pub f_damages: Option<Vec<f32>>,
    pub f_cl: Option<Vec<i32>>,
    pub f_rai_flag: Option<Vec<Option<i32>>>,
    pub f_bak_flag: Option<Vec<Option<i32>>>,
    pub f_protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Vec<i32>,
    pub e_plane_from: Option<Vec<i32>>,
    pub e_touch_plane: Option<i32>,
    pub e_loss_plane: i32,
    pub e_damages: Option<Vec<f32>>,
    pub e_cl: Option<Vec<i32>>,
    pub e_rai_flag: Option<Vec<Option<i32>>>,
    pub e_bak_flag: Option<Vec<Option<i32>>>,
    pub e_protect_flag: Option<Vec<bool>>,
    pub e_now_hps: Vec<i32>,
}

impl SupportAirattack {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::SupportAiratack,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let decks = DeckPorts::load();
        let deck = decks.deck_ports.get(&data.deck_id)?;

        let ship_ids = match deck.ship.clone() {
            Some(ship_ids) if !ship_ids.is_empty() => ship_ids,
            _ => return None,
        };

        let ships = Ships::load();

        let new_f_now_hps: Vec<i32> = ship_ids
            .iter()
            .map(|ship_id| {
                ships
                    .ships
                    .get(ship_id)
                    .and_then(|ship| ship.nowhp.map(|hp| hp as i32))
                    .unwrap_or(0)
            })
            .collect();

        let f_damage = data.f_damage;
        let e_damage = data.e_damage;

        let new_data = SupportAirattack {
            env_uuid,
            uuid,
            f_plane_from: f_damage.plane_from.into_i32(),
            f_touch_plane: f_damage.touch_plane.into_i32(),
            f_loss_plane: f_damage.loss_plane1 as i32,
            f_damages: f_damage.damages,
            f_cl: f_damage.cl.into_i32(),
            f_rai_flag: f_damage.rai_flag.into_i32(),
            f_bak_flag: f_damage.bak_flag.into_i32(),
            f_protect_flag: f_damage.protect_flag,
            f_now_hps: new_f_now_hps,
            e_plane_from: e_damage.plane_from.into_i32(),
            e_touch_plane: e_damage.touch_plane.into_i32(),
            e_loss_plane: e_damage.loss_plane1 as i32,
            e_damages: e_damage.damages,
            e_cl: e_damage.cl.into_i32(),
            e_rai_flag: e_damage.rai_flag.into_i32(),
            e_bak_flag: e_damage.bak_flag.into_i32(),
            e_protect_flag: e_damage.protect_flag,
            e_now_hps: e_damage.now_hps.into_i32(),
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
    pub f_flare_pos: Option<i32>,
    pub e_flare_pos: Option<i32>,
    pub hourai_list: Option<FriendlySupportHouraiId>,
}

impl FriendlySupportHouraiList {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::FriendlySupportHourai,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
    ) -> Option<()> {
        let new_hourai_list = Uuid::new_v7(ts);
        let kc_api_interface::battle::FriendlySupportHourai { flare_pos, hougeki } = data;

        let result = FriendlySupportHourai::new_ret_option(
            ts,
            new_hourai_list,
            hougeki,
            table,
            env_uuid,
        );
        let new_hourai_list_wrap = result.map(|_| new_hourai_list);

        let flare_pos: Vec<i32> = flare_pos.into_i32();
        let new_f_flare_pos = flare_pos
            .get(0)
            .copied()
            .filter(|value| *value != -1);
        let new_e_flare_pos = flare_pos
            .get(1)
            .copied()
            .filter(|value| *value != -1);

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
    pub index: i32,
    pub at: Option<i32>,
    pub df: Option<Vec<i32>>,
    pub cl: Option<Vec<i32>>,
    pub damage: Option<Vec<i32>>,
    pub at_eflag: Option<i32>,
    pub si: Option<Vec<Option<i32>>>,
    pub protect_flag: Option<Vec<bool>>,
    pub f_now_hps: Option<Vec<i32>>,
    pub e_now_hps: Option<Vec<i32>>,
}

impl FriendlySupportHourai {
    pub fn new_ret_option(
        _ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::MidnightHougeki,
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
                        index: i as i32,
                        at: data
                            .at_list
                            .clone()
                            .map(|values| values[i] as i32),
                        df: data
                            .df_list
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        cl: data
                            .cl_list
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        damage: data
                            .damage
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        at_eflag: data
                            .at_eflag
                            .clone()
                            .map(|values| values[i] as i32),
                        si: data
                            .si_list
                            .clone()
                            .map(|values| values[i].clone().into_i32()),
                        protect_flag: data.protect_flag.clone().map(|x| x[i].clone()),
                        f_now_hps: Some(data.f_now_hps.clone()[i].clone().into_i32()),
                        e_now_hps: Some(data.e_now_hps.clone()[i].clone().into_i32()),
                    };

                    table.midnight_hougeki.push(new_data);
                });
                Some(())
            }
            None => None,
        };

        ret
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
    pub index: i32,
    pub battle_order: Vec<i32>,
    pub timestamp: Option<i64>,
    pub midnight_timestamp: Option<i64>,
    pub cell_id: i32,
    pub f_deck_id: Option<OwnDeckId>,
    pub e_deck_id: Option<EnemyDeckId>,
    pub friend_deck_id: Option<FriendDeckId>,
    pub support_deck_id: Option<SupportDeckId>,
    pub f_formation: Option<i32>,
    pub e_formation: Option<i32>,
    pub f_total_damages: Option<Vec<i32>>,
    pub e_total_damages: Option<Vec<i32>>,
    pub friend_total_damages: Option<Vec<i32>>,
    pub midnight_f_total_damages: Option<Vec<i32>>,
    pub midnight_e_total_damages: Option<Vec<i32>>,
    pub f_reconnaissance: Option<i32>,
    pub e_reconnaissance: Option<i32>,
    pub f_escape_idx: Option<Vec<i32>>,
    pub smoke_type: Option<i32>,
    pub f_combat_ration: Option<Vec<i32>>,
    pub balloon_flag: Option<i32>,
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
    pub f_nowhps: Option<Vec<i32>>,
    pub e_nowhps: Option<Vec<i32>>,
    pub midnight_f_nowhps: Option<Vec<i32>>,
    pub midnight_e_nowhps: Option<Vec<i32>>,
}

impl Battle {
    pub fn new_ret_option(
        ts: uuid::Timestamp,
        uuid: Uuid,
        data: kc_api_interface::battle::Battle,
        table: &mut PortTable,
        env_uuid: EnvInfoId,
        index: usize,
    ) {
        let new_battle_order: Vec<i32> = data
            .clone()
            .battle_order
            .map(|order| {
                order
                    .into_iter()
                    .map(|battle_type| {
                        let value: i64 = battle_type.into();
                        value as i32
                    })
                    .collect()
            })
            .unwrap_or_default();

        let new_f_deck_id = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .deck_id
                .and_then(|deck_id| OwnDeck::new_ret_option(ts, uuid, deck_id, table, env_uuid))
                .map(|_| uuid)
        };
        let new_e_deck_id = {
            let uuid = Uuid::new_v7(ts);
            EnemyDeck::new_ret_option(ts, uuid, data.clone(), table, env_uuid).map(|_| uuid)
        };
        let new_friend_deck_id = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .friendly_force_attack
                .and_then(|attack| {
                    FriendDeck::new_ret_option(ts, uuid, attack.fleet_info, table, env_uuid)
                })
                .map(|_| uuid)
        };
        let new_support_deck_id = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .support_attack
                .and_then(|attack| {
                    attack
                        .support_airatack
                        .map(|air| air.deck_id)
                        .or(attack.support_hourai.map(|hourai| hourai.deck_id))
                        .and_then(|deck_id| {
                            SupportDeck::new_ret_option(ts, uuid, deck_id, table, env_uuid)
                        })
                })
                .map(|_| uuid)
        };
        let new_air_base_assault = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .air_base_assault
                .and_then(|assult| AirBaseAssult::new_ret_option(ts, uuid, assult, table, env_uuid))
                .map(|_| uuid)
        };
        let new_carrier_base_assault = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .carrier_base_assault
                .and_then(|assult| {
                    CarrierBaseAssault::new_ret_option(ts, uuid, assult, table, env_uuid)
                })
                .map(|_| uuid)
        };
        let new_air_base_air_attacks = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .air_base_air_attacks
                .and_then(|attacks| {
                    AirBaseAirAttackList::new_ret_option(ts, uuid, attacks, table, env_uuid)
                })
                .map(|_| uuid)
        };
        let new_opening_air_attack = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .opening_air_attack
                .and_then(|attack| {
                    OpeningAirAttackList::new_ret_option(ts, uuid, attack, table, env_uuid)
                })
                .map(|_| uuid)
        };
        let new_support_hourai = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .support_attack
                .clone()
                .and_then(|attack| {
                    attack.support_hourai.and_then(|hourai| {
                        SupportHourai::new_ret_option(ts, uuid, hourai, table, env_uuid)
                    })
                })
                .map(|_| uuid)
        };
        let new_support_airattack = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .support_attack
                .clone()
                .and_then(|attack| {
                    attack.support_airatack.and_then(|airattack| {
                        SupportAirattack::new_ret_option(ts, uuid, airattack, table, env_uuid)
                    })
                })
                .map(|_| uuid)
        };
        let new_opening_taisen = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .opening_taisen
                .map(|taisen| OpeningTaisenList::new_ret_option(ts, uuid, taisen, table, env_uuid))
                .map(|_| uuid)
        };
        let new_opening_raigeki = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .opening_raigeki
                .map(|raigeki| OpeningRaigeki::new_ret_option(ts, uuid, raigeki, table, env_uuid))
                .map(|_| uuid)
        };
        let new_hougeki = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .hougeki
                .and_then(|hougeki| HougekiList::new_ret_option(ts, uuid, hougeki, table, env_uuid))
                .map(|_| uuid)
        };
        let new_closing_raigeki = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .closing_raigeki
                .map(|raigeki| ClosingRaigeki::new_ret_option(ts, uuid, raigeki, table, env_uuid))
                .map(|_| uuid)
        };
        let new_friendly_force_attack = {
            let uuid = Uuid::new_v7(ts);
            data.clone()
                .friendly_force_attack
                .and_then(|attack| {
                    attack.support_hourai.and_then(|hourai| {
                        FriendlySupportHouraiList::new_ret_option(ts, uuid, hourai, table, env_uuid)
                    })
                })
                .map(|_| uuid)
        };
        let new_midnight_hougeki = {
            let uuid = Uuid::new_v7(ts);
            MidnightHougekiList::new_ret_option(ts, uuid, data.clone(), table, env_uuid)
                .map(|_| uuid)
        };
        let new_f_nowhps = data.clone().f_nowhps;
        let new_e_nowhps = data.clone().e_nowhps;
        let new_midnight_f_nowhps = data.clone().midnight_f_nowhps;
        let new_midnight_e_nowhps = data.clone().midnight_e_nowhps;

        let new_data = Battle {
            env_uuid,
            uuid,
            index: index as i32,
            battle_order: new_battle_order,
            timestamp: data.clone().timestamp,
            midnight_timestamp: data.clone().midnight_timestamp,
            cell_id: data.clone().cell_id as i32,
            f_deck_id: new_f_deck_id,
            e_deck_id: new_e_deck_id,
            friend_deck_id: new_friend_deck_id,
            support_deck_id: new_support_deck_id,
            f_formation: data
                .clone()
                .formation
                .map(|formation| formation[0] as i32),
            e_formation: data
                .clone()
                .formation
                .map(|formation| formation[1] as i32),
            f_total_damages: data
                .clone()
                .f_total_damages
                .map(|values| values.into_i32()),
            e_total_damages: data
                .clone()
                .e_total_damages
                .map(|values| values.into_i32()),
            friend_total_damages: data
                .clone()
                .friend_total_damages
                .map(|values| values.into_i32()),
            midnight_f_total_damages: data
                .clone()
                .midnight_f_total_damages
                .map(|values| values.into_i32()),
            midnight_e_total_damages: data
                .clone()
                .midnight_e_total_damages
                .map(|values| values.into_i32()),
            f_reconnaissance: data
                .clone()
                .reconnaissance
                .map(|recon| recon[0] as i32),
            e_reconnaissance: data
                .clone()
                .reconnaissance
                .map(|recon| recon[1] as i32),
            f_escape_idx: data
                .clone()
                .escape_idx
                .map(|values| values.into_i32()),
            smoke_type: data.clone().smoke_type.map(|value| value as i32),
            f_combat_ration: data
                .clone()
                .combat_ration
                .map(|values| values.into_i32()),
            balloon_flag: data.clone().balloon_flag.map(|value| value as i32),
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
            f_nowhps: new_f_nowhps.map(|values| values.into_i32()),
            e_nowhps: new_e_nowhps.map(|values| values.into_i32()),
            midnight_f_nowhps: new_midnight_f_nowhps.map(|values| values.into_i32()),
            midnight_e_nowhps: new_midnight_e_nowhps.map(|values| values.into_i32()),
        };

        table.battle.push(new_data);
    }
}
