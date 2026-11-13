use crate::notify;
use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{PendingStore, UploadContext, UploadRequest, UploadResult, Uploader};
use kc_api::fleet_snapshot::fleet::FleetSnapshot;
use kc_api::interface::{deck_port, ship, slot_item, use_items};
use reqwest::Client;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

fn build_fleet_snapshot_value(
    ships: &ship::Ships,
    use_items: &use_items::UseItems,
    slot_items: &slot_item::SlotItems,
    deck_data: &deck_port::DeckPorts,
) -> serde_json::Value {
    let mut ships_vec: Vec<_> = ships.ships.values().cloned().collect();
    ships_vec.sort_by_key(|s| s.id);

    let mut use_items_vec: Vec<_> = use_items.use_items.values().cloned().collect();
    use_items_vec.sort_by_key(|u| u.id);

    let mut slot_items_vec: Vec<_> = slot_items.slot_items.values().cloned().collect();
    slot_items_vec.sort_by_key(|s| s.id);

    let mut deck_ports_vec: Vec<_> = deck_data.deck_ports.values().cloned().collect();
    deck_ports_vec.sort_by_key(|d| d.id);

    let payload = FleetSnapshot::new(
        ships_vec,
        use_items_vec,
        slot_items_vec,
        deck_ports_vec,
        deck_data.combined_flag,
    );
    json!(payload)
}

fn get_payload_data() -> serde_json::Value {
    let use_items = use_items::UseItems::load();
    let ships = ship::Ships::load();
    let slot_items = slot_item::SlotItems::load();
    let deck_data = deck_port::DeckPorts::load();
    build_fleet_snapshot_value(&ships, &use_items, &slot_items, &deck_data)
}

fn canonicalize_json(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::{Map, Value};
    match value {
        Value::Object(map) => {
            let mut btree: std::collections::BTreeMap<String, Value> =
                std::collections::BTreeMap::new();
            for (k, v) in map.iter() {
                btree.insert(k.clone(), canonicalize_json(v));
            }
            let mut ordered = Map::new();
            for (k, v) in btree.into_iter() {
                ordered.insert(k, v);
            }
            Value::Object(ordered)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(canonicalize_json).collect()),
        _ => value.clone(),
    }
}

pub async fn perform_snapshot_sync_app(
    app: &AppHandle,
    auth_manager: Arc<Mutex<AuthManager<FileStorage>>>,
) -> Result<serde_json::Value, String> {
    tracing::info!("Starting snapshot sync");

    let app_configs = configs::get_user_configs_for_app();

    let snapshot_url = if let Some(explicit) = app_configs.asset_sync.get_snapshot_endpoint() {
        explicit
    } else {
        tracing::error!("Snapshot endpoint not configured");
        return Err("Snapshot endpoint not configured".to_string());
    };

    let payload_data = canonicalize_json(&get_payload_data());
    // Compute SHA-256 of the raw JSON bytes to satisfy server-side verification
    let payload_bytes = match serde_json::to_vec(&payload_data) {
        Ok(b) => b,
        Err(e) => {
            let msg = format!("Failed to serialize payload: {}", e);
            tracing::error!("{}", msg);
            return Err(msg);
        }
    };

    tracing::info!(
        payload_size_bytes = payload_bytes.len(),
        "Prepared snapshot data"
    );

    let manager = auth_manager
        .lock()
        .map_err(|e| format!("auth_manager lock poisoned: {e}"))?
        .clone();

    // Build handshake request body via common helper (include dataset_id)
    let Some(dataset_id) = crate::util::resolve_dataset_id_for_current_member(&manager).await
    else {
        let msg = "dataset_id is not ready (no valid dataset_token)".to_string();
        tracing::warn!("{}", msg);
        return Err(msg);
    };
    let handshake_body = fusou_upload::Uploader::build_snapshot_handshake("latest", &dataset_id);

    let mut headers = std::collections::HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    let idempotency_key = Uuid::new_v4().to_string();
    headers.insert("Idempotency-Key".to_string(), idempotency_key);

    let request = UploadRequest {
        endpoint: &snapshot_url,
        handshake_body,
        data: payload_bytes,
        headers,
        context: UploadContext::Snapshot { is_snapshot: true },
    };

    let client = Client::new();
    let pending_store = app.try_state::<Arc<PendingStore>>();

    tracing::info!(endpoint = %snapshot_url, "Starting snapshot upload via Uploader");
    match Uploader::upload(
        &client,
        &manager,
        request,
        pending_store.as_deref().map(|s| s.as_ref()),
    )
    .await
    {
        Ok(UploadResult::Success) => {
            tracing::info!("Snapshot upload successful");
            notify::show(app, "Snapshot sync", "Snapshot sync completed");
            Ok(json!({ "ok": true, "tag": "latest" }))
        }
        Ok(UploadResult::Skipped) => {
            tracing::info!("Snapshot skipped (already exists or empty)");
            notify::show(app, "Snapshot sync", "Snapshot already up-to-date");
            Ok(json!({ "ok": true, "skipped": true, "tag": "latest" }))
        }
        Err(e) => {
            // Check for authentication errors
            if e.contains("Authentication error") {
                notify::show(
                    app,
                    "Sign-in Required",
                    "Session expired. Please continue authentication from FUSOU-WEB.",
                );
            } else {
                notify::show(app, "Snapshot sync failed", &format!("Upload error: {}", e));
            }
            tracing::error!(error = %e, "Snapshot upload failed");
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kc_api::interface::deck_port::DeckPort;
    use kc_api::interface::slot_item::SlotItem;
    use kc_api::interface::use_items::UseItem;
    use std::collections::HashMap;

    #[test]
    fn build_fleet_snapshot_value_is_deterministic_across_insertion_orders() {
        let make_ship = |id| kc_api::interface::ship::Ship {
            id,
            ship_id: Some(1),
            lv: Some(1),
            exp: None,
            nowhp: None,
            maxhp: None,
            soku: None,
            leng: None,
            slot: None,
            onslot: None,
            slot_ex: None,
            fuel: None,
            bull: None,
            slotnum: None,
            cond: None,
            cond_state: None,
            karyoku: None,
            raisou: None,
            taiku: None,
            soukou: None,
            kaihi: None,
            taisen: None,
            sakuteki: None,
            lucky: None,
            sally_area: None,
            sortie_tag_id: None,
            sp_effect_items: None,
        };
        let make_deck = |id| DeckPort {
            id,
            name: format!("Deck {id}"),
            mission: vec![],
            ship: None,
            chart_seiku_value: None,
            chart_tp_value: None,
        };

        let mut ships_a = HashMap::new();
        for id in [30_i64, 10, 20] {
            ships_a.insert(id, make_ship(id));
        }
        let mut ships_b = HashMap::new();
        for id in [20_i64, 30, 10] {
            ships_b.insert(id, make_ship(id));
        }

        let mut use_a = HashMap::new();
        for id in [9_i64, 2] {
            use_a.insert(id, UseItem { id, count: id * 5 });
        }
        let mut use_b = HashMap::new();
        for id in [2_i64, 9] {
            use_b.insert(id, UseItem { id, count: id * 5 });
        }

        let mut slot_a = HashMap::new();
        for id in [500_i64, 100] {
            slot_a.insert(
                id,
                SlotItem {
                    id,
                    slotitem_id: 1,
                    locked: 0,
                    level: 0,
                    alv: None,
                },
            );
        }
        let mut slot_b = HashMap::new();
        for id in [100_i64, 500] {
            slot_b.insert(
                id,
                SlotItem {
                    id,
                    slotitem_id: 1,
                    locked: 0,
                    level: 0,
                    alv: None,
                },
            );
        }

        let mut deck_a = HashMap::new();
        for id in [2_i64, 1] {
            deck_a.insert(id, make_deck(id));
        }
        let mut deck_b = HashMap::new();
        for id in [1_i64, 2] {
            deck_b.insert(id, make_deck(id));
        }

        let val_a = canonicalize_json(&build_fleet_snapshot_value(
            &ship::Ships { ships: ships_a },
            &use_items::UseItems { use_items: use_a },
            &slot_item::SlotItems { slot_items: slot_a },
            &deck_port::DeckPorts {
                deck_ports: deck_a,
                combined_flag: Some(0),
            },
        ));
        let val_b = canonicalize_json(&build_fleet_snapshot_value(
            &ship::Ships { ships: ships_b },
            &use_items::UseItems { use_items: use_b },
            &slot_item::SlotItems { slot_items: slot_b },
            &deck_port::DeckPorts {
                deck_ports: deck_b,
                combined_flag: Some(0),
            },
        ));

        assert_eq!(
            serde_json::to_vec(&val_a).unwrap(),
            serde_json::to_vec(&val_b).unwrap()
        );
    }
}
