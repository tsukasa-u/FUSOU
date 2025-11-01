use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_member::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(
    get_event_selected_reward,
    get_incentive,
    get_practice_enemyinfo,
    itemuse,
    itemuse_cond,
    payitemuse,
    set_flagship_position,
    set_friendly_request,
    set_option_setting,
    set_oss_condition,
    updatecomment,
    updatedeckname
);
