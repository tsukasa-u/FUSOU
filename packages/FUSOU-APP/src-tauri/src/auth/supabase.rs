use chrono::Utc;
use configs::get_user_configs_for_app;
use reqwest::Client;
use serde::Deserialize;
use std::sync::OnceLock;
use tokio::sync::OnceCell;

static KC_PERIOD_TAG: OnceCell<String> = OnceCell::const_new();
static KC_PERIOD_ENDPOINT: OnceLock<String> = OnceLock::new();
static PERIOD_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

pub async fn get_period_tag() -> String {
    KC_PERIOD_TAG
        .get_or_init(|| async {
            match fetch_period_tag_via_api().await {
                Ok(tag) => tag,
                Err(err) => {
                    tracing::warn!(error = %err, "failed to fetch kc-period tag via API");
                    "0".to_string()
                }
            }
        })
        .await
        .clone()
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
            .user_agent("FUSOU-APP/period-fetcher")
            .build()
            .expect("failed to build kc period reqwest client")
    })
}

#[derive(Debug, Deserialize)]
struct PeriodApiResponse {
    tag: Option<String>,
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
            "kc-period endpoint returned {}: {}",
            status,
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
