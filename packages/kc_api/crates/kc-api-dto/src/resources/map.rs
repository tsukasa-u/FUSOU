use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
pub struct MapResourceInfo {
    #[serde(default)]
    pub spots: Vec<MapSpot>,
    #[serde(default)]
    pub labels: Vec<MapLabel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MapSpot {
    pub no: i64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MapLabel {
    pub x: f64,
    pub y: f64,
    pub img: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct MapCellLabels {
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

impl MapCellLabels {
    pub fn from_map_resource(map_info: &MapResourceInfo) -> Self {
        let labels = map_info
            .labels
            .iter()
            .filter_map(|label| {
                if label.img.is_empty() {
                    return None;
                }

                let closest_spot = map_info
                    .spots
                    .iter()
                    .map(|spot| {
                        let distance = (spot.x - label.x).hypot(spot.y - label.y);
                        (spot, distance)
                    })
                    .min_by(|left, right| left.1.total_cmp(&right.1));

                closest_spot.and_then(|(spot, distance)| {
                    (distance <= 40.0).then(|| (spot.no.to_string(), label.img.clone()))
                })
            })
            .collect();

        Self { labels }
    }
}

#[cfg(test)]
mod tests {
    use super::{MapCellLabels, MapResourceInfo};

    #[test]
    fn maps_official_label_sprites_to_nearby_spots() {
        let map_info: MapResourceInfo = serde_json::from_str(
            r#"{
                "bg": "map_bg",
                "spots": [
                    {"no": 3, "x": 100, "y": 100, "line": [1, 2]},
                    {"no": 4, "x": 250, "y": 250, "line": []}
                ],
                "labels": [
                    {"x": 120, "y": 110, "img": "label-at-spot-3"},
                    {"x": 300, "y": 250, "img": "outside-threshold"},
                    {"x": 1000, "y": 1000, "img": "unmatched"}
                ],
                "unknownMapMetadata": true
            }"#,
        )
        .expect("map resource JSON should deserialize");

        let labels = MapCellLabels::from_map_resource(&map_info).labels;

        assert_eq!(labels.get("3").map(String::as_str), Some("label-at-spot-3"));
        assert!(!labels.contains_key("4"));
    }
}
