// Root path validation for local filesystem storage.
//
// All root resolution and path-containment checks are centralised here.
// No other module should re-implement these rules independently.
//
// Design guarantees
// -----------------
// * The storage root is always derived from the application configuration,
//   never from caller-supplied strings (prevents context-injection attacks).
// * Path containment is enforced by cap-std's Dir, which delegates to openat
//   internally; symlink-based escapes and TOCTOU races are prevented at the
//   kernel level.
// * All public entry-points return a typed RootValidatorError so callers
//   cannot silently swallow rejections.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use cap_std::fs::Dir;

use crate::constants::STORAGE_SUB_DIR_NAME;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum RootValidatorError {
    /// The path resolution or I/O step failed.
    Io(std::io::Error),
    /// A required path component (file name, parent) could not be extracted.
    InvalidPath(&'static str),
}

impl std::fmt::Display for RootValidatorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RootValidatorError::Io(e) => write!(f, "root_validator I/O error: {e}"),
            RootValidatorError::InvalidPath(msg) => write!(f, "root_validator invalid path: {msg}"),
        }
    }
}

impl std::error::Error for RootValidatorError {}

impl From<std::io::Error> for RootValidatorError {
    fn from(e: std::io::Error) -> Self {
        RootValidatorError::Io(e)
    }
}

// ---------------------------------------------------------------------------
// Root resolution
// ---------------------------------------------------------------------------

/// Resolve the LocalFS root directory from application configuration.
///
/// The `output_directory` argument is the value obtained from
/// `configs.database.local.get_output_directory()`.  It is accepted as a
/// parameter so callers can pass it explicitly; the default fallback is
/// computed inside this function.
pub fn resolve_root(output_directory: Option<String>) -> PathBuf {
    output_directory
        .map(PathBuf::from)
        .unwrap_or_else(default_root_directory)
}

/// Convenience wrapper that reads configuration internally.
///
/// Prefer this over `resolve_root` in contexts where the config is not
/// already in scope, so that root resolution is always consistent.
pub fn resolve_root_from_config() -> PathBuf {
    let app_configs = configs::get_user_configs_for_app();
    resolve_root(app_configs.database.local.get_output_directory())
}

fn default_root_directory() -> PathBuf {
    if cfg!(debug_assertions) {
        // Preserve the same dev default used before storage crate extraction.
        // Original location: packages/FUSOU-APP/src-tauri + "../../FUSOU-DATABASE".
        // Extracted location: packages/fusou-storage + "../FUSOU-DATABASE".
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../FUSOU-DATABASE");
    }

    release_default_root_directory(dirs::document_dir(), std::env::current_dir().ok())
}

fn release_default_root_directory(
    document_dir: Option<PathBuf>,
    current_dir: Option<PathBuf>,
) -> PathBuf {
    if let Some(doc_dir) = document_dir {
        doc_dir.join("fusou").join(STORAGE_SUB_DIR_NAME)
    } else if let Some(cwd) = current_dir {
        cwd.join("fusou").join(STORAGE_SUB_DIR_NAME)
    } else {
        PathBuf::from("fusou").join(STORAGE_SUB_DIR_NAME)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_default_matches_pre_extraction_target_path() {
        let expected = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../FUSOU-DATABASE");

        assert_eq!(default_root_directory(), expected);
    }

    #[test]
    fn release_default_prefers_document_dir() {
        let doc = PathBuf::from("doc-root");
        let cwd = PathBuf::from("cwd-root");

        let actual = release_default_root_directory(Some(doc.clone()), Some(cwd));

        assert_eq!(actual, doc.join("fusou").join(STORAGE_SUB_DIR_NAME));
    }

    #[test]
    fn release_default_uses_current_dir_when_document_dir_missing() {
        let cwd = PathBuf::from("cwd-root");

        let actual = release_default_root_directory(None, Some(cwd.clone()));

        assert_eq!(actual, cwd.join("fusou").join(STORAGE_SUB_DIR_NAME));
    }

    #[test]
    fn release_default_uses_relative_fallback_when_no_base_dirs_available() {
        let actual = release_default_root_directory(None, None);

        assert_eq!(actual, PathBuf::from("fusou").join(STORAGE_SUB_DIR_NAME));
    }
}

// ---------------------------------------------------------------------------
// cap-std Dir handle — the TOCTOU-free write foundation
// ---------------------------------------------------------------------------

/// Open the given `root` directory as a cap-std `Dir` handle.
///
/// All subsequent writes done through the returned handle use `openat`
/// internally; the kernel enforces containment, so symlink-based escapes
/// and TOCTOU races between check and write are structurally impossible.
///
/// The directory is created if it does not yet exist.
pub fn open_root_dir(root: &Path) -> Result<Dir, RootValidatorError> {
    std::fs::create_dir_all(root).map_err(RootValidatorError::Io)?;
    Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(RootValidatorError::Io)
}

/// Write `data` to `relative_path` under a cap-std `Dir` handle.
///
/// `relative_path` is validated inside this function before any I/O,
/// so `..` and absolute path components are rejected early.
/// The parent directories are created if they do not exist.
///
/// This is a blocking operation and should be called inside
/// `tokio::task::spawn_blocking` when invoked from an async context.
pub fn write_at_relative(
    dir: &Dir,
    relative_path: &str,
    data: &[u8],
) -> Result<(), RootValidatorError> {
    use std::io::Write;
    use std::path::Component;

    let rel = Path::new(relative_path);
    // Validate components before touching the filesystem.
    for component in rel.components() {
        match component {
            Component::ParentDir => {
                return Err(RootValidatorError::InvalidPath(
                    "relative_path must not contain '..'",
                ));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(RootValidatorError::InvalidPath(
                    "relative_path contains forbidden prefix/root",
                ));
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }

    // Create parent directories inside the capability boundary.
    if let Some(parent) = rel.parent() {
        if parent != Path::new("") {
            dir.create_dir_all(parent).map_err(RootValidatorError::Io)?;
        }
    }

    // Open/create the file and write — all via openat through the Dir handle.
    let mut file = dir
        .open_with(
            rel,
            cap_std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true),
        )
        .map_err(RootValidatorError::Io)?;
    file.write_all(data).map_err(RootValidatorError::Io)?;
    Ok(())
}

/// Async wrapper for [`write_at_relative`].
///
/// Runs the blocking write on a Tokio blocking thread so it does not starve
/// the async runtime.  `dir` is wrapped in an `Arc` to allow it to be moved
/// into the blocking task.
pub async fn write_at_relative_async(
    dir: Arc<Dir>,
    relative_path: String,
    data: Vec<u8>,
) -> Result<(), RootValidatorError> {
    tokio::task::spawn_blocking(move || write_at_relative(&dir, &relative_path, &data))
        .await
        .map_err(|e| RootValidatorError::Io(std::io::Error::other(e)))?
}
