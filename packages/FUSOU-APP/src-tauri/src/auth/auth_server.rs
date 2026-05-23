use super::member_id_cache::MemberIdCache;
use configs;
use kc_api::interface::deck_port::Basic;

fn normalize_member_id_hash(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.len() == 64
        && normalized
            .as_bytes()
            .iter()
            .all(|b| b.is_ascii_hexdigit())
    {
        Some(normalized)
    } else {
        None
    }
}

pub fn open_auth_page() -> Result<(), String> {
    if configs::get_user_configs_for_app().auth.get_deny_auth() {
        return Err("User authentication is denied".into());
    }

    let auth_page_url = configs::get_user_configs_for_app().auth.get_auth_page_url();
    let result = webbrowser::open(&auth_page_url).map_err(|e| e.to_string());
    return result;
}

/// Get member_id_hash from game or cache, with priority given to live game data.
/// Game data is the authoritative source; cache is used as fallback when the game is not running.
pub fn get_member_id_hash_with_cache() -> Result<String, String> {
    // First, try to load from game (authoritative source)
    let basic = Basic::load();
    let game_member_id_raw = basic.member_id.clone();

    if !game_member_id_raw.is_empty() {
        if let Some(game_member_id_hash) = normalize_member_id_hash(&game_member_id_raw) {
            tracing::info!("Loaded member_id_hash from game data");

            // Check against cache for conflict detection
            if let Some(cached) = MemberIdCache::load() {
                if let Some(cached_hash) = normalize_member_id_hash(&cached.member_id_hash) {
                    if cached_hash != game_member_id_hash {
                        tracing::warn!("member_id_hash changed; updating cached value");
                        tracing::warn!(
                            "Game account may have changed - clearing old cache and using new value"
                        );
                        // Update cache with new value
                        let _ = MemberIdCache::save(&game_member_id_hash);
                    }
                } else {
                    tracing::warn!(
                        "Cached member_id_hash has invalid format; replacing with live game value"
                    );
                    let _ = MemberIdCache::save(&game_member_id_hash);
                }
            } else {
                // No cache exists, save current value
                let _ = MemberIdCache::save(&game_member_id_hash);
            }

            return Ok(game_member_id_hash);
        } else {
            tracing::warn!(
                "Game member_id is not a 64-character hash; legacy member_id_hash sync is unavailable"
            );
        }
    }

    // Game data not available, try cache as fallback
    if let Some(cached) = MemberIdCache::load() {
        if let Some(cached_hash) = normalize_member_id_hash(&cached.member_id_hash) {
            tracing::info!("Game not running - using cached member_id_hash (provisional value)");
            tracing::warn!(
                "Using cached value is less reliable - please launch the game for accurate detection"
            );
            return Ok(cached_hash);
        }

        tracing::warn!(
            "Cached member_id_hash is invalid. Clearing stale cache and requiring a fresh value"
        );
        let _ = MemberIdCache::clear();
    }

    // No game data and no cache
    Err(
        "member_id_hash not available; launch the game with legacy hash support or complete anonymous v2 auth first"
            .into(),
    )
}
