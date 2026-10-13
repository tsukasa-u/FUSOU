pub mod crypto;
pub mod device_key;
pub mod error;
pub mod manager;
pub mod storage;
pub mod types;

pub use crypto::{verify_ed25519_signature, Ed25519SignatureError};
pub use device_key::{DeviceKey, DeviceKeyRecord};
pub use manager::AuthManager;
pub use storage::{FileStorage, InMemoryStorage, Storage};
pub use types::Session;
