use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use once_cell::sync::OnceCell;

pub type DatasetIdResolverFn =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = String> + Send>> + Send + Sync>;

pub type AuthPageLauncherFn = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;

static DATASET_ID_RESOLVER: OnceCell<DatasetIdResolverFn> = OnceCell::new();
static AUTH_PAGE_LAUNCHER: OnceCell<AuthPageLauncherFn> = OnceCell::new();

pub fn set_dataset_id_resolver<F, Fut>(resolver: F) -> Result<(), &'static str>
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = String> + Send + 'static,
{
    DATASET_ID_RESOLVER
        .set(Arc::new(move || Box::pin(resolver())))
        .map_err(|_| "dataset id resolver already initialized")
}

pub async fn resolve_dataset_id() -> Option<String> {
    let resolver = DATASET_ID_RESOLVER.get()?;
    Some((resolver)().await)
}

pub fn set_auth_page_launcher<F>(launcher: F) -> Result<(), &'static str>
where
    F: Fn() -> Result<(), String> + Send + Sync + 'static,
{
    AUTH_PAGE_LAUNCHER
        .set(Arc::new(launcher))
        .map_err(|_| "auth page launcher already initialized")
}

pub fn launch_auth_page() -> Result<(), String> {
    let Some(launcher) = AUTH_PAGE_LAUNCHER.get() else {
        return Ok(());
    };
    launcher()
}
