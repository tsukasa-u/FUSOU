use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use ts_rs::TS;

pub static KCS_QUESTS: Lazy<Mutex<Quests>> = Lazy::new(|| {
    Mutex::new(Quests {
        timestamp: None,
        page_no: 1,
        count: 0,
        completed_kind: 0,
        exec_count: 0,
        exec_type: 0,
        quests: HashMap::new(),
        completed: HashMap::new(),
    })
});

pub static KCS_QUESTLIST_PAGE: Lazy<AtomicI64> = Lazy::new(|| AtomicI64::new(1));

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "quest.ts")]
pub struct Quests {
    pub timestamp: Option<i64>,
    pub page_no: i64,
    pub count: i64,
    pub completed_kind: i64,
    pub exec_count: i64,
    pub exec_type: i64,
    pub quests: HashMap<i64, Quest>,
    pub completed: HashMap<i64, QuestCompletion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "quest.ts")]
pub struct Quest {
    pub no: i64,
    pub category: i64,
    pub quest_type: i64,
    pub label_type: i64,
    pub state: i64,
    pub title: String,
    pub detail: String,
    pub voice_id: i64,
    pub get_material: Vec<i64>,
    pub bonus_flag: i64,
    pub progress_flag: i64,
    pub invalid_flag: i64,
    pub lost_badges: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "quest.ts")]
pub struct QuestCompletion {
    pub no: i64,
    pub state: i64,
    pub progress_flag: i64,
    pub c_flag: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestEvent {
    pub timestamp: i64,
    pub event_type: String,
    pub quest_id: Option<i64>,
}

impl Quests {
    pub fn set_current_page(page_no: i64) {
        let normalized = if page_no <= 0 { 1 } else { page_no };
        KCS_QUESTLIST_PAGE.store(normalized, Ordering::Relaxed);
    }

    pub fn current_page() -> i64 {
        KCS_QUESTLIST_PAGE.load(Ordering::Relaxed)
    }

    pub fn load() -> Self {
        let quests = KCS_QUESTS.lock().unwrap();
        quests.clone()
    }

    pub fn restore(&self) {
        let mut quests = KCS_QUESTS.lock().unwrap();
        *quests = self.clone();
    }
}
