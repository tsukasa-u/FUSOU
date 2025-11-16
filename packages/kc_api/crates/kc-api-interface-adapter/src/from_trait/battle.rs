use chrono::Local;

use crate::InterfaceWrapper;
use kc_api_dto::common as kcapi_common;
use kc_api_dto::common::custom_type::DuoType;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::battle::{
    AirBaseAirAttack, AirBaseAirAttacks, AirBaseAssult, AirDamage, AirFire, Battle, BattleType,
    CarrierBaseAssault, ClosingRaigeki, FriendlyForceAttack, FriendlyForceInfo,
    FriendlySupportHourai, Hougeki, MidnightHougeki, OpeningAirAttack, OpeningRaigeki,
    OpeningTaisen, SupportAiratack, SupportAttack, SupportHourai,
};
use kc_api_interface::cells::KCS_CELLS_INDEX;

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

impl From<kcapi_common::common_air::ApiAirBaseAttack> for InterfaceWrapper<AirBaseAirAttack> {
    fn from(air_base_air_attack: kcapi_common::common_air::ApiAirBaseAttack) -> Self {
        let (f_damage, e_damage) = calc_air_damage(
            air_base_air_attack.api_plane_from.clone(),
            air_base_air_attack.api_stage1.clone(),
            air_base_air_attack.api_stage2.clone(),
            air_base_air_attack.api_stage3.clone(),
            air_base_air_attack.api_stage3_combined.clone(),
        );
        Self(AirBaseAirAttack {
            stage_flag: air_base_air_attack.api_stage_flag,
            squadron_plane: air_base_air_attack
                .api_squadron_plane
                .map(|squadron_planes| {
                    squadron_planes
                        .iter()
                        .map(|squadron_plane| squadron_plane.api_mst_id)
                        .collect()
                }),
            base_id: air_base_air_attack.api_base_id,
            f_damage,
            e_damage,
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

    let f_protect: Option<Vec<bool>> = stage3.clone().and_then(|stage3| {
        stage3
            .api_fdam
            .map(|f_damages| calc_protect_flag(&f_damages))
    });
    let e_protect: Option<Vec<bool>> = stage3.clone().and_then(|stage3| {
        stage3
            .api_edam
            .map(|e_damages| calc_protect_flag(&e_damages))
    });
    let f_protect_combined: Option<Vec<bool>> =
        stage3_combined.clone().and_then(|stage3_combined| {
            stage3_combined
                .api_fdam
                .map(|f_damages| calc_protect_flag(&f_damages))
        });
    let e_protect_combined: Option<Vec<bool>> =
        stage3_combined.clone().and_then(|stage3_combined| {
            stage3_combined
                .api_edam
                .map(|e_damages| calc_protect_flag(&e_damages))
        });

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

    let f_plane_from: Option<Vec<i64>> = plane_from.clone().and_then(|plane_from| {
        plane_from[0]
            .clone()
            .map(|plane_from| plane_from.clone().iter().map(|x| x - 1).collect())
    });
    let e_plane_from: Option<Vec<i64>> = plane_from.clone().and_then(|plane_from| {
        plane_from[1]
            .clone()
            .map(|plane_from| plane_from.clone().iter().map(|x| x - 1).collect())
    });

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
            loss_plane1: stage1
                .clone()
                .map(|stage1| stage1.api_f_lostcount)
                .unwrap_or(0),
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
            loss_plane1: stage1
                .clone()
                .map(|stage1| stage1.api_e_lostcount)
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
        let f_protect_flag: Vec<bool> = calc_protect_flag(&opening_raigeki.api_fdam);
        let e_damages: Vec<f32> = calc_floor(&opening_raigeki.api_edam);
        let e_protect_flag: Vec<bool> = calc_protect_flag(&opening_raigeki.api_edam);

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
        let f_protect_flag: Vec<bool> = calc_protect_flag(&closing_raigeki.api_fdam);
        let e_damages: Vec<f32> = calc_floor(&closing_raigeki.api_edam);
        let e_cl = calc_critical(&e_damages, &closing_raigeki.api_ecl.to_vec());
        let e_protect_flag: Vec<bool> = calc_protect_flag(&closing_raigeki.api_edam);

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

        let damages: Vec<Vec<f32>> = hougeki
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
            .map(|damages| calc_floor(&damages))
            .collect();

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

        let protect_flag: Vec<Vec<bool>> = hougeki
            .api_damage
            .iter()
            .enumerate()
            .map(|(idx, damage)| remove_m1(damage, &hougeki.api_df_list[idx]))
            .map(|damage| calc_protect_flag(&damage))
            .collect();

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

        let damages: Option<Vec<Vec<f32>>> = hougeki.api_damage.clone().and_then(|api_damage| {
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
                        .map(|damages| calc_floor(&damages))
                        .collect()
                })
            })
        });

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

        let protect_flag: Option<Vec<Vec<bool>>> = hougeki.api_damage.and_then(|api_damage| {
            hougeki.api_df_list.clone().map(|df_list| {
                api_damage
                    .iter()
                    .enumerate()
                    .map(|(idx, damage)| remove_m1(damage, &df_list[idx]))
                    .map(|damage| calc_protect_flag(&damage))
                    .collect()
            })
        });

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
        let damages: Vec<f32> = calc_floor(&support_hourai.api_damage);
        let cl_list: Vec<i64> = calc_critical(&damages, &support_hourai.api_cl_list);
        let protect_flag: Vec<bool> = calc_protect_flag(&damages);
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
            f_damage,
            e_damage,
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
        Self(CarrierBaseAssault { f_damage, e_damage })
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

    let battle_order: Vec<BattleType> = battle.battle_order.clone().unwrap();

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

        let battle_order: Vec<BattleType> = vec![
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
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
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
        });
        calc_dmg(&mut ret.0);
        ret
    }
}

impl From<kcapi_main::api_req_battle_midnight::battle::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_battle_midnight::battle::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> =
            Some(InterfaceWrapper::from(battle.api_hougeki).unwrap());
        let friendly_force_attack: Option<FriendlyForceAttack> =
            if battle.api_friendly_info.is_some() && battle.api_friendly_battle.is_some() {
                Some(
                    InterfaceWrapper::from_api_data(
                        battle.api_friendly_info.unwrap(),
                        battle.api_friendly_battle.unwrap(),
                    )
                    .unwrap(),
                )
            } else {
                None
            };

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
            BattleType::AirBaseAssult(()),
            BattleType::CarrierBaseAssault(()),
            BattleType::AirBaseAirAttack(()),
            BattleType::OpeningAirAttack(0),
            BattleType::OpeningAirAttack(1),
            BattleType::SupportAttack(()),
            BattleType::OpeningTaisen(()),
            BattleType::OpeningRaigeki(()),
            BattleType::Hougeki(0),
            BattleType::Hougeki(1),
            BattleType::ClosingRaigeki(()),
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
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
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
        });
        calc_dmg(&mut ret.0);
        ret
    }
}

impl From<kcapi_main::api_req_battle_midnight::sp_midnight::ApiData> for InterfaceWrapper<Battle> {
    fn from(battle: kcapi_main::api_req_battle_midnight::sp_midnight::ApiData) -> Self {
        let midnight_hougeki: Option<MidnightHougeki> =
            Some(InterfaceWrapper::from(battle.api_hougeki).unwrap());
        let friendly_force_attack: Option<FriendlyForceAttack> = None;

        let cell_no = KCS_CELLS_INDEX
            .lock()
            .map(|cells| *cells.last().unwrap_or(&0))
            .unwrap_or(0);

        let battle_order: Vec<BattleType> = vec![
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
            e_slot: Some(battle.api_e_slot),
            e_hp_max: Some(battle.api_e_maxhps),
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
        });
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

        let battle_order: Vec<BattleType> = vec![
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
            e_slot: Some(airbattle.api_e_slot),
            e_hp_max: Some(airbattle.api_e_maxhps),
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
        });
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

        let battle_order: Vec<BattleType> = vec![
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
            e_slot: Some(airbattle.api_e_slot),
            e_hp_max: Some(airbattle.api_e_maxhps),
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
        });
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
