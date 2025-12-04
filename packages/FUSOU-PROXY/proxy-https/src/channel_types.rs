#[derive(Debug, Clone)]
pub enum StatusInfo {
    HEALTH {
        status: String,
        message: String,
    },
    SHUTDOWN {
        status: String,
        message: String,
    },
    RESPONSE {
        path: String,
        content_type: String,
        content: String,
    },
    REQUEST {
        path: String,
        content_type: String,
        content: String,
    },
}
