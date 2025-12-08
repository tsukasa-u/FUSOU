mod preprocessing;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use preprocessing::{auto_split_by_tree, TreeSplitJob};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;
use tracing::info;

#[derive(Clone)]
struct AppState {
    mock_data: String,
    target_column: String,
    jobs: Arc<Mutex<VecDeque<TreeSplitJob>>>,
}

#[tokio::main]
async fn main() {
    // ロギング初期化
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fusou_formula_server=debug,tower_http=debug".into()),
        )
        .init();

    // モックデータ (ネストされたJSON構造)
    let mock_data = r#"[
        {"attacker": {"atk": 100, "luck": 5}, "defender": {"def": 50}, "map_id": 1, "damage": 150},
        {"attacker": {"atk": 200, "luck": 5}, "defender": {"def": 50}, "map_id": 1, "damage": 350},
        {"attacker": {"atk": 150, "luck": 6}, "defender": {"def": 60}, "map_id": 2, "damage": 220},
        {"attacker": {"atk": 180, "luck": 7}, "defender": {"def": 55}, "map_id": 1, "damage": 280},
        {"attacker": {"atk": 120, "luck": 5}, "defender": {"def": 50}, "map_id": 3, "damage": 170},
        {"attacker": {"atk": 220, "luck": 8}, "defender": {"def": 65}, "map_id": 2, "damage": 380},
        {"attacker": {"atk": 160, "luck": 6}, "defender": {"def": 52}, "map_id": 1, "damage": 250},
        {"attacker": {"atk": 190, "luck": 7}, "defender": {"def": 58}, "map_id": 3, "damage": 310},
        {"attacker": {"atk": 140, "luck": 5}, "defender": {"def": 50}, "map_id": 1, "damage": 200},
        {"attacker": {"atk": 210, "luck": 9}, "defender": {"def": 70}, "map_id": 2, "damage": 360}
    ]"#.to_string();

    let state = Arc::new(AppState {
        mock_data,
        target_column: "damage".to_string(),
        jobs: Arc::new(Mutex::new(VecDeque::new())),
    });

    // ルーター構築
    let app = Router::new()
        .route("/", get(health_check))
        .route("/job", get(get_job))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = "0.0.0.0:3030";
    info!("Server starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "Formula Server is running"
}

async fn get_job(State(state): State<Arc<AppState>>) -> Result<Json<TreeSplitJob>, AppError> {
    info!("Received job request");

    // 既存ジョブがあればポップして返す
    if let Some(job) = state.jobs.lock().unwrap().pop_front() {
        info!("Dispatching cached job: {} rows", job.job.data.len());
        return Ok(Json(job));
    }

    // なければ決定木で自動分割を実行し、キューに積む
    let new_jobs = auto_split_by_tree(
        &state.mock_data,
        &state.target_column,
        0.1, // 相関閾値
        3,   // 最低フィーチャー数
        3,   // max_depth (過学習防止のため浅く)
        50,  // min_samples_leaf (過学習防止)
    )
    .map_err(|e| {
        tracing::error!("Preprocessing failed: {}", e);
        AppError::PreprocessingError(e.to_string())
    })?;

    {
        let mut q = state.jobs.lock().unwrap();
        for job in new_jobs {
            q.push_back(job);
        }
    }

    if let Some(job) = state.jobs.lock().unwrap().pop_front() {
        info!("Dispatching freshly generated job: {} rows", job.job.data.len());
        Ok(Json(job))
    } else {
        Err(AppError::NoJobAvailable)
    }
}

// エラーハンドリング
enum AppError {
    PreprocessingError(String),
    NoJobAvailable,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AppError::PreprocessingError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
            AppError::NoJobAvailable => (StatusCode::NOT_FOUND, "no job available".to_string()),
        };

        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
