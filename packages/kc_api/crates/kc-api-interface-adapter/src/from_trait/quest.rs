use chrono::Local;
use std::collections::HashMap;

use crate::InterfaceWrapper;
use kc_api_dto::endpoints::api_get_member::questlist as dto_questlist;
use kc_api_interface::quest::{Quest, QuestCompletion, Quests};

fn normalize_quest_detail(raw: String) -> String {
    raw.replace("<br />", "\n")
        .replace("<br/>", "\n")
        .replace("<br>", "\n")
}

impl From<dto_questlist::ApiList> for InterfaceWrapper<Quest> {
    fn from(data: dto_questlist::ApiList) -> Self {
        let detail = normalize_quest_detail(data.api_detail);
        Self(Quest {
            no: data.api_no,
            category: data.api_category,
            quest_type: data.api_type,
            label_type: data.api_label_type,
            state: data.api_state,
            title: data.api_title,
            detail,
            voice_id: data.api_voice_id,
            get_material: data.api_get_material,
            bonus_flag: data.api_bonus_flag,
            progress_flag: data.api_progress_flag,
            invalid_flag: data.api_invalid_flag,
            lost_badges: data.api_lost_badges,
        })
    }
}

impl From<dto_questlist::ApiCList> for InterfaceWrapper<QuestCompletion> {
    fn from(data: dto_questlist::ApiCList) -> Self {
        Self(QuestCompletion {
            no: data.api_no,
            state: data.api_state,
            progress_flag: data.api_progress_flag,
            c_flag: data.api_c_flag,
        })
    }
}

impl From<dto_questlist::Res> for InterfaceWrapper<Quests> {
    fn from(data: dto_questlist::Res) -> Self {
        let quests = data
            .api_data
            .api_list
            .unwrap_or_default()
            .into_iter()
            .map(|quest| {
                let q = InterfaceWrapper::<Quest>::from(quest).unwrap();
                (q.no, q)
            })
            .collect::<HashMap<_, _>>();

        let completed = data
            .api_data
            .api_c_list
            .unwrap_or_default()
            .into_iter()
            .map(|entry| {
                let q = InterfaceWrapper::<QuestCompletion>::from(entry).unwrap();
                (q.no, q)
            })
            .collect::<HashMap<_, _>>();

        Self(Quests {
            timestamp: Some(Local::now().timestamp_millis()),
            page_no: Quests::current_page(),
            count: data.api_data.api_count,
            completed_kind: data.api_data.api_completed_kind,
            exec_count: data.api_data.api_exec_count,
            exec_type: data.api_data.api_exec_type,
            quests,
            completed,
        })
    }
}