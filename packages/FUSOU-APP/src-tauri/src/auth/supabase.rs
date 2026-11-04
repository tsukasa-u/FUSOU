use chrono::Utc;
use configs::get_user_configs_for_app;
use reqwest::Client;
use serde::Deserialize;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::RwLock;

static CACHED_PERIOD_TAG: RwLock<Option<String>> = RwLock::const_new(None);
static KC_PERIOD_ENDPOINT: OnceLock<String> = OnceLock::new();
static PERIOD_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static LAST_NOTIFY_TIMESTAMP_SECS: AtomicI64 = AtomicI64::new(0);

const NOTIFY_INTERVAL_SECS: i64 = 60;
const MAX_FETCH_ATTEMPTS: usize = 2;

/// Returns the current kc-period tag (e.g. "2026-10-14").
/// If not yet cached, attempts to fetch it via API with retry.
/// If fetching fails, returns `None` and triggers a user notification.
/// Never falls back to a temporary or today's date, preventing partition corruption.
pub async fn get_period_tag() -> Option<String> {
    // Fast path: check read lock
    {
        let guard = CACHED_PERIOD_TAG.read().await;
        if let Some(tag) = guard.as_ref() {
            return Some(tag.clone());
        }
    }

    // Slow path: acquire write lock and fetch
    let mut guard = CACHED_PERIOD_TAG.write().await;
    if let Some(tag) = guard.as_ref() {
        return Some(tag.clone());
    }

    tracing::info!("get_period_tag: fetching kc-period tag");
    match fetch_period_tag_with_retry().await {
        Ok(tag) => {
            tracing::info!(period_tag = %tag, "kc-period tag fetched successfully");
            *guard = Some(tag.clone());
            Some(tag)
        }
        Err(err) => {
            tracing::error!(
                error = %err,
                "failed to fetch kc-period tag via API; upload operations will be suspended"
            );
            notify_period_tag_failure();
            None
        }
    }
}

/// Refreshes the cached period tag from the API.
/// If successful, updates the cache and returns `Some(tag)`.
/// If it fails, keeps the existing cache (if any) and returns `None`.
pub async fn refresh_period_tag() -> Option<String> {
    match fetch_period_tag_with_retry().await {
        Ok(tag) => {
            let mut guard = CACHED_PERIOD_TAG.write().await;
            tracing::info!(period_tag = %tag, "kc-period tag refreshed successfully");
            *guard = Some(tag.clone());
            Some(tag)
        }
        Err(err) => {
            tracing::warn!(error = %err, "failed to refresh kc-period tag");
            let guard = CACHED_PERIOD_TAG.read().await;
            if guard.is_none() {
                notify_period_tag_failure();
            }
            None
        }
    }
}

/// Starts a background updater task that warms up the kc-period cache on startup
/// and periodically checks for maintenance period updates.
pub fn start_period_tag_background_updater() {
    tokio::spawn(async {
        // Initial warmup fetch
        get_period_tag().await;

        let mut interval = tokio::time::interval(Duration::from_secs(1800)); // check every 30 minutes
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            refresh_period_tag().await;
        }
    });
}

fn notify_period_tag_failure() {
    let now = Utc::now().timestamp();
    let last = LAST_NOTIFY_TIMESTAMP_SECS.load(Ordering::Relaxed);
    if now - last >= NOTIFY_INTERVAL_SECS {
        LAST_NOTIFY_TIMESTAMP_SECS.store(now, Ordering::Relaxed);
        crate::notify::show_global(
            "FUSOU - 期間タグ取得エラー",
            "メンテナンス期間タグ(kc-period)の取得に失敗しました。データ整合性を保持するため、取得できるまでデータのアップロードを停止します。",
        );
    }
}

fn get_period_endpoint() -> &'static str {
    KC_PERIOD_ENDPOINT
        .get_or_init(|| {
            get_user_configs_for_app()
                .asset_sync
                .get_period_endpoint()
                .unwrap_or_else(|| {
                    tracing::warn!(
                        "app.asset_sync.period_endpoint is not configured; kc-period fetch disabled"
                    );
                    String::new()
                })
        })
        .as_str()
}

fn get_period_http_client() -> &'static Client {
    PERIOD_HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .no_proxy()
            .user_agent("FUSOU-APP/period-fetcher")
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(5))
            .build()
            .expect("failed to build kc period reqwest client")
    })
}

#[derive(Debug, Deserialize)]
struct PeriodApiResponse {
    tag: Option<String>,
}

async fn fetch_period_tag_with_retry() -> Result<String, String> {
    let mut last_error = String::new();
    for attempt in 1..=MAX_FETCH_ATTEMPTS {
        match fetch_period_tag_via_api().await {
            Ok(tag) => return Ok(tag),
            Err(e) => {
                tracing::warn!(
                    attempt,
                    max_attempts = MAX_FETCH_ATTEMPTS,
                    error = %e,
                    "failed to fetch kc-period tag; retrying..."
                );
                last_error = e;
                if attempt < MAX_FETCH_ATTEMPTS {
                    tokio::time::sleep(Duration::from_secs(1 << (attempt - 1))).await;
                }
            }
        }
    }
    Err(format!(
        "failed to fetch kc-period tag after {MAX_FETCH_ATTEMPTS} attempts: {last_error}"
    ))
}

async fn fetch_period_tag_via_api() -> Result<String, String> {
    let endpoint = get_period_endpoint();
    if endpoint.is_empty() {
        return Err("kc-period endpoint is not configured".to_string());
    }
    let client = get_period_http_client();

    let response = client
        .get(endpoint)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| format!("failed to call kc-period endpoint: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "kc-period endpoint returned {status}: {}",
            body.trim()
        ));
    }

    let payload: PeriodApiResponse = response
        .json()
        .await
        .map_err(|err| format!("failed to decode kc-period response: {err}"))?;

    let raw_tag = payload
        .tag
        .ok_or_else(|| "kc-period response did not include tag".to_string())?;

    let parsed_tag = chrono::DateTime::parse_from_rfc3339(&raw_tag)
        .map_err(|err| format!("invalid kc-period tag format: {err}"))?;

    if parsed_tag.timestamp() > Utc::now().timestamp() {
        return Err("kc-period tag from future is not yet valid".to_string());
    }

    let yyyy_mm_dd = parsed_tag
        .with_timezone(&chrono_tz::Asia::Tokyo)
        .date_naive();

    Ok(yyyy_mm_dd.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fetch_period_tag() {
        let res = fetch_period_tag_via_api().await;
        println!("test_fetch_period_tag result: {:?}", res);
        assert!(res.is_ok(), "Expected Ok, got: {:?}", res);
    }
}
