use std::{
    collections::HashMap,
    error::Error,
    io::{Error as IoError, ErrorKind},
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use kc_api::{interface::cells::Cells, kcapi_dto::resources::map::MapCellLabels};
use once_cell::sync::Lazy;
use tauri::Emitter;

use crate::events;

const LABEL_CACHE_FILE: &str = "cell_labels_web.json";

type MapCellLabelBundle = HashMap<String, MapCellLabels>;
type LabelResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

static WEB_LABELS: Lazy<Mutex<MapCellLabelBundle>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub fn map_ids_from_resource_path(path: &str) -> Option<(i64, i64)> {
    let relative_path = path.strip_prefix("/kcs2/resources/map/")?;
    let (area_id, file_name) = relative_path.split_once('/')?;
    if file_name.contains('/') {
        return None;
    }

    let file_stem = file_name.strip_suffix(".json")?;
    let (map_info_no, variant) = file_stem.split_once("_info")?;
    if !variant.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }

    let area_id = area_id.parse::<i64>().ok()?;
    let map_info_no = map_info_no.parse::<i64>().ok()?;

    (area_id > 0 && map_info_no > 0).then_some((area_id, map_info_no))
}

pub fn load_cached_labels() -> LabelResult<()> {
    let cache_path = cache_path();
    let contents = match std::fs::read_to_string(&cache_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };

    let bundle = parse_bundle(&contents)?;
    replace_bundle(bundle)
        .map_err(|error| IoError::other(format!("failed to lock map label cache: {error}")).into())
}

pub fn apply_to_cells(cells: &mut Cells) {
    let Some(labels) = labels_for_map(cells.maparea_id, cells.mapinfo_no) else {
        return;
    };

    cells.cell_labels = Some(labels);
}

pub async fn refresh_from_web(handle: tauri::AppHandle, bundle_url: String) {
    let bundle = match download_bundle(&bundle_url).await {
        Ok(bundle) => bundle,
        Err(error) => {
            tracing::warn!(error = %error, "failed to download map cell labels");
            return;
        }
    };

    let map_count = bundle.len();
    if let Err(error) = replace_bundle(bundle.clone()) {
        tracing::error!(error = %error, "failed to update in-memory map cell labels");
        return;
    }

    if let Err(error) = save_bundle(&bundle) {
        tracing::warn!(error = %error, "failed to save downloaded map cell label cache");
    }

    if let Err(error) = refresh_current_cells(&handle) {
        tracing::warn!(error = %error, "failed to refresh active map cell labels");
    }

    tracing::info!(map_count, "loaded map cell labels");
}

fn labels_for_map(map_area_id: i64, map_info_no: i64) -> Option<HashMap<String, String>> {
    let key = format!("{map_area_id}-{map_info_no}");
    match WEB_LABELS.lock() {
        Ok(bundle) => bundle.get(&key).map(|map| {
            map.labels
                .iter()
                .filter(|(_, label)| !label.trim().is_empty())
                .map(|(cell, label)| (cell.clone(), label.clone()))
                .collect()
        }),
        Err(error) => {
            tracing::error!(error = %error, "map cell label cache lock is poisoned");
            None
        }
    }
}

fn refresh_current_cells(handle: &tauri::AppHandle) -> LabelResult<()> {
    let mut cells = Cells::load();
    let Some(labels) = labels_for_map(cells.maparea_id, cells.mapinfo_no) else {
        return Ok(());
    };

    if cells.cell_labels.as_ref() == Some(&labels) {
        return Ok(());
    }

    cells.cell_labels = Some(labels);
    cells.restore();
    handle.emit_to("main", events::SET_KCS_CELLS, cells)?;
    Ok(())
}

async fn download_bundle(bundle_url: &str) -> LabelResult<MapCellLabelBundle> {
    let cache_bust = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let mut url = url::Url::parse(bundle_url)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(IoError::new(
            ErrorKind::InvalidInput,
            "map label bundle URL must use http or https",
        )
        .into());
    }
    url.query_pairs_mut()
        .append_pair("v", &cache_bust.to_string());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let contents = client
        .get(url)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    parse_bundle(&contents)
}

fn parse_bundle(contents: &str) -> LabelResult<MapCellLabelBundle> {
    let bundle = serde_json::from_str::<MapCellLabelBundle>(contents)?;
    validate_bundle(&bundle).map_err(|message| IoError::new(ErrorKind::InvalidData, message))?;
    Ok(bundle)
}

fn validate_bundle(bundle: &MapCellLabelBundle) -> Result<(), String> {
    if bundle.is_empty() {
        return Err("map label bundle is empty".to_string());
    }

    for (map_key, map_labels) in bundle {
        let Some((area_id, map_info_no)) = map_key.split_once('-') else {
            return Err(format!("invalid map key: {map_key}"));
        };
        if map_info_no.contains('-')
            || area_id.parse::<i64>().map_or(true, |id| id <= 0)
            || map_info_no.parse::<i64>().map_or(true, |id| id <= 0)
        {
            return Err(format!("invalid map key: {map_key}"));
        }
        if map_labels.labels.is_empty() {
            return Err(format!("map label entry is empty: {map_key}"));
        }
        if !map_labels
            .labels
            .values()
            .any(|label| !label.trim().is_empty())
        {
            return Err(format!("map has no non-empty cell labels: {map_key}"));
        }
        if map_labels
            .labels
            .keys()
            .any(|cell| cell.parse::<i64>().is_err())
        {
            return Err(format!("invalid cell label entry in map: {map_key}"));
        }
    }

    Ok(())
}

fn replace_bundle(bundle: MapCellLabelBundle) -> Result<(), String> {
    let mut current = WEB_LABELS
        .lock()
        .map_err(|error| format!("map cell label cache lock is poisoned: {error}"))?;
    *current = bundle;
    Ok(())
}

fn cache_path() -> PathBuf {
    crate::util::get_ROAMING_DIR()
        .join("cache")
        .join(LABEL_CACHE_FILE)
}

fn save_bundle(bundle: &MapCellLabelBundle) -> LabelResult<()> {
    let path = cache_path();
    let parent = path.parent().ok_or_else(|| {
        IoError::new(
            ErrorKind::InvalidInput,
            "map cell label cache path has no parent directory",
        )
    })?;
    std::fs::create_dir_all(parent)?;

    let mut temporary_path = path.clone();
    temporary_path.set_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(bundle)?;
    std::fs::write(&temporary_path, contents)?;
    if let Err(error) = std::fs::rename(&temporary_path, &path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(error.into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        labels_for_map, map_ids_from_resource_path, parse_bundle, replace_bundle, validate_bundle,
        MapCellLabelBundle, MapCellLabels,
    };
    use std::collections::HashMap;

    #[test]
    fn parses_ids_from_kcs2_map_info_resource_path() {
        assert_eq!(
            map_ids_from_resource_path("/kcs2/resources/map/001/05_info.json"),
            Some((1, 5))
        );
        assert_eq!(
            map_ids_from_resource_path("/kcs2/resources/map/062/01_info18.json"),
            Some((62, 1))
        );
    }

    #[test]
    fn rejects_non_map_info_resource_paths() {
        assert_eq!(
            map_ids_from_resource_path("/kcs2/resources/map/001/05.json"),
            None
        );
        assert_eq!(
            map_ids_from_resource_path("/kcs2/resources/map/001/05_info.json/extra"),
            None
        );
        assert_eq!(
            map_ids_from_resource_path("/kcs2/resources/map/001/05_info_invalid.json"),
            None
        );
        assert_eq!(
            map_ids_from_resource_path("/kcs2/resources/ship/001/05_info.json"),
            None
        );
    }

    #[test]
    fn parses_the_web_bundle_and_keeps_map_specific_labels() {
        let bundle =
            parse_bundle(r#"{"1-1":{"labels":{"0":"1","1":"A"}},"62-1":{"labels":{"3":"E"}}}"#)
                .expect("valid web label bundle should parse");

        assert_eq!(bundle["1-1"].labels.get("1").map(String::as_str), Some("A"));
        assert_eq!(
            bundle["62-1"].labels.get("3").map(String::as_str),
            Some("E")
        );
    }

    #[test]
    fn accepts_the_generated_fusou_web_bundle() {
        let bundle = parse_bundle(include_str!(
            "../../../FUSOU-WEB/public/battle-maps/cell_labels.json"
        ))
        .expect("generated FUSOU-WEB bundle should match the app schema");

        assert!(bundle.contains_key("1-1"));
        assert!(bundle["1-1"].labels.contains_key("1"));
    }

    #[test]
    fn selects_labels_for_the_active_map() {
        let bundle =
            parse_bundle(r#"{"1-1":{"labels":{"1":"A"}},"62-1":{"labels":{"3":"E","4":""}}}"#)
                .expect("valid web label bundle should parse");
        replace_bundle(bundle).expect("map label cache should be available");

        let labels = labels_for_map(62, 1).expect("labels should be available for map 62-1");
        assert_eq!(labels.get("3").map(String::as_str), Some("E"));
        assert!(!labels.contains_key("4"));
        assert!(labels_for_map(2, 1).is_none());
    }

    #[test]
    fn rejects_empty_or_malformed_web_bundles() {
        assert!(parse_bundle("{}").is_err());
        assert!(parse_bundle(r#"{"1-1":{"labels":{}}}"#).is_err());
        assert!(parse_bundle(r#"{"not-a-map":{"labels":{"1":"A"}}}"#).is_err());
        assert!(parse_bundle(r#"{"1-1":{"labels":{"node":"A"}}}"#).is_err());
    }

    #[test]
    fn validates_constructed_map_entries() {
        let bundle: MapCellLabelBundle = HashMap::from([(
            "1-1".to_string(),
            MapCellLabels {
                labels: HashMap::from([("1".to_string(), "A".to_string())]),
            },
        )]);

        assert!(validate_bundle(&bundle).is_ok());
    }
}
