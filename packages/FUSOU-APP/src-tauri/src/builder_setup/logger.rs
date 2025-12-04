use chrono::{TimeZone, Utc};
use chrono_tz::Asia::Tokyo;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use time::macros::format_description;
use tracing::{Event, Subscriber};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::fmt::time::LocalTime;
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};
use tracing_subscriber::registry;

use crate::util::get_ROAMING_DIR;

static GUARD_WORKER: once_cell::sync::OnceCell<WorkerGuard> = once_cell::sync::OnceCell::new();

static LOG_FILE_NAME: once_cell::sync::OnceCell<String> = once_cell::sync::OnceCell::new();

// Global log storage
static LOG_STORAGE: once_cell::sync::OnceCell<Arc<Mutex<Vec<MessageVisitor>>>> = 
    once_cell::sync::OnceCell::new();

const MAX_LOGS: usize = 10000; // Maximum number of logs to keep in memory

pub fn get_log_file_name() -> String {
    LOG_FILE_NAME
        .get()
        .cloned()
        .unwrap_or_else(|| "fuosu-app.log".to_string())
}

#[derive(Default, Clone, serde::Serialize)]
pub struct MessageVisitor {
    datetime: Option<String>,
    level: Option<String>,
    target: Option<String>,
    metadata: Option<String>,
    message: Option<String>,
    method: Option<String>,
    uri: Option<String>,
    status: Option<String>,
    content_type: Option<String>,
}

impl tracing::field::Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        match field.name() {
            "method" => self.method = Some(format!("{value:?}")),
            "uri" => self.uri = Some(format!("{value:?}")),
            "status" => self.status = Some(format!("{value:?}")),
            "content_type" => self.content_type = Some(format!("{value:?}")),
            "message" => self.message = Some(format!("{value:?}")),
            _ => {}
        }
    }
}

pub struct FrontendSenderLayer {
    app_handle: tauri::AppHandle,
}

impl<S> Layer<S> for FrontendSenderLayer
where
    S: Subscriber + for<'a> registry::LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let metadata = event.metadata();
        let level = metadata.level();
        let target = metadata.target();

        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);

        let utc: chrono::NaiveDateTime = Utc::now().naive_utc();
        let jst: chrono::DateTime<chrono_tz::Tz> = Tokyo.from_utc_datetime(&utc);
        // let formatted = jst.format("%Y-%m-%dT%H:%M:%S.%3f%z").to_string();
        let formatted = jst.format("%Y-%m-%dT%H:%M:%S.%3f").to_string();

        visitor.datetime = Some(formatted);
        visitor.level = Some(level.to_string());
        visitor.target = Some(target.to_string());
        visitor.metadata = Some(format!("{metadata:?}"));

        // Store log in memory
        if let Some(storage) = LOG_STORAGE.get() {
            if let Ok(mut logs) = storage.lock() {
                logs.push(visitor.clone());
                // Keep only the last MAX_LOGS entries
                if logs.len() > MAX_LOGS {
                    let excess = logs.len() - MAX_LOGS;
                    logs.drain(0..excess);
                }
            }
        }

        self.app_handle.emit("log-event", visitor).ok();
    }
}

/// Internal function to get all stored logs (called by tauri command)
pub fn get_all_logs_internal() -> Vec<MessageVisitor> {
    LOG_STORAGE
        .get()
        .and_then(|storage| storage.lock().ok())
        .map(|logs| logs.clone())
        .unwrap_or_default()
}

pub fn setup(app: &mut tauri::App) {
    // Initialize log storage
    let _ = LOG_STORAGE.set(Arc::new(Mutex::new(Vec::with_capacity(MAX_LOGS))));

    let log_path = get_ROAMING_DIR().join("log");
    let log_file_name = format!("fuosu-app-v{}.log", app.package_info().version);
    LOG_FILE_NAME.set(log_file_name).ok();

    let file_appender = RollingFileAppender::new(
        Rotation::NEVER,
        log_path,
        LOG_FILE_NAME.get().unwrap().clone(),
    );
    let (non_blocking_appender, _guard) = tracing_appender::non_blocking(file_appender);
    let _ = GUARD_WORKER.set(_guard);

    let timer = LocalTime::new(format_description!(
        "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:6][offset_hour sign:mandatory]:[offset_minute]"
    ));

    let file_layer = tracing_subscriber::fmt::layer()
        .with_timer(timer.clone())
        .with_writer(non_blocking_appender)
        .with_level(true)
        .with_file(true)
        .with_line_number(true)
        .with_target(true)
        .log_internal_errors(true)
        .with_ansi(false)
        .with_filter(LevelFilter::WARN);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_timer(timer)
        .pretty()
        .with_file(false)
        .with_line_number(false)
        .with_target(true)
        .compact()
        .with_filter(LevelFilter::INFO);

    let frontend_layer = (FrontendSenderLayer {
        app_handle: app.handle().clone(),
    })
    .with_filter(LevelFilter::INFO);

    let registry = tracing_subscriber::registry()
        .with(file_layer)
        .with(console_layer)
        .with(frontend_layer);

    let _ = tracing::subscriber::set_global_default(registry);
}
