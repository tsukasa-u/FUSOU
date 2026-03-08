use configs;
use kc_api::interface::deck_port::Basic;
use super::member_id_cache::MemberIdCache;

pub fn open_auth_page() -> Result<(), String> {
    if configs::get_user_configs_for_app().auth.get_deny_auth() {
        return Err("User authentication is denied".into());
    }

    let auth_page_url = configs::get_user_configs_for_app().auth.get_auth_page_url();
    let result = webbrowser::open(&auth_page_url).map_err(|e| e.to_string());
    return result;
}

/// Open auth page with member_id_hash parameter for conflict detection
pub fn open_auth_page_with_member_id(member_id_hash: &str) -> Result<(), String> {
    if configs::get_user_configs_for_app().auth.get_deny_auth() {
        return Err("User authentication is denied".into());
    }

    let mut auth_page_url = configs::get_user_configs_for_app().auth.get_auth_page_url();
    
    // Append member_id_hash as query parameter
    // Use simple URL encoding for hexadecimal string (no special chars expected)
    if auth_page_url.contains('?') {
        auth_page_url.push_str(&format!("&member_id_hash={}&app_origin=tauri", member_id_hash));
    } else {
        auth_page_url.push_str(&format!("?member_id_hash={}&app_origin=tauri", member_id_hash));
    }
    
    tracing::info!("Opening auth page with member_id_hash parameter");
    
    // Save to cache for future use
    if let Err(e) = MemberIdCache::save(member_id_hash) {
        tracing::warn!("Failed to cache member_id_hash: {}", e);
    }
    
    let result = webbrowser::open(&auth_page_url).map_err(|e| e.to_string());
    return result;
}

/// Get member_id_hash from game or cache, with priority given to live game data
fn get_member_id_hash_with_cache() -> Result<String, String> {
    // First, try to load from game (authoritative source)
    let basic = Basic::load();
    let game_member_id_hash = basic.member_id.clone();
    
    if !game_member_id_hash.is_empty() {
        tracing::info!("Loaded member_id_hash from game data");
        
        // Check against cache for conflict detection
        if let Some(cached) = MemberIdCache::load() {
            if cached.member_id_hash != game_member_id_hash {
                tracing::warn!(
                    "member_id_hash changed! Old: {}..., New: {}...",
                    &cached.member_id_hash[..cached.member_id_hash.len().min(10)],
                    &game_member_id_hash[..game_member_id_hash.len().min(10)]
                );
                tracing::warn!("Game account may have changed - clearing old cache and using new value");
                // Update cache with new value
                let _ = MemberIdCache::save(&game_member_id_hash);
            }
        } else {
            // No cache exists, save current value
            let _ = MemberIdCache::save(&game_member_id_hash);
        }
        
        return Ok(game_member_id_hash);
    }
    
    // Game data not available, try cache as fallback
    if let Some(cached) = MemberIdCache::load() {
        tracing::info!(
            "Game not running - using cached member_id_hash (provisional value)"
        );
        tracing::warn!(
            "Using cached value is less reliable - please launch the game for accurate detection"
        );
        return Ok(cached.member_id_hash);
    }
    
    // No game data and no cache
    Err("member_id_hash not available; launch the game to obtain it".into())
}

/// Open auth page, automatically reading current `member_id_hash` from game or cache.
/// Prefer this helper to ensure the auth page always receives context.
pub fn open_auth_page_with_current_member_id() -> Result<(), String> {
    let member_id_hash = get_member_id_hash_with_cache()?;
    open_auth_page_with_member_id(&member_id_hash)
}
