use std::env;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EpochBoundary {
    date: u32,
    unix: i64,
}

/// Central source of truth for all epoch date↔unix mappings.
/// Add new epochs here, and they will automatically propagate to:
/// - build.rs's since/until cfg! evaluation
/// - Any call to date_to_unix(), feature_to_unix(), get_epoch_unix()
const EPOCH_BOUNDARIES: &[EpochBoundary] = &[EpochBoundary {
    date: 20250627,
    unix: 1750993200, // 2025-06-27T03:00:00Z
}];

pub fn emit_epoch_cfg() {
    emit_check_cfg();

    let selected = parse_selected_epoch();

    match &selected {
        SelectedEpoch::Genesis => {
            println!("cargo:rustc-env=SELECTED_EPOCH=genesis");
            println!("cargo:rustc-env=SELECTED_DATE=0");
            emit_since_until(0);
        }
        SelectedEpoch::Epoch(date) => {
            println!("cargo:rustc-env=SELECTED_EPOCH=epoch_{date}");
            println!("cargo:rustc-env=SELECTED_DATE={date}");
            emit_since_until(*date);
        }
    }
}

pub fn date_to_unix(date: &str) -> Option<i64> {
    if date == "0" {
        return Some(0);
    }

    let date = date.parse::<u32>().ok()?;
    EPOCH_BOUNDARIES
        .iter()
        .find(|boundary| boundary.date == date)
        .map(|boundary| boundary.unix)
}

pub fn feature_to_unix(feature_name: &str) -> Option<i64> {
    if feature_name == "genesis" {
        return Some(0);
    }

    let date = feature_name.strip_prefix("epoch_")?;
    date_to_unix(date)
}

/// Get all known epoch dates (excluding genesis which is epoch 0).
pub fn all_known_epoch_dates() -> Vec<u32> {
    let mut dates = EPOCH_BOUNDARIES
        .iter()
        .map(|boundary| boundary.date)
        .collect::<Vec<_>>();
    dates.sort_unstable();
    dates
}

/// Get all known epoch feature names (including genesis).
pub fn all_epoch_features() -> Vec<String> {
    let mut features = Vec::with_capacity(EPOCH_BOUNDARIES.len() + 1);
    features.push("genesis".to_string());
    features.extend(
        all_known_epoch_dates()
            .into_iter()
            .map(|date| format!("epoch_{date}")),
    );
    features
}

/// Get the UNIX timestamp of the first epoch boundary.
pub fn first_epoch_unix() -> Option<i64> {
    EPOCH_BOUNDARIES
        .iter()
        .min_by_key(|boundary| boundary.date)
        .map(|boundary| boundary.unix)
}

/// Get UNIX timestamp for a date key (YYYYMMDD format)
pub fn get_epoch_unix(date: u32) -> Option<i64> {
    if date == 0 {
        return Some(0);
    }
    EPOCH_BOUNDARIES
        .iter()
        .find(|boundary| boundary.date == date)
        .map(|boundary| boundary.unix)
}

fn emit_check_cfg() {
    let values = EPOCH_BOUNDARIES
        .iter()
        .map(|boundary| format!("\"{}\"", boundary.date))
        .collect::<Vec<_>>()
        .join(", ");

    println!("cargo:rustc-check-cfg=cfg(since, values({values}))");
    println!("cargo:rustc-check-cfg=cfg(until, values({values}))");
}

fn emit_since_until(target_date: u32) {
    for boundary in EPOCH_BOUNDARIES {
        if target_date >= boundary.date {
            println!("cargo:rustc-cfg=since=\"{}\"", boundary.date);
        } else {
            println!("cargo:rustc-cfg=until=\"{}\"", boundary.date);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SelectedEpoch {
    Genesis,
    Epoch(u32),
}

fn parse_selected_epoch() -> SelectedEpoch {
    let mut selected = Vec::<SelectedEpoch>::new();

    for (key, _) in env::vars() {
        if key == "CARGO_FEATURE_GENESIS" {
            selected.push(SelectedEpoch::Genesis);
            continue;
        }

        if let Some(suffix) = key.strip_prefix("CARGO_FEATURE_EPOCH_") {
            let normalized = suffix.to_ascii_lowercase();
            if normalized.chars().all(|c| c.is_ascii_digit()) {
                let date = normalized
                    .parse::<u32>()
                    .unwrap_or_else(|_| panic!("Invalid epoch date in feature name: {suffix}"));

                if !EPOCH_BOUNDARIES.iter().any(|boundary| boundary.date == date) {
                    panic!("Unknown epoch date in feature name: {date}");
                }

                selected.push(SelectedEpoch::Epoch(date));
            }
        }
    }

    if selected.is_empty() {
        panic!("Exactly one epoch feature must be selected (genesis or epoch_YYYYMMDD)");
    }
    if selected.len() > 1 {
        panic!("Multiple epoch features are not allowed");
    }

    selected.pop().expect("selected epoch must exist")
}