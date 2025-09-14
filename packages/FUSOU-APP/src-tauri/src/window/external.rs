use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Manager};
use tracing_unwrap::ResultExt;
use webbrowser::{open_browser, Browser};

static DEFAULT_GAME_URL: &str = "http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/";

static GAME_URL: once_cell::sync::OnceCell<String> = once_cell::sync::OnceCell::new();

fn get_game_url() -> String {
    GAME_URL
        .get_or_init(|| {
            if let Some(game_url) = configs::get_user_configs_for_app().browser.get_url() {
                game_url
            } else {
                DEFAULT_GAME_URL.to_string()
            }
        })
        .clone()
}

#[derive(Debug, Default)]
pub struct BrowserState(Browser);

impl BrowserState {
    pub fn new() -> Self {
        BrowserState(Browser::default())
    }

    // pub fn set_browser(&mut self, browser: &Browser) {
    //     browser.clone_into(&mut self.0);
    //     // self.0 = browser.clone();
    // }

    pub fn get_browser(&self) -> Browser {
        self.0
    }
}

pub static SHARED_BROWSER: LazyLock<Mutex<BrowserState>> =
    LazyLock::new(|| Mutex::new(BrowserState::new()));

pub fn create_external_window(app: &AppHandle, browser: Option<Browser>, browse_webview: bool) {
    if browse_webview {
        if let Some(window) = app.get_webview_window("external") {
            match window.is_visible() {
                Ok(visible) => {
                    if !visible {
                        window
                            .show()
                            .expect_or_log("Failed to show external window");
                    }
                }
                Err(e) => {
                    tracing::error!("Error: {e:?}");
                }
            }
            return;
        } else {
            tracing::error!("can not get webview windows \"external\"");
        }

        let init_script = include_str!("./scripts/external_init_script.js");

        let external = tauri::WebviewWindowBuilder::new(
            app,
            "external",
            tauri::WebviewUrl::External(get_game_url().parse().unwrap()),
        );

        let external_result = external
            .fullscreen(false)
            .title("fusou-viewer")
            .inner_size(1192_f64, 712_f64)
            .visible(false)
            .initialization_script(init_script)
            .build()
            .expect_or_log("error while building external");
        external_result
            .show()
            .expect_or_log("can not show external window");
    } else {
        open_browser(browser.unwrap(), &get_game_url()).unwrap();
    }
}
