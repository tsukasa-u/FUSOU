use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QuestIngestEvent {
    pub timestamp_ms: i64,
    pub event_type: String,
    pub quest_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QuestIngestSnapshotQuest {
    pub quest_id: i64,
    pub quest_type: i64,
    pub category: i64,
    pub label_type: i64,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QuestIngestSnapshot {
    pub timestamp_ms: i64,
    pub page_no: i64,
    pub quests: Vec<QuestIngestSnapshotQuest>,
}

impl From<kc_api_interface::quest::QuestEvent> for QuestIngestEvent {
    fn from(event: kc_api_interface::quest::QuestEvent) -> Self {
        Self {
            timestamp_ms: event.timestamp,
            event_type: event.event_type,
            quest_id: event.quest_id,
        }
    }
}

impl From<kc_api_interface::quest::Quests> for QuestIngestSnapshot {
    fn from(snapshot: kc_api_interface::quest::Quests) -> Self {
        let mut quests = snapshot
            .quests
            .into_values()
            .map(|q| QuestIngestSnapshotQuest {
                quest_id: q.no,
                quest_type: q.quest_type,
                category: q.category,
                label_type: q.label_type,
                title: q.title,
                detail: q.detail,
            })
            .collect::<Vec<_>>();

        quests.sort_by_key(|q| q.quest_id);

        Self {
            timestamp_ms: snapshot.timestamp.unwrap_or_else(|| {
                let elapsed = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default();
                elapsed.as_millis() as i64
            }),
            page_no: if snapshot.page_no <= 0 { 1 } else { snapshot.page_no },
            quests,
        }
    }
}