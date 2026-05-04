use kc_api_interface::interface::EmitData;
use kc_api_interface::interface::Add;
use kc_api_interface::quest::QuestEvent;

use kc_api_dto::endpoints::api_req_quest::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, ());
register_trait!(Res, (clearitemget, start, stop));

impl TraitForConvert for start::Req {
	type Output = EmitData;

	fn convert(&self) -> Option<Vec<EmitData>> {
		Some(vec![EmitData::Add(Add::QuestEvent(QuestEvent {
			timestamp: chrono::Utc::now().timestamp_millis(),
			event_type: "start".to_string(),
			quest_id: Some(self.api_quest_id),
		}))])
	}
}

impl TraitForConvert for stop::Req {
	type Output = EmitData;

	fn convert(&self) -> Option<Vec<EmitData>> {
		Some(vec![EmitData::Add(Add::QuestEvent(QuestEvent {
			timestamp: chrono::Utc::now().timestamp_millis(),
			event_type: "stop".to_string(),
			quest_id: Some(self.api_quest_id),
		}))])
	}
}

impl TraitForConvert for clearitemget::Req {
	type Output = EmitData;

	fn convert(&self) -> Option<Vec<EmitData>> {
		Some(vec![EmitData::Add(Add::QuestEvent(QuestEvent {
			timestamp: chrono::Utc::now().timestamp_millis(),
			event_type: "complete".to_string(),
			quest_id: Some(self.api_quest_id),
		}))])
	}
}
