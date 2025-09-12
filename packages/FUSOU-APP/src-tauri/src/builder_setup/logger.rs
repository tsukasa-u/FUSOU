use tauri::Emitter;
use tracing::{Event, Subscriber};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};
use tracing_subscriber::registry;

use crate::util::get_ROAMING_DIR;

static GUARD_WORKER: once_cell::sync::OnceCell<WorkerGuard> = once_cell::sync::OnceCell::new();

struct MessageVisitor {
    message: Option<String>,
}

impl tracing::field::Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = Some(format!("{:?}", value));
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

        let mut visitor = MessageVisitor { message: None };
        event.record(&mut visitor);
        let message = visitor.message.unwrap_or_default();

        println!(
            "[FrontendSender] Received log: {target}: {message}",
            target = target,
            message = message.clone()
        );
        self.app_handle
            .emit(
                "log-event",
                (level.to_string(), message, format!("{:?}", metadata)),
            )
            .ok();
    }
}

pub fn setup(app: &mut tauri::App) {
    let log_path = get_ROAMING_DIR().join("log");
    let file_appender = RollingFileAppender::new(Rotation::NEVER, log_path, "fuosu-app.log");
    let (non_blocking_appender, _guard) = tracing_appender::non_blocking(file_appender);
    let _ = GUARD_WORKER.set(_guard);

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking_appender)
        .with_level(true)
        .with_file(true)
        .with_line_number(true)
        .with_target(true)
        .log_internal_errors(true)
        .with_ansi(false)
        .with_filter(LevelFilter::WARN);

    let console_layer = tracing_subscriber::fmt::layer()
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
