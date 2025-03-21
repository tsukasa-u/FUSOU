#![allow(dead_code)]

use tauri::{api::notification::Notification, AppHandle};

#[derive(Debug, Clone)]
pub struct NotificationContent {
    pub title: String,
    pub body: String,
    pub icon: String,
}

impl NotificationContent {
    pub fn new(title: &str, body: &str, icon: &str) -> Self {
        NotificationContent {
            title: title.to_string(),
            body: body.to_string(),
            icon: icon.to_string(),
        }
    }
}

impl Default for NotificationContent {
    fn default() -> Self {
        NotificationContent {
            title: "New message".to_string(),
            body: "".to_string(),
            icon: "src-tauri/icons/icon.png".to_string(),
        }
    }
}

pub fn wrap_notification(app: &AppHandle, content: NotificationContent) {
    Notification::new(&app.config().tauri.bundle.identifier)
        // .sound(sound)
        .title(content.title.as_str())
        .body(content.body.as_str())
        .icon(content.icon.as_str())
        .show()
        .expect("unable to show notification");

    // Notification::new(&app.config().tauri.bundle.identifier).show().expect("unable to show notification");
    println!("notification sent")
}
