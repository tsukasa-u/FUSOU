use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::deck_port::{Basic, DeckPort, DeckPorts};
use std::collections::HashMap;
use sha2::{Sha256, Digest};
use once_cell::sync::OnceCell;

// アプリケーション固有の固定ソルト（レインボーテーブル攻撃を防ぐ）
// 環境変数 FUSOU_MEMBER_ID_SALT で上書き可能
// 重要: すべてのユーザー・デバイスで同じ値を使う必要があります
static MEMBER_ID_SALT: OnceCell<String> = OnceCell::new();

pub fn set_member_id_salt(salt: String) {
    MEMBER_ID_SALT.set(salt).ok();
}

fn get_member_id_salt() -> &'static str {
    // セキュリティのため、デフォルトは使用しない。
    // アプリ起動時に `set_member_id_salt()` が必ず呼ばれることを前提にする。
    match MEMBER_ID_SALT.get() {
        Some(s) => s.as_str(),
        None => panic!(
            "FUSOU_MEMBER_ID_SALT is not set. Call set_member_id_salt() at startup (e.g., from option_env!)."
        ),
    }
}

impl From<kcapi_main::api_port::port::ApiBasic> for InterfaceWrapper<Basic> {
    fn from(basic: kcapi_main::api_port::port::ApiBasic) -> Self {
        let input = format!("{}{}", basic.api_member_id, get_member_id_salt());
        let hashed_member_id = format!("{:x}", Sha256::digest(input.as_bytes()));
        Self(Basic {
            member_id: hashed_member_id,
        })
    }
}

impl From<Vec<kcapi_main::api_port::port::ApiDeckPort>> for InterfaceWrapper<DeckPorts> {
    fn from(deck_ports: Vec<kcapi_main::api_port::port::ApiDeckPort>) -> Self {
        let mut deck_port_list = HashMap::with_capacity(4);
        for deck_port in deck_ports {
            deck_port_list.insert(
                deck_port.api_id,
                InterfaceWrapper::<DeckPort>::from(deck_port).unwrap(),
            );
        }
        Self(DeckPorts {
            deck_ports: deck_port_list,
            combined_flag: None,
        })
    }
}

impl From<kcapi_main::api_port::port::ApiDeckPort> for InterfaceWrapper<DeckPort> {
    fn from(deck_port: kcapi_main::api_port::port::ApiDeckPort) -> Self {
        Self(DeckPort {
            id: deck_port.api_id,
            name: deck_port.api_name,
            mission: deck_port.api_mission,
            ship: Some(deck_port.api_ship),
        })
    }
}

impl From<kcapi_main::api_port::port::ApiData> for InterfaceWrapper<DeckPorts> {
    fn from(api_data: kcapi_main::api_port::port::ApiData) -> Self {
        let mut deck_ports =
            InterfaceWrapper::<DeckPorts>::from(api_data.api_deck_port.clone()).unwrap();
        deck_ports.combined_flag = api_data.api_combined_flag;
        if deck_ports.combined_flag.is_some_and(|flag| flag > 0) {
            if let Some(deck_port) = deck_ports.deck_ports.get_mut(&1) {
                deck_port.ship = Some(
                    [
                        api_data.api_deck_port[0].api_ship.clone(),
                        api_data.api_deck_port[1].api_ship.clone(),
                    ]
                    .concat(),
                );
            }
        }
        Self(deck_ports)
    }
}
