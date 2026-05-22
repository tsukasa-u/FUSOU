//! 端末ローカル Ed25519 keypair の生成・永続化・署名ユーティリティ。
//!
//! v2 anonymous-sync では、端末を以下の手順で本人性証明する:
//!   1. 端末は OS の CSPRNG で Ed25519 keypair を 1 度だけ生成する
//!   2. 公開鍵を `/anonymous-sync/v2/register` に送り、サーバーが `device_id` を発行する
//!   3. 以降の `/v2/refresh` / `/v2/revoke` ではサーバーから受け取った challenge nonce
//!      に署名して送信する
//!
//! 秘密鍵は端末外に出さない。本モジュールでは Tauri Stronghold / OS keyring との統合は
//! まだ行わず、`%APPDATA%/...` (Windows) / `~/.local/share/...` (Unix) 直下に `0600`
//! 相当のファイルとして書き出す最小実装で完結させる。後段で Stronghold へ差し替えても
//! `DeviceKey` の外向き API (`public_key_b64` / `sign_b64` / `device_id`) は変えない。
//!
//! ファイル形式 (`device-key.json`):
//! ```json
//! {
//!   "device_id": "<UUID v4 string or null until registered>",
//!   "secret_key": "<base64 of 32-byte Ed25519 secret seed>",
//!   "public_key": "<base64 of 32-byte Ed25519 public key>",
//!   "created_at": "<ISO8601 UTC>"
//! }
//! ```
//!
//! `device_id` はサーバー発行なので初回起動時は `None`。`/v2/register` 成功後に
//! `set_device_id()` で確定値を書き戻す。

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey, SECRET_KEY_LENGTH};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

use crate::error::AuthError;

/// 端末ローカルに永続化される keypair レコード。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeviceKeyRecord {
    /// サーバーが発行した device_id。register 成功までは `None`。
    #[serde(default)]
    pub device_id: Option<String>,
    /// Ed25519 秘密鍵 32 バイトの base64 表現 (seed)。端末外に出さない。
    pub secret_key: String,
    /// Ed25519 公開鍵 32 バイトの base64 表現。サーバーに登録する値と一致する。
    pub public_key: String,
    /// keypair 生成時刻。監査用。
    pub created_at: DateTime<Utc>,
}

/// 公開 API 用に署名処理を集約した型。
/// `DeviceKey::load_or_create` で取得し、`sign_b64()` で challenge nonce 等に署名する。
pub struct DeviceKey {
    signing_key: SigningKey,
    record: DeviceKeyRecord,
    storage_path: PathBuf,
}

impl DeviceKey {
    /// `storage_path` の keypair をロードする。ファイルが存在しない / 壊れている場合は
    /// 新規 keypair を生成して書き出す。
    ///
    /// 「壊れている」ケースを暗黙に上書きすると正規の端末が他人として再 register
    /// されてしまうため、本実装では JSON パース失敗時のみ `.broken` リネームを試み、
    /// 鍵長不整合等のスキーマ違反では `AuthError::Other` を返して呼び出し側に判断を委ねる。
    pub async fn load_or_create(storage_path: PathBuf) -> Result<Self, AuthError> {
        match Self::load_existing(&storage_path).await {
            Ok(Some(device_key)) => Ok(device_key),
            Ok(None) => Self::create_new(storage_path).await,
            Err(err) => Err(err),
        }
    }

    async fn load_existing(storage_path: &Path) -> Result<Option<Self>, AuthError> {
        let bytes = match tokio::fs::read(storage_path).await {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(AuthError::Other(err.to_string())),
        };

        let record: DeviceKeyRecord = match serde_json::from_slice(&bytes) {
            Ok(record) => record,
            Err(parse_err) => {
                let broken_path = storage_path.with_extension("broken");
                if let Err(rename_err) = tokio::fs::rename(storage_path, &broken_path).await {
                    tracing::warn!(
                        rename_error = %rename_err,
                        "device_key: failed to move broken record aside; will fail to load",
                    );
                } else {
                    tracing::warn!(
                        broken_path = %broken_path.display(),
                        parse_error = %parse_err,
                        "device_key: moved unparsable record aside; a new keypair will be generated",
                    );
                }
                return Ok(None);
            }
        };

        let signing_key = decode_signing_key(&record.secret_key)?;
        // 公開鍵が秘密鍵から再導出した値と一致するか検証する。
        // ファイル改竄や別端末からのコピーで不整合があれば即時拒否する。
        let derived_pub = B64.encode(signing_key.verifying_key().to_bytes());
        if derived_pub != record.public_key {
            return Err(AuthError::Other(
                "device_key: stored public_key does not match secret_key".to_string(),
            ));
        }

        Ok(Some(Self {
            signing_key,
            record,
            storage_path: storage_path.to_path_buf(),
        }))
    }

    async fn create_new(storage_path: PathBuf) -> Result<Self, AuthError> {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key: VerifyingKey = signing_key.verifying_key();
        let record = DeviceKeyRecord {
            device_id: None,
            secret_key: B64.encode(signing_key.to_bytes()),
            public_key: B64.encode(verifying_key.to_bytes()),
            created_at: Utc::now(),
        };

        let mut device_key = Self {
            signing_key,
            record,
            storage_path,
        };
        device_key.persist().await?;
        Ok(device_key)
    }

    async fn persist(&mut self) -> Result<(), AuthError> {
        let json = serde_json::to_string(&self.record)?;
        if let Some(parent) = self.storage_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AuthError::Other(e.to_string()))?;
        }
        tokio::fs::write(&self.storage_path, &json)
            .await
            .map_err(|e| AuthError::Other(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                &self.storage_path,
                std::fs::Permissions::from_mode(0o600),
            );
        }
        // Windows ではユーザー専有領域 (%APPDATA%) 前提のためファイルパーミッションは付けない。
        // Stronghold / OS keyring 統合時に併せて強化する。
        Ok(())
    }

    /// 公開鍵を base64 で取得する。サーバーへ送信する値。
    pub fn public_key_b64(&self) -> &str {
        &self.record.public_key
    }

    /// サーバー発行の device_id を取得する。register 前は `None`。
    pub fn device_id(&self) -> Option<&str> {
        self.record.device_id.as_deref()
    }

    /// `device_id` を確定して永続化する。`/v2/register` 成功時に呼ぶ。
    /// 既に値が設定されている場合は上書きせず警告だけ出す (誤上書き防止)。
    pub async fn set_device_id(&mut self, device_id: String) -> Result<(), AuthError> {
        if let Some(existing) = self.record.device_id.as_ref() {
            if existing == &device_id {
                return Ok(());
            }
            tracing::warn!(
                existing = %existing,
                incoming = %device_id,
                "device_key: refused to overwrite existing device_id",
            );
            return Err(AuthError::Other(
                "device_key: device_id is already set to a different value".to_string(),
            ));
        }
        self.record.device_id = Some(device_id);
        self.persist().await
    }

    /// 任意のメッセージに署名して base64 で返す。
    pub fn sign_b64(&self, message: &[u8]) -> String {
        let sig = self.signing_key.sign(message);
        B64.encode(sig.to_bytes())
    }
}

fn decode_signing_key(secret_b64: &str) -> Result<SigningKey, AuthError> {
    let bytes = B64
        .decode(secret_b64.trim())
        .map_err(|e| AuthError::Other(format!("device_key: secret_key not base64: {e}")))?;
    if bytes.len() != SECRET_KEY_LENGTH {
        return Err(AuthError::Other(format!(
            "device_key: secret_key length must be {SECRET_KEY_LENGTH} bytes, got {}",
            bytes.len()
        )));
    }
    let mut seed = [0u8; SECRET_KEY_LENGTH];
    seed.copy_from_slice(&bytes);
    Ok(SigningKey::from_bytes(&seed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "fusou-auth-device-key-test-{}.json",
            uuid_like_suffix(),
        ));
        p
    }

    fn uuid_like_suffix() -> String {
        use rand::RngCore;
        let mut bytes = [0u8; 8];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    #[tokio::test]
    async fn generates_and_reloads_same_keypair() {
        let path = temp_path();
        let key1 = DeviceKey::load_or_create(path.clone()).await.unwrap();
        let pub1 = key1.public_key_b64().to_string();

        let key2 = DeviceKey::load_or_create(path.clone()).await.unwrap();
        assert_eq!(key2.public_key_b64(), pub1);

        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn signature_is_verifiable() {
        let path = temp_path();
        let key = DeviceKey::load_or_create(path.clone()).await.unwrap();

        let message = b"hello world";
        let sig_b64 = key.sign_b64(message);
        let sig_bytes = B64.decode(&sig_b64).unwrap();
        let pub_bytes = B64.decode(key.public_key_b64()).unwrap();

        let verifying = VerifyingKey::from_bytes(
            <&[u8; 32]>::try_from(pub_bytes.as_slice()).unwrap(),
        )
        .unwrap();
        let signature =
            ed25519_dalek::Signature::from_bytes(<&[u8; 64]>::try_from(sig_bytes.as_slice()).unwrap());
        assert!(verifying.verify_strict(message, &signature).is_ok());

        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn device_id_set_then_persisted() {
        let path = temp_path();
        let mut key = DeviceKey::load_or_create(path.clone()).await.unwrap();
        assert!(key.device_id().is_none());

        key.set_device_id("00000000-0000-4000-8000-000000000000".to_string())
            .await
            .unwrap();
        assert_eq!(
            key.device_id(),
            Some("00000000-0000-4000-8000-000000000000")
        );

        // 再ロードしても値が保持される
        let reloaded = DeviceKey::load_or_create(path.clone()).await.unwrap();
        assert_eq!(
            reloaded.device_id(),
            Some("00000000-0000-4000-8000-000000000000")
        );

        // 異なる値での上書きは拒否される
        let mut reloaded_mut = reloaded;
        let result = reloaded_mut
            .set_device_id("11111111-1111-4111-8111-111111111111".to_string())
            .await;
        assert!(result.is_err());

        let _ = tokio::fs::remove_file(&path).await;
    }
}
