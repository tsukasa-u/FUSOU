// use dotenvy_macro::dotenv;
use sqlx::postgres::PgPoolOptions;
use sqlx::types::chrono;
use std::sync::OnceLock;
use tokio::sync::OnceCell;
use tracing_unwrap::OptionExt;

static SUPABASE_DATABASE_URL: OnceLock<&str> = OnceLock::new();
static KC_PERIOD_TAG: OnceCell<String> = OnceCell::const_new();

pub fn get_supabase_database_url() -> &'static str {
    // SUPABASE_DATABASE_URL.get_or_init(|| dotenv!("SUPABASE_DATABASE_URL"))
    SUPABASE_DATABASE_URL.get_or_init(|| {
        std::option_env!("SUPABASE_DATABASE_URL")
            .expect_or_log("failed to get supabase database url")
    })
}

pub async fn get_period_tag() -> String {
    KC_PERIOD_TAG
        .get_or_init(|| async {
            let database_url = get_supabase_database_url();

            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect(database_url)
                .await;
            if pool.is_err() {
                println!("Failed to connect to the database: {:?}", pool.err());
                return "0".to_string();
            }
            let pool = pool.unwrap();

            let tags: Vec<(i64, chrono::DateTime<chrono::FixedOffset>)> =
                sqlx::query_as("SELECT id, tag FROM kc_period_tag")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            if tags.is_empty() {
                println!("No tags found in the database.");
                return "0".to_string();
            }

            let now_timestamp = chrono::Utc::now().timestamp();

            let latest_tag = tags
                .iter()
                .filter(|(_, time)| time.timestamp() < now_timestamp)
                .max_by_key(|(_, time)| time.timestamp())
                .map(|(_, time)| *time);
            if latest_tag.is_none() {
                tracing::warn!("No latest tag found.");
                return "0".to_string();
            }
            let latest_tag = latest_tag.unwrap();

            let yyyy_mm_dd = latest_tag
                .with_timezone(&chrono_tz::Asia::Tokyo)
                .date_naive();

            return yyyy_mm_dd.to_string();
        })
        .await
        .clone()
}
