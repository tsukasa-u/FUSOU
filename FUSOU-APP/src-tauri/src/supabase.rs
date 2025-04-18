use dotenvy_macro::dotenv;
use sqlx::postgres::PgPoolOptions;
use sqlx::types::chrono;
use std::sync::OnceLock;
use tokio::sync::OnceCell;

static SUPABASE_DATABASE_URL: OnceLock<&str> = OnceLock::new();
static KC_PERIOD_TAG: OnceCell<String> = OnceCell::const_new();

pub fn get_supabase_database_url() -> &'static str {
    SUPABASE_DATABASE_URL.get_or_init(|| dotenv!("SUPABASE_DATABASE_URL"))
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

            let latest_tag = tags.iter().max_by_key(|tag| tag.1).map(|tag| tag.1);
            if latest_tag.is_none() {
                println!("No latest tag found.");
                return "0".to_string();
            }
            let latest_tag = latest_tag.unwrap();

            if chrono::Utc::now().timestamp() < latest_tag.timestamp() {
                println!("Latest tag is expired.");
                return "0".to_string();
            }

            let yyyy_mm_dd = latest_tag
                .with_timezone(&chrono_tz::Asia::Tokyo)
                .date_naive();

            return yyyy_mm_dd.to_string();
        })
        .await
        .clone()
}
