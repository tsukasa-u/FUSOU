use tauri::AppHandle;
use webbrowser::{open_browser, Browser};
use std::{fs, sync::{LazyLock, Mutex}};

#[derive(Debug, Default )]
pub struct BrowserState(Browser);

impl BrowserState {
    pub fn new() -> Self {
        BrowserState(Browser::default())
    }

    pub fn set_browser(&mut self, browser: &Browser) {
      browser.clone_into(&mut self.0);
      // self.0 = browser.clone();
    }

    pub fn get_browser(&self) -> Browser {
        self.0.clone()
    }
}

pub static SHARED_BROWSER: LazyLock<Mutex<BrowserState>> = LazyLock::new(|| Mutex::new(BrowserState::new()));

pub fn create_external_window(app: &AppHandle, browser: Option<Browser>, browse_webview: bool) {

    
    if browse_webview {
        let init_script = fs::read_to_string("./../src/init_script.js").expect("Unable to read init_script.js");
      
        let _external = tauri::WindowBuilder::new(
          app,
          "external",
          tauri::WindowUrl::External("http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/".parse().unwrap()),
        )
        .fullscreen(false)
        .title("fusou-viewer")
        .inner_size(1192_f64, 712_f64)
        .visible(false)
        .initialization_script(&init_script)
        .build()
        .expect("error while building external");
    } else {
        let _ = open_browser(browser.unwrap(), "http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/").unwrap();
    }
    
    // #[cfg(target_os = "linux")]
    // {
    //   let context = webkit2gtk::WebContext::default().expect("Failed to get default WebContext");
    //   context.set_network_proxy_settings(webkit2gtk::NetworkProxyMode::Default, None);
    //   // #[cfg(feature = "v2_6")]
    //   // let webview = webkit2gtk::WebView::with_context(&context);
    //   // #[cfg(not(feature = "v2_6"))]
    //   let webview = webkit2gtk::WebViewBuilder::new().web_context(&context).build();
    //   // println!("{:?}", external.gtk_window().unwrap().default_widget());
    //   // let widget =  external.gtk_window().unwrap().default_widget().unwrap();
    //   // external.gtk_window().unwrap().remove(&widget);
    //   // external.gtk_window().unwrap().add(&webview);
    //   // external.gtk_window().unwrap().show_all();
  
    //   let gtk_window = gtk::ApplicationWindow::new(
    //     &external.gtk_window().unwrap().application().unwrap(),
    //   );
    //   // gtk_window.set_app_paintable(true);
    //   gtk_window.set_window_position(gtk::WindowPosition::Mouse);
    //   gtk_window.set_height_request(480);
    //   gtk_window.set_width_request(640);
    //   gtk_window.add(&webview);
    //   webview.load_uri("http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/");
    //   gtk_window.show();
    // }
  
  }