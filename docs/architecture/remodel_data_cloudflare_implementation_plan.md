# 艦これ 改修ツリーデータ蓄積 実装計画（Cloudflare / FUSOU）

> **quest-tree / ship-growth 実装からの教訓を反映済み。**
> 本機能は実験的であり、feature flag (`enable = false`) で完全に無効化できる。
> 既存の `json_parser.rs` の `tokio::spawn` パターンは変更しない（切り離し容易性のため）。

---

## 0. 収集目的

**改修ツリー**（remodel tree）の全貌をクラウドソースで再構築する。

必要な情報:
1. **どの秘書艦 × どの曜日** でどの装備が改修可能か（改修条件マッピング）
2. 各改修ステップで**レベルごとにどれくらいの資源・装備・アイテム**が必要か（通常改修 + 確実改修）
3. **転換改修の有無**と特殊消費アイテム（`change_flag` + `req_useitem_*`）

## 0.1 設計方針

| 方針 | 具体策 |
|---|---|
| 改修ツリー全体 | 2 API を収集: `remodel_slotlist`（改修条件一覧 + 通常コスト）, `remodel_slotlist_detail`（確実改修コスト + 特殊アイテム）。実行結果（`remodel_slot`）は収集しない — 転換改修の有無は `change_flag` で判定可能 |
| 秘書艦 × 曜日 | `remodel_slotlist` に秘書艦マスター ID と JST 曜日を付与。ゲームステート (`DeckPorts::load()` + `Ships::load()`) から Res 変換時に取得 |
| 環境差なし | `ingest_endpoint` は 1 つ。configs.toml の値をそのまま使う。dev / prod 分岐なし |
| 切り離し容易 | 新規ファイルのみで構成。既存ファイルへの変更は enum variant 追加・dispatch 分岐・config 構造体追加に限定。`json_parser.rs` の spawn 方式は触らない |
| Req/Res 相関 | `remodel_slotlist_detail` は Req コンテキストが必要。`Mutex<Option<T>>` 単一スロットで保持。`tokio::spawn` の race で Res が先に走った場合は warning + skip（0 埋め禁止） |
| 冪等制御 | APP 側 suppression cache のみ（ship_growth と同方式）。WEB 側の ingest_events テーブルは不要 |

---

## 1. 参照実装マッピング

| 役割 | 参照ファイル | 本機能の対応ファイル |
|---|---|---|
| Interface 型定義 | `kc_api/crates/kc-api-interface/src/quest.rs` | `…/remodel.rs` (新規) |
| Convert trait | `…/convert_trait/api_req_kousyou.rs` | 同ファイル更新 |
| DB モデル | `…/kc-api-database/src/models/quest.rs` | `…/models/remodel.rs` (新規) |
| APP sender | `FUSOU-APP/src-tauri/src/quest_tree_sender.rs` | `…/remodel_sender.rs` (新規) |
| APP dispatch | `FUSOU-APP/src-tauri/src/json_parser.rs` | 同ファイル更新（2 分岐追加: Set×2） |
| APP config | `configs/configs.toml` 他 3 ファイル | 同 3 ファイル更新 |
| APP lib.rs | `FUSOU-APP/src-tauri/src/lib.rs` | 同ファイル更新（初期化ブロック追加） |
| WEB route | `FUSOU-WEB/src/server/routes/quest_tree.ts` | `…/remodel_data.ts` (新規) |
| WEB types | `FUSOU-WEB/src/server/types.ts` | 同ファイル更新 |
| WEB utils | `FUSOU-WEB/src/server/utils.ts` | 同ファイル更新 |
| WEB app mount | `FUSOU-WEB/src/server/app.ts` | 同ファイル更新 |
| WEB migration | `FUSOU-WEB/migrations/remodel-index/` | `0001_add_remodel_data_tables.sql` (新規) |
| WEB wrangler | `FUSOU-WEB/wrangler.toml` | 同ファイル更新 |

---

## 2. 対象 API と DTO（確認済み）

### 2.1 `api_req_kousyou/remodel_slotlist`（改修条件一覧 — 収集対象）

**DTO**: `kc_api/crates/kc-api-dto/src/endpoints/api_req_kousyou/remodel_slotlist.rs`

**ツリーにおける役割**: 秘書艦 × 曜日 → 利用可能な改修レシピの一覧。**改修ツリーの backbone**。

| Req フィールド | 型 | 意味 |
|---|---|---|
| `api_token` | `String` | — |
| `api_verno` | `i64` | — |

Req に有用なコンテキストは存在しない。秘書艦と曜日は **ゲームステートから推定** する（§3.1 参照）。

| Res.api_data (Vec) フィールド | 型 | 意味 |
|---|---|---|
| `api_id` | `i64` | 改修ステップ ID（★レベルに対応） |
| `api_slot_id` | `i64` | 装備マスター ID |
| `api_sp_type` | `i64` | 特殊カテゴリ種別 |
| `api_req_fuel` | `i64` | 燃料消費 |
| `api_req_bull` | `i64` | 弾薬消費 |
| `api_req_steel` | `i64` | 鋼材消費 |
| `api_req_bauxite` | `i64` | ボーキサイト消費 |
| `api_req_buildkit` | `i64` | 開発資材消費（通常改修） |
| `api_req_remodelkit` | `i64` | 改修資材消費（通常改修） |
| `api_req_slot_id` | `i64` | 素材装備マスター ID（0 = 不要） |
| `api_req_slot_num` | `i64` | 素材装備必要数 |

**収集意義**:
- 「秘書艦 X × 曜日 Y で装備 Z のステップ S が改修可能」という**条件マッピング**の唯一のソース
- 基本資材コスト（燃弾鋼ボ + 通常改修資材）も含む
- `remodel_slotlist_detail` では得られない「一覧としての全レシピ」

### 2.2 `api_req_kousyou/remodel_slotlist_detail`（確実改修コスト — 収集対象）

**DTO**: `kc_api/crates/kc-api-dto/src/endpoints/api_req_kousyou/remodel_slotlist_detail.rs`

**ツリーにおける役割**: 各改修ステップの**確実改修コストおよび特殊消費アイテム**。slotlist にない情報を補完する。

| Req フィールド | 型 | 意味 |
|---|---|---|
| `api_slot_id` | `i64` | 装備**マスター ID**（`remodel_slotlist.api_slot_id` と同一） |
| `api_id` | `i64` | 改修ステップ ID（`remodel_slotlist.api_id` と同一） |

| Res.api_data フィールド | 型 | 意味 |
|---|---|---|
| `api_req_buildkit` | `i64` | 通常改修: 開発資材消費 |
| `api_req_remodelkit` | `i64` | 通常改修: 改修資材消費 |
| `api_certain_buildkit` | `i64` | 確実改修: 開発資材消費 |
| `api_certain_remodelkit` | `i64` | 確実改修: 改修資材消費 |
| `api_req_slot_id` | `i64` | 素材装備マスター ID（0 = 不要） |
| `api_req_slot_num` | `i64` | 素材装備必要数 |
| `api_change_flag` | `i64` | 1 = 改修で装備種別が変わる（転換改修） |
| `api_req_useitem_id` | `Option<i64>` | 特殊消費アイテム ID |
| `api_req_useitem_id2` | `Option<i64>` | 特殊消費アイテム ID（第2） |
| `api_req_useitem_num` | `Option<i64>` | 特殊消費アイテム数 |
| `api_req_useitem_num2` | `Option<i64>` | 特殊消費アイテム数（第2） |

**収集意義**:
- `api_certain_buildkit` / `api_certain_remodelkit` は `remodel_slotlist` には含まれず、この API が唯一のソース
- `api_change_flag` によって転換改修（装備種変更）を検出可能
- `api_req_useitem_*` による特殊消費アイテム情報

### 2.3 `api_req_kousyou/remodel_slot`（実行結果 — **収集しない**）

**DTO**: `kc_api/crates/kc-api-dto/src/endpoints/api_req_kousyou/remodel_slot.rs`

転換改修（装備種変更）の有無は `remodel_slotlist_detail` の `change_flag` で判定できるため、
実行結果の収集は不要。成功率統計もスコープ外。

### 2.4 2 API の相互関係

```
改修画面起動                    レシピ選択
     │                              │
     ▼                              ▼
remodel_slotlist              remodel_slotlist_detail
  Res: 全レシピ一覧              Req: (slot_id, id)
  + 基本コスト                   Res: 確実コスト
  + 秘書艦×曜日 [state推定]           + 特殊アイテム
                                      + change_flag
```

### 2.5 既存の convert_trait 状態

`convert_trait/api_req_kousyou.rs` は現在すべて `register_trait!` マクロによる空実装（`Some(vec![])` を返す）。
remodel 関連の 3 型を `register_trait!` から除外し、個別 `impl TraitForConvert` に置き換える:
- `remodel_slotlist::Res` — 一覧 + 秘書艦×曜日コンテキストを emit
- `remodel_slotlist_detail::{Req, Res}` — Req は context 保存、Res は detail emit

`remodel_slotlist::Req`, `remodel_slot::{Req, Res}` は有用な情報がないため `register_trait!` に残す（空実装）。

---

## 3. 秘書艦・曜日コンテキストの取得

### 3.1 取得方法

`remodel_slotlist` と `remodel_slotlist_detail` の Res 変換時に以下のゲームステートを読む:

```rust
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::ship::Ships;

/// 秘書艦（第 1 艦隊の旗艦）のマスター ID を取得
fn get_secretary_ship_master_id() -> Option<i64> {
    let deck_ports = DeckPorts::load();
    let first_fleet = deck_ports.deck_ports.get(&1)?;
    let first_ship_instance_id = first_fleet.ship.as_ref()?.first()?;
    let ships = Ships::load();
    let ship = ships.ships.get(first_ship_instance_id)?;
    ship.ship_id  // Ship.ship_id は Option<i64>
}

/// JST 曜日を取得（0=月, 1=火, ..., 6=日）
fn weekday_jst() -> i64 {
    use chrono::{Datelike, FixedOffset, Utc};
    let jst = FixedOffset::east_opt(9 * 3600).unwrap();
    let now = Utc::now().with_timezone(&jst);
    now.weekday().num_days_from_monday() as i64
}
```

### 3.2 信頼性

- `DeckPorts` / `Ships` はゲーム起動時の母港 API（`api_port/port`）で必ず設定される
- 改修画面に入るには母港を経由する必要があるため、改修 API 呼び出し時点では必ず populated
- `tokio::spawn` の race によりステートが「まだ設定されていない」リスクは実質ゼロ（改修操作は母港 API の後にしか発生しない）
- ただし `get_secretary_ship_master_id()` が `None` を返した場合は **emit せず warning で破棄** する

### 3.3 detail 以外の秘書艦・曜日

`remodel_slotlist_detail` のコストは秘書艦・曜日に依存しないため、detail 側には秘書艦・曜日を含めない（slotlist 側で保持）。

---

## 4. Req/Res コンテキスト相関

### 4.1 問題

`json_parser.rs` の `parser_server()` は各メッセージを `tokio::task::spawn` で処理するため、
同一 API コールの REQUEST と RESPONSE の処理順が保証されない。

```rust
// json_parser.rs L223-L231 (現状)
Some(bidirectional_channel::StatusInfo::RESPONSE { path, content_type: _, content }) => {
    let handle_clone = handle.clone();
    tokio::task::spawn(async move {
        // ...
    });
},
```

### 4.2 API 別の対応

| API | Req に有用な情報 | 対応 |
|---|---|---|
| `remodel_slotlist` | なし（token + verno のみ） | **対応不要**。Res 側で秘書艦・曜日をゲームステートから直接読む |
| `remodel_slotlist_detail` | `api_slot_id`（master ID）, `api_id` | `Mutex<Option<(i64, i64)>>` で保持 |

### 4.3 解決策（json_parser.rs を変更しない）

`Mutex<Option<T>>` 単一スロットを使用する。ゲームクライアントは同時に 1 つの改修操作しか実行しないため、
Req → Res の間に別の Req が割り込むことはない。

`tokio::spawn` の race により Res タスクが Req タスクより先に実行される可能性は理論上ある。
この場合 **warning を出して skip する**（0 埋め禁止）。実験的機能として許容する。

```rust
// kc_api/crates/kc-api-interface/src/remodel.rs
use once_cell::sync::Lazy;
use std::sync::Mutex;

/// remodel_slotlist_detail の Req コンテキスト: (slotitem_master_id, remodel_id)
pub static PENDING_DETAIL_REQ: Lazy<Mutex<Option<(i64, i64)>>> =
    Lazy::new(|| Mutex::new(None));
```

**禁止事項**:
- Req が取れないとき `0` 埋めで続行すること → 壊れたデータで DB を汚染する
- FIFO queue を使うこと → spawn 順序が保証されないため queue も意味がない

---

## 5. kc-api-interface に追加する型

**ファイル**: `kc_api/crates/kc-api-interface/src/remodel.rs`（新規作成）

```rust
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

// --- Req コンテキスト保持 ---

/// remodel_slotlist_detail の Req コンテキスト
pub static PENDING_DETAIL_REQ: Lazy<Mutex<Option<(i64, i64)>>> =
    Lazy::new(|| Mutex::new(None));

// --- remodel_slotlist: 改修条件一覧（秘書艦×曜日 → 利用可能レシピ） ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelSlotListEntry {
    pub remodel_id: i64,          // api_id（改修ステップ）
    pub slotitem_master_id: i64,  // api_slot_id（装備マスター ID）
    pub sp_type: i64,
    pub req_fuel: i64,
    pub req_bull: i64,
    pub req_steel: i64,
    pub req_bauxite: i64,
    pub req_buildkit: i64,
    pub req_remodelkit: i64,
    pub req_slot_id: i64,         // 素材装備マスター ID（0 = 不要）
    pub req_slot_num: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelSlotList {
    pub secretary_ship_master_id: i64,
    pub weekday_jst: i64,              // 0=月, 1=火, ..., 6=日
    pub entries: Vec<RemodelSlotListEntry>,
}

// --- remodel_slotlist_detail: 確実改修コスト + 特殊消費アイテム ---
// 通常改修コスト（req_buildkit/remodelkit, req_slot_id/num）は slotlist と重複するため省略。
// secretary_ship_master_id, weekday_jst も slotlist 側で保持 — detail のコストは秘書艦・曜日に依存しない。

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelDetail {
    pub slotitem_master_id: i64,      // Req.api_slot_id
    pub remodel_id: i64,              // Req.api_id
    pub certain_buildkit: i64,
    pub certain_remodelkit: i64,
    pub change_flag: i64,
    pub req_useitem_id: Option<i64>,
    pub req_useitem_id2: Option<i64>,
    pub req_useitem_num: Option<i64>,
    pub req_useitem_num2: Option<i64>,
}
```

**`kc_api/crates/kc-api-interface/src/lib.rs` に追加**:
```rust
pub mod remodel;
```

### 5.1 フィールド選定理由

| 含める | 理由 |
|---|---|
| `secretary_ship_master_id`, `weekday_jst` | **slotlist のみ**。改修ツリーの主キー軸。秘書艦×曜日→レシピ一覧 |
| `slotitem_master_id`, `remodel_id` | 装備種別とステップの識別子（両型共通） |
| `req_fuel/bull/steel/bauxite` | slotlist のみ。基本資材コスト |
| `req_buildkit/remodelkit` | slotlist のみ。通常改修コスト |
| `certain_buildkit/remodelkit` | detail のみ。確実改修コスト（この API 固有） |
| `req_slot_id/num` | slotlist のみ。素材装備コスト |
| `change_flag` | detail のみ。転換改修判定 |
| `req_useitem_*` | detail のみ。特殊消費（Optional） |

| 含めない | 理由 |
|---|---|
| `remodel_slot` 全体 | 転換改修の有無は `change_flag` で判定可能。成功率統計はスコープ外 |
| detail の `req_buildkit/remodelkit`, `req_slot_id/num` | slotlist と同一値。正規化して slotlist 側のみ保持 |
| detail の `secretary_ship_master_id`, `weekday_jst` | コストは秘書艦・曜日に依存しない。条件マッピングは slotlist 側で保持 |
| `api_after_material` | materials パイプラインと完全に重複 |
| `api_voice_ship_id`, `api_voice_id` | ユーザー体験のみ、分析価値なし |

---

## 6. EmitData enum への追加

**ファイル**: `kc_api/crates/kc-api-interface/src/interface.rs`

```rust
// use に追加
use crate::remodel::{RemodelSlotList, RemodelDetail};

// Set enum に追加（Dammy の直前）
Set::RemodelSlotList(RemodelSlotList),
Set::RemodelDetail(RemodelDetail),
```

2 つとも `Set` variant にする理由: `Add` は蓄積型（材料の加算など）に使われるが、
remodel は各 API レスポンスから生成される 1 イベント = 1 送信であり `Set` のパターンに合致する。

---

## 7. convert_trait の実装

**ファイル**: `kc_api/crates/kc-api-interface-adapter/src/convert_trait/api_req_kousyou.rs`

現在のファイル内容:
```rust
use kc_api_interface::interface::EmitData;
use kc_api_dto::endpoints::api_req_kousyou::*;
use crate::{register_trait, TraitForConvert};

register_trait!(
    Req, (createitem, createship, destroyitem2, destroyship, getship,
          remodel_slot, remodel_slotlist, remodel_slotlist_detail)
);
register_trait!(
    Res, (createitem, createship, destroyitem2, destroyship, getship,
          remodel_slot, remodel_slotlist, remodel_slotlist_detail)
);
```

変更後:
```rust
use kc_api_interface::interface::{EmitData, Set};
use kc_api_interface::remodel::{
    RemodelSlotList, RemodelSlotListEntry, RemodelDetail,
    PENDING_DETAIL_REQ,
};
use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::ship::Ships;
use kc_api_dto::endpoints::api_req_kousyou::*;
use crate::{register_trait, TraitForConvert};

// remodel_slotlist::Req, remodel_slot::{Req, Res} は register_trait! に残す（空実装）。
// 残り 3 型（remodel_slotlist::Res, remodel_slotlist_detail::{Req, Res}）を個別 impl に置き換える。
register_trait!(
    Req,
    (createitem, createship, destroyitem2, destroyship, getship, remodel_slot, remodel_slotlist)
);
register_trait!(
    Res,
    (createitem, createship, destroyitem2, destroyship, getship, remodel_slot)
);

// --- ヘルパー: 秘書艦・曜日コンテキスト取得 ---

fn get_secretary_ship_master_id() -> Option<i64> {
    let deck_ports = DeckPorts::load();
    let first_fleet = deck_ports.deck_ports.get(&1)?;
    let first_ship_instance_id = first_fleet.ship.as_ref()?.first()?;
    let ships = Ships::load();
    let ship = ships.ships.get(first_ship_instance_id)?;
    ship.ship_id  // Ship.ship_id は Option<i64>
}

fn weekday_jst() -> i64 {
    use chrono::{Datelike, FixedOffset, Utc};
    let jst = FixedOffset::east_opt(9 * 3600).unwrap();
    let now = Utc::now().with_timezone(&jst);
    now.weekday().num_days_from_monday() as i64
}

// --- remodel_slotlist: 改修条件一覧 ---

impl TraitForConvert for remodel_slotlist::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let secretary = match get_secretary_ship_master_id() {
            Some(v) => v,
            None => {
                tracing::warn!(
                    "remodel_slotlist: secretary ship not found; skip"
                );
                return Some(vec![]);
            }
        };
        let weekday = weekday_jst();
        let entries = self.api_data.iter().map(|d| RemodelSlotListEntry {
            remodel_id: d.api_id,
            slotitem_master_id: d.api_slot_id,
            sp_type: d.api_sp_type,
            req_fuel: d.api_req_fuel,
            req_bull: d.api_req_bull,
            req_steel: d.api_req_steel,
            req_bauxite: d.api_req_bauxite,
            req_buildkit: d.api_req_buildkit,
            req_remodelkit: d.api_req_remodelkit,
            req_slot_id: d.api_req_slot_id,
            req_slot_num: d.api_req_slot_num,
        }).collect();
        let data = RemodelSlotList {
            secretary_ship_master_id: secretary,
            weekday_jst: weekday,
            entries,
        };
        Some(vec![EmitData::Set(Set::RemodelSlotList(data))])
    }
}

// --- remodel_slotlist_detail ---

impl TraitForConvert for remodel_slotlist_detail::Req {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        *PENDING_DETAIL_REQ.lock().unwrap() = Some((self.api_slot_id, self.api_id));
        Some(vec![])
    }
}

impl TraitForConvert for remodel_slotlist_detail::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let ctx = PENDING_DETAIL_REQ.lock().unwrap().take();
        let (master_id, step_id) = match ctx {
            Some(v) => v,
            None => {
                tracing::warn!(
                    "remodel_slotlist_detail: Req context not found (spawn race); skip"
                );
                return Some(vec![]);
            }
        };
        // 秘書艦・曜日は slotlist 側で保持。通常改修コストも slotlist と重複するため省略。
        let d = &self.api_data;
        let detail = RemodelDetail {
            slotitem_master_id: master_id,
            remodel_id: step_id,
            certain_buildkit: d.api_certain_buildkit,
            certain_remodelkit: d.api_certain_remodelkit,
            change_flag: d.api_change_flag,
            req_useitem_id: d.api_req_useitem_id,
            req_useitem_id2: d.api_req_useitem_id2,
            req_useitem_num: d.api_req_useitem_num,
            req_useitem_num2: d.api_req_useitem_num2,
        };
        Some(vec![EmitData::Set(Set::RemodelDetail(detail))])
    }
}

// --- remodel_slot ---
// 収集しない。change_flag（detail 側）で転換改修の有無は判定可能。
// remodel_slot::{Req, Res} は register_trait! に残し、空の convert → Some(vec![]) を自動生成させる。
```

**要注意**: `register_trait!` マクロと個別 `impl TraitForConvert` が同じ型に重複すると
conflicting implementations でコンパイルエラーになる。`register_trait!` から
`remodel_slotlist::Res`, `remodel_slotlist_detail::{Req, Res}` の
3 型を確実に除外すること（`remodel_slot::{Req, Res}` は除外しない — 空の自動生成で OK）。

---

## 8. kc-api-database モデル

**ファイル**: `kc_api/crates/kc-api-database/src/models/remodel.rs`（新規作成）

```rust
use serde::{Deserialize, Serialize};

// --- slotlist 一覧（バルクアップロード） ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelSlotListEntryUpload {
    pub remodel_id: i64,
    pub slotitem_master_id: i64,
    pub sp_type: i64,
    pub req_fuel: i64,
    pub req_bull: i64,
    pub req_steel: i64,
    pub req_bauxite: i64,
    pub req_buildkit: i64,
    pub req_remodelkit: i64,
    pub req_slot_id: i64,
    pub req_slot_num: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelSlotListUpload {
    pub secretary_ship_master_id: i64,
    pub weekday_jst: i64,
    pub entries: Vec<RemodelSlotListEntryUpload>,
}

// --- detail（確実改修固有コスト + 特殊消費のみ） ---
// 通常改修コスト・秘書艦・曜日は slotlist 側で保持 — 重複排除。

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelDetailUpload {
    pub slotitem_master_id: i64,
    pub remodel_id: i64,
    pub certain_buildkit: i64,
    pub certain_remodelkit: i64,
    pub change_flag: i64,
    pub req_useitem_id: Option<i64>,
    pub req_useitem_id2: Option<i64>,
    pub req_useitem_num: Option<i64>,
    pub req_useitem_num2: Option<i64>,
}

// --- execution は収集しないため DB モデル不要 ---

// --- From trait ---

impl From<kc_api_interface::remodel::RemodelSlotList> for RemodelSlotListUpload {
    fn from(v: kc_api_interface::remodel::RemodelSlotList) -> Self {
        Self {
            secretary_ship_master_id: v.secretary_ship_master_id,
            weekday_jst: v.weekday_jst,
            entries: v.entries.into_iter().map(|e| RemodelSlotListEntryUpload {
                remodel_id: e.remodel_id,
                slotitem_master_id: e.slotitem_master_id,
                sp_type: e.sp_type,
                req_fuel: e.req_fuel,
                req_bull: e.req_bull,
                req_steel: e.req_steel,
                req_bauxite: e.req_bauxite,
                req_buildkit: e.req_buildkit,
                req_remodelkit: e.req_remodelkit,
                req_slot_id: e.req_slot_id,
                req_slot_num: e.req_slot_num,
            }).collect(),
        }
    }
}

impl From<kc_api_interface::remodel::RemodelDetail> for RemodelDetailUpload {
    fn from(v: kc_api_interface::remodel::RemodelDetail) -> Self {
        Self {
            slotitem_master_id: v.slotitem_master_id,
            remodel_id: v.remodel_id,
            certain_buildkit: v.certain_buildkit,
            certain_remodelkit: v.certain_remodelkit,
            change_flag: v.change_flag,
            req_useitem_id: v.req_useitem_id,
            req_useitem_id2: v.req_useitem_id2,
            req_useitem_num: v.req_useitem_num,
            req_useitem_num2: v.req_useitem_num2,
        }
    }
}
```

**`kc_api/crates/kc-api-database/src/models/mod.rs` に追加**:
```rust
pub mod remodel;
```

---

## 9. FUSOU-APP remodel_sender.rs

**ファイル**: `FUSOU-APP/src-tauri/src/remodel_sender.rs`（新規作成）

`quest_tree_sender.rs` をベースに、以下の差分で実装する。

### 9.1 構造

```rust
use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{
    LocalRequestSuppressionCache, PendingStore, UploadContext,
    UploadRequest, UploadRetryService, Uploader,
};
use kc_api::database::models::remodel::{
    RemodelSlotListUpload, RemodelDetailUpload,
};
use kc_api::interface::remodel::{RemodelSlotList, RemodelDetail};
use once_cell::sync::OnceCell;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::Notify;
use uuid::Uuid;

static REMODEL_SENDER: OnceCell<Arc<RemodelSender>> = OnceCell::new();

enum RemodelPacket {
    SlotList(RemodelSlotList),
    Detail(RemodelDetail),
}
```

### 9.2 RemodelSender フィールド

`quest_tree_sender.rs` の `QuestTreeSender` と同一:
- `ingest_endpoint: String`
- `auth_manager: Arc<AuthManager<FileStorage>>`
- `pending_store: Arc<PendingStore>`
- `retry_service: Arc<UploadRetryService>`
- `request_cache: Arc<LocalRequestSuppressionCache>` (TTL: 10分)
- `next_seq: AtomicU64`
- `next_to_send: AtomicU64`
- `send_notify: Notify`

### 9.3 payload_key / payload_hash

```rust
fn payload_key(packet: &RemodelPacket) -> String {
    match packet {
        RemodelPacket::SlotList(v) =>
            format!("slotlist:{}:{}", v.secretary_ship_master_id, v.weekday_jst),
        RemodelPacket::Detail(d) =>
            format!("detail:{}:{}", d.slotitem_master_id, d.remodel_id),
    }
}

fn event_type(packet: &RemodelPacket) -> &'static str {
    match packet {
        RemodelPacket::SlotList(_) => "slotlist",
        RemodelPacket::Detail(_) => "detail",
    }
}

fn payload_hash(packet: &RemodelPacket) -> String {
    // timestamp_ms はデータ型に含まれないためそのままシリアライズ可能
    let json = match packet {
        RemodelPacket::SlotList(v) => serde_json::to_string(v).unwrap_or_default(),
        RemodelPacket::Detail(d) => serde_json::to_string(d).unwrap_or_default(),
    };
    let digest = Sha256::digest(json.as_bytes());
    hex::encode(digest)
}
```

**payload_key 設計意図**:
- `slotlist`: 同じ秘書艦 × 同じ曜日であれば同一一覧（改修可能なレシピはメンテまで変わらない）
- `detail`: 同じ装備 × 同じステップであれば同一コスト（秘書艦・曜日に依存しない）

### 9.4 suppression cache

quest_tree_sender と同じパターン:
```rust
self.request_cache.rotate_scope(Some(&format!(
    "{}:{}",
    period_tag,
    kc_api::database::DATABASE_TABLE_VERSION
)));
```

### 9.5 公開 API

```rust
pub fn start(
    ingest_endpoint: String,
    auth_manager: Arc<AuthManager<FileStorage>>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    cache_root_dir: PathBuf,
) { /* OnceCell::set */ }

pub fn enqueue_slotlist(data: RemodelSlotList) { /* allocate_seq → spawn submit */ }
pub fn enqueue_detail(data: RemodelDetail) { /* allocate_seq → spawn submit */ }
```

### 9.6 送信 JSON ペイロード

```json
{
  "dataset_id": "<member_id_hash>",
  "request_id": "remodel:<dataset_id>:<event_type>:<uuid>",
  "payload_hash": "<sha256_hex>",
  "event_type": "slotlist" | "detail",
  "timestamp_ms": 1234567890123,
  "period_tag": "<YYYY-MM>",   // WEB 側 /^\\d{4}-\\d{2}$/ で検証
  "table_version": "<DATABASE_TABLE_VERSION>",

  // event_type = "slotlist" の場合:
  "secretary_ship_master_id": 131,
  "weekday_jst": 3,
  "entries": [
    {
      "remodel_id": 1, "slotitem_master_id": 123,
      "sp_type": 0,
      "req_fuel": 10, "req_bull": 30, "req_steel": 60, "req_bauxite": 0,
      "req_buildkit": 2, "req_remodelkit": 1,
      "req_slot_id": 0, "req_slot_num": 0
    }
  ],

  // event_type = "detail" の場合:
  "slotitem_master_id": 123,
  "remodel_id": 1,
  "certain_buildkit": 4,
  "certain_remodelkit": 2,
  "change_flag": 0,
  "req_useitem_id": null,
  "req_useitem_id2": null,
  "req_useitem_num": null,
  "req_useitem_num2": null
}
```

---

## 10. json_parser.rs の更新

**ファイル**: `FUSOU-APP/src-tauri/src/json_parser.rs`

```rust
// Set の match ブロック内、ShipGrowthSnapshot の直後に追加:
Set::RemodelSlotList(data) => {
    crate::remodel_sender::enqueue_slotlist(data);
}
Set::RemodelDetail(data) => {
    crate::remodel_sender::enqueue_detail(data);
}
```

---

## 11. lib.rs の更新

**ファイル**: `FUSOU-APP/src-tauri/src/lib.rs`

```rust
mod remodel_sender;

// setup() 内、ship_growth_sender 初期化ブロックの直後に追加:
if app_configs.remodel_sender.get_enable() {
    let ingest_endpoint = app_configs
        .remodel_sender
        .get_ingest_endpoint()
        .expect("remodel_sender.enable=true but ingest_endpoint is empty");
    let auth_manager_for_remodel = Arc::new(auth_manager.clone());
    let remodel_cache_root = roaming_dir
        .join("cache")
        .join("request_suppression")
        .join("remodel_sender");
    remodel_sender::start(
        ingest_endpoint,
        auth_manager_for_remodel,
        pending_store.clone(),
        retry_service.clone(),
        remodel_cache_root,
    );
}
```

---

## 12. Config 設定

**全 3 ファイルに追加**（1 ファイルでも欠けるとデシリアライズ失敗の可能性あり）:

- `packages/configs/configs.toml`
- `packages/FUSOU-APP/src-tauri/resources/user/configs.toml`
- `packages/FUSOU-APP/src-tauri/roaming/user/configs.toml`

```toml
[app.remodel_sender]
enable = false
ingest_endpoint = "https://fusou.dev/api/remodel-data/ingest"
```

**`configs/src/configs.rs` に追加**:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppRemodelSender {
    enable: Option<bool>,
    ingest_endpoint: Option<String>,
}

impl ConfigsAppRemodelSender {
    pub fn get_enable(&self) -> bool {
        self.enable.unwrap_or_else(|| {
            get_default_configs().app.remodel_sender.enable.unwrap()
        })
    }
    pub fn get_ingest_endpoint(&self) -> Option<String> {
        match self.ingest_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }
}

// ConfigsApp 構造体に追加:
pub remodel_sender: ConfigsAppRemodelSender,
```

---

## 13. Cloudflare D1 データベース作成

```sh
cd packages/FUSOU-WEB
npx wrangler d1 create dev-kc-remodel-index --location apac
# → 出力される database_id をメモ
```

**既存 DB を絶対に指定しないこと**（battle-index, quest-index, ship-growth 等）。

---

## 14. Migration SQL

**ファイル**: `packages/FUSOU-WEB/migrations/remodel-index/0001_add_remodel_data_tables.sql`（新規作成）

冪等制御は APP 側 suppression cache のみ（ship_growth と同方式）。
WEB 側に ingest_events テーブルは設けない。各テーブルは PRIMARY KEY / UNIQUE で自然な重複排除を行う。

```sql
-- 改修条件一覧（remodel_slotlist から — 秘書艦×曜日→利用可能レシピ）
-- 改修ツリーの backbone。通常改修コストの正本。
CREATE TABLE IF NOT EXISTS remodel_slotlist_entries (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id                  TEXT    NOT NULL,
    period_tag                  TEXT    NOT NULL,
    table_version               TEXT    NOT NULL,
    secretary_ship_master_id    INTEGER NOT NULL,
    weekday_jst                 INTEGER NOT NULL,  -- 0=月, 6=日
    remodel_id                  INTEGER NOT NULL,
    slotitem_master_id          INTEGER NOT NULL,
    sp_type                     INTEGER NOT NULL DEFAULT 0,
    req_fuel                    INTEGER NOT NULL DEFAULT 0,
    req_bull                    INTEGER NOT NULL DEFAULT 0,
    req_steel                   INTEGER NOT NULL DEFAULT 0,
    req_bauxite                 INTEGER NOT NULL DEFAULT 0,
    req_buildkit                INTEGER NOT NULL DEFAULT 0,
    req_remodelkit              INTEGER NOT NULL DEFAULT 0,
    req_slot_id                 INTEGER NOT NULL DEFAULT 0,
    req_slot_num                INTEGER NOT NULL DEFAULT 0,
    UNIQUE(dataset_id, secretary_ship_master_id, weekday_jst, slotitem_master_id, remodel_id)
);
CREATE INDEX IF NOT EXISTS idx_rslot_secretary_weekday
    ON remodel_slotlist_entries(secretary_ship_master_id, weekday_jst, slotitem_master_id, remodel_id);
CREATE INDEX IF NOT EXISTS idx_rslot_item_step
    ON remodel_slotlist_entries(slotitem_master_id, remodel_id);

-- 改修詳細コスト（remodel_slotlist_detail から）
-- 確実改修固有コスト + 特殊消費アイテムのみ。
-- 通常改修コスト（req_buildkit/remodelkit, req_slot_id/num）は slotlist_entries と同値のため省略。
-- secretary_ship_master_id, weekday_jst もコストに影響しないため slotlist 側のみで保持。
CREATE TABLE IF NOT EXISTS remodel_detail_entries (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id                  TEXT    NOT NULL,
    period_tag                  TEXT    NOT NULL,
    table_version               TEXT    NOT NULL,
    slotitem_master_id          INTEGER NOT NULL,
    remodel_id                  INTEGER NOT NULL,
    certain_buildkit            INTEGER NOT NULL,
    certain_remodelkit          INTEGER NOT NULL,
    change_flag                 INTEGER NOT NULL DEFAULT 0,
    req_useitem_id              INTEGER,
    req_useitem_id2             INTEGER,
    req_useitem_num             INTEGER,
    req_useitem_num2            INTEGER,
    UNIQUE(dataset_id, slotitem_master_id, remodel_id)
);
CREATE INDEX IF NOT EXISTS idx_rdetail_item_step
    ON remodel_detail_entries(slotitem_master_id, remodel_id);
```

### 14.1 テーブル構成サマリ

| テーブル | カラム数 (id除く) | 主要参照キー | 目的 |
|---|---|---|---|
| `remodel_slotlist_entries` | 16 | `secretary_ship_master_id`, `weekday_jst`, `slotitem_master_id`, `remodel_id` | 秘書艦×曜日→改修レシピ条件 + 通常改修コスト |
| `remodel_detail_entries` | 12 | `slotitem_master_id`, `remodel_id` | 確実改修コスト + 特殊アイテム（slotlist と正規化済み） |

**正規化方針**: ingest_events を持たないため、`dataset_id`, `period_tag`, `table_version` は各テーブルに直接保持する。
UNIQUE 制約で同一 dataset × 同一キーの重複 INSERT を防ぐ（`INSERT OR REPLACE` で最新値に上書き）。

### 14.2 INSERT プレースホルダ数チェックリスト

| テーブル | カラム数 (id 除く) | `?` 数 | `.bind()` 引数数 |
|---|---|---|---|
| `remodel_slotlist_entries` | 16 | 16 | 16 |
| `remodel_detail_entries` | 12 | 12 | 12 |

**マイグレーション適用**:
```sh
cd packages/FUSOU-WEB
npx wrangler d1 execute dev-kc-remodel-index --remote \
    --file migrations/remodel-index/0001_add_remodel_data_tables.sql
```

---

## 15. wrangler.toml への D1 バインディング追加

**ファイル**: `packages/FUSOU-WEB/wrangler.toml`

```toml
[[d1_databases]]
binding = "REMODEL_INDEX_DB"
database_name = "dev-kc-remodel-index"
database_id = "<§13で取得したUUID>"
migrations_dir = "migrations/remodel-index"
```

---

## 16. WEB types.ts / utils.ts の更新

**`packages/FUSOU-WEB/src/server/types.ts`** — `Bindings` 型に追加:
```ts
REMODEL_INDEX_DB: D1Database;
REMODEL_DATA_SIGNING_SECRET?: string;
```

**`packages/FUSOU-WEB/src/server/utils.ts`** — `injectEnv()` 内に追加:
```ts
REMODEL_INDEX_DB: ctx.runtime.REMODEL_INDEX_DB!,
REMODEL_DATA_SIGNING_SECRET: getEnv(ctx, "REMODEL_DATA_SIGNING_SECRET"),
```

---

## 17. FUSOU-WEB route の実装

**ファイル**: `packages/FUSOU-WEB/src/server/routes/remodel_data.ts`（新規作成）

`quest_tree.ts` の 2-stage handshake パターンを踏襲する。
冪等制御は APP 側 suppression cache のみ（ship_growth と同方式）。WEB 側に ingest_events テーブルは不要。

### 17.1 構造

```ts
import { Hono } from 'hono';
import type { AppContext } from '../types';
import {
    createEnvContext, getEnv, parseStrictBoolean,
    generateSignedToken, verifySignedToken, validateTokenPayload,
    sha256Hex, validateJWT,
} from '../utils';

const REMODEL_COLLECTION_SWITCH_ENV = 'REMODEL_DATA_COLLECTION_ENABLED';
const VALID_EVENT_TYPES = new Set(['slotlist', 'detail']);

const app = new Hono<AppContext>();

app.post('/ingest', async (c) => {
    // kill switch — 既存ルートと同じ strict boolean パース
    const env = createEnvContext(c);
    let collectionEnabled = false;
    try {
        collectionEnabled = parseStrictBoolean(
            getEnv(env, REMODEL_COLLECTION_SWITCH_ENV),
            REMODEL_COLLECTION_SWITCH_ENV,
        );
    } catch (err) {
        return c.json({
            error: err instanceof Error
                ? err.message
                : `${REMODEL_COLLECTION_SWITCH_ENV} is invalid`,
        }, 500);
    }
    if (!collectionEnabled) {
        return c.json({ error: 'remodel data collection is disabled' }, 503);
    }

    const signingSecret = getEnv(env, 'REMODEL_DATA_SIGNING_SECRET');
    if (!signingSecret) {
        return c.json({ error: 'REMODEL_DATA_SIGNING_SECRET is required' }, 500);
    }

    const db = c.env.REMODEL_INDEX_DB;
    if (!db) {
        return c.json({ error: 'REMODEL_INDEX_DB not configured' }, 500);
    }

    // 2-stage handshake: quest_tree.ts と同一パターン
    // Stage 1: X-Upload-Token なし → { uploadUrl, token, expiresAt } を返す
    // Stage 2: X-Upload-Token あり → body を検証して ingest 実行
    // ...
});

export default app;
```

### 17.2 バリデーション（必須パラメータ — silent default 禁止）

既存ルート（quest_tree, ship_growth）と同じ discriminated union 返却型を使用する。

```ts
type ValidResult = {
    ok: true;
    datasetId: string;
    requestId: string;
    payloadHash: string;
    eventType: 'slotlist' | 'detail';
    periodTag: string;
    tableVersion: string;
    timestampMs: number;
};
type InvalidResult = { ok: false; error: string };

function isValidInt(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

function validateIngestBody(body: any): ValidResult | InvalidResult {
    if (!body || typeof body !== 'object') {
        return { ok: false, error: 'Invalid JSON body' };
    }

    const datasetId = String(body.dataset_id ?? '').trim();
    if (!datasetId) return { ok: false, error: 'dataset_id is required' };

    const requestId = String(body.request_id ?? '').trim();
    if (!requestId) return { ok: false, error: 'request_id is required' };

    const payloadHash = String(body.payload_hash ?? '').trim();
    if (!/^[a-f0-9]{64}$/i.test(payloadHash)) {
        return { ok: false, error: 'payload_hash must be a valid 64-char SHA-256 hex string' };
    }

    const eventType = String(body.event_type ?? '').trim();
    if (!VALID_EVENT_TYPES.has(eventType)) {
        return { ok: false, error: `event_type must be one of: ${[...VALID_EVENT_TYPES].join(', ')}` };
    }

    const periodTag = String(body.period_tag ?? '').trim();
    if (!/^\d{4}-\d{2}$/.test(periodTag)) {
        return { ok: false, error: 'period_tag must match YYYY-MM format' };
    }

    const tableVersion = String(body.table_version ?? '').trim();
    if (!tableVersion) return { ok: false, error: 'table_version is required' };

    const timestampMs = Number(body.timestamp_ms);
    if (!isValidInt(timestampMs) || timestampMs <= 0) {
        return { ok: false, error: 'timestamp_ms must be a positive integer' };
    }

    // --- event_type 別フィールド検証 ---
    if (eventType === 'slotlist') {
        if (!isValidInt(body.secretary_ship_master_id) || body.secretary_ship_master_id <= 0) {
            return { ok: false, error: 'secretary_ship_master_id must be a positive integer' };
        }
        if (!isValidInt(body.weekday_jst) || body.weekday_jst < 0 || body.weekday_jst > 6) {
            return { ok: false, error: 'weekday_jst must be 0-6' };
        }
        if (!Array.isArray(body.entries) || body.entries.length === 0) {
            return { ok: false, error: 'entries array is required and must not be empty' };
        }
        const intFields = [
            'remodel_id', 'slotitem_master_id', 'sp_type',
            'req_fuel', 'req_bull', 'req_steel', 'req_bauxite',
            'req_buildkit', 'req_remodelkit', 'req_slot_id', 'req_slot_num',
        ];
        for (const [i, entry] of body.entries.entries()) {
            for (const f of intFields) {
                if (!isValidInt(entry[f])) {
                    return { ok: false, error: `entries[${i}].${f} must be an integer` };
                }
            }
        }
    }
    if (eventType === 'detail') {
        if (!isValidInt(body.slotitem_master_id) || body.slotitem_master_id <= 0) {
            return { ok: false, error: 'slotitem_master_id must be a positive integer' };
        }
        if (!isValidInt(body.remodel_id)) {
            return { ok: false, error: 'remodel_id must be an integer' };
        }
        if (!isValidInt(body.certain_buildkit) || !isValidInt(body.certain_remodelkit)) {
            return { ok: false, error: 'certain_buildkit and certain_remodelkit must be integers' };
        }
        if (!isValidInt(body.change_flag)) {
            return { ok: false, error: 'change_flag must be an integer' };
        }
        // req_useitem_* は null 許容
        for (const f of ['req_useitem_id', 'req_useitem_id2', 'req_useitem_num', 'req_useitem_num2']) {
            if (body[f] != null && !isValidInt(body[f])) {
                return { ok: false, error: `${f} must be an integer or null` };
            }
        }
    }

    return {
        ok: true,
        datasetId,
        requestId,
        payloadHash,
        eventType: eventType as 'slotlist' | 'detail',
        periodTag,
        tableVersion,
        timestampMs,
    };
}
```

### 17.3 冪等制御

APP 側 suppression cache（content-hash ベース、10 分 TTL）のみ。
WEB 側には冪等判定テーブルを持たない。

万一の重複リクエストは UNIQUE 制約（`INSERT OR REPLACE`）で最新値に上書きされるため、
データの整合性は保たれる。

### 17.4 子テーブル INSERT

**event_type = 'slotlist'**:

slotlist は複数エントリ（秘書艦 × 曜日で利用可能な改修レシピ一覧）を持つため、
トランザクションで囲んでアトミックに INSERT する（ship_growth と同パターン）。

```ts
await db.prepare('BEGIN IMMEDIATE').run();
try {
    for (const entry of body.entries) {
        await db.prepare(`
            INSERT OR REPLACE INTO remodel_slotlist_entries (
                dataset_id, period_tag, table_version,
                secretary_ship_master_id, weekday_jst,
                remodel_id, slotitem_master_id, sp_type,
                req_fuel, req_bull, req_steel, req_bauxite,
                req_buildkit, req_remodelkit,
                req_slot_id, req_slot_num
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            body.dataset_id, body.period_tag, body.table_version,
            body.secretary_ship_master_id, body.weekday_jst,
            entry.remodel_id, entry.slotitem_master_id, entry.sp_type,
            entry.req_fuel, entry.req_bull, entry.req_steel, entry.req_bauxite,
            entry.req_buildkit, entry.req_remodelkit,
            entry.req_slot_id, entry.req_slot_num,
        ).run();
    }
    await db.prepare('COMMIT').run();
} catch (error) {
    await db.prepare('ROLLBACK').run().catch(() => null);
    throw error;
}
// 16 columns, 16 placeholders ✓
```

**event_type = 'detail'**:
```ts
await db.prepare(`
    INSERT OR REPLACE INTO remodel_detail_entries (
        dataset_id, period_tag, table_version,
        slotitem_master_id, remodel_id,
        certain_buildkit, certain_remodelkit,
        change_flag,
        req_useitem_id, req_useitem_id2, req_useitem_num, req_useitem_num2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
    body.dataset_id, body.period_tag, body.table_version,
    body.slotitem_master_id, body.remodel_id,
    body.certain_buildkit, body.certain_remodelkit,
    body.change_flag,
    body.req_useitem_id ?? null, body.req_useitem_id2 ?? null,
    body.req_useitem_num ?? null, body.req_useitem_num2 ?? null,
).run();
// 12 columns, 12 placeholders ✓
```

### 17.5 app.ts マウント

**`packages/FUSOU-WEB/src/server/app.ts`** に追加:
```ts
import remodelDataApp from './routes/remodel_data';
// ...
app.route('/remodel-data', remodelDataApp);
```

---

## 18. Cloudflare Secrets の設定

```sh
cd packages/FUSOU-WEB

# signing secret（ハンドシェイクトークン署名用）
npx wrangler secret put REMODEL_DATA_SIGNING_SECRET
# → openssl rand -hex 32 などで生成した値を入力

# kill switch
npx wrangler secret put REMODEL_DATA_COLLECTION_ENABLED
# → "true" と入力
```

---

## 19. デプロイ

```sh
cd packages/FUSOU-WEB
npx wrangler deploy
```

---

## § 切り離し手順

本機能を無効化するには:

**即時無効化（データ収集停止）**:
1. `configs.toml` 等で `enable = false` にする（APP 側送信停止）
2. Cloudflare secret `REMODEL_DATA_COLLECTION_ENABLED` を `"false"` にする（WEB 側受信停止）

**完全除去（コード削除）**:
1. `remodel_sender.rs` 削除
2. `kc-api-interface/src/remodel.rs` 削除、`lib.rs` から `pub mod remodel` 削除
3. `kc-api-database/src/models/remodel.rs` 削除、`mod.rs` から `pub mod remodel` 削除
4. `interface.rs` から `RemodelSlotList`, `RemodelDetail` variant 削除
5. `api_req_kousyou.rs` の個別 `impl TraitForConvert`（`remodel_slotlist::Res`, `remodel_slotlist_detail::{Req, Res}` の 3 つ）を削除し、`register_trait!` に型を戻す
6. `json_parser.rs` から `RemodelSlotList`, `RemodelDetail` の match arm 削除
7. `lib.rs` から `mod remodel_sender` と初期化ブロック削除
8. `configs.toml` 等から `[app.remodel_sender]` セクション削除、`configs.rs` から型削除
9. `remodel_data.ts` 削除、`app.ts` からルート削除
10. `types.ts`, `utils.ts` から `REMODEL_INDEX_DB`, `REMODEL_DATA_SIGNING_SECRET` 削除
11. `wrangler.toml` から `REMODEL_INDEX_DB` バインディング削除

---

## § 実装落とし穴インデックス

quest-tree, ship-growth で発生した問題と本機能での対策:

| # | 問題 | 対策 |
|---|------|------|
| 1 | 既存 D1 DB に誤って migration 適用 | §13: 専用 DB を `d1 create` で新規作成。既存 DB 名を絶対に指定しない |
| 2 | `VALUES (?)` のプレースホルダ数不一致 → 500 | §14.2: カラム数を事前にカウント。slotlist=16, detail=12 |
| 3 | `resources/user/configs.toml` にセクション欠落 | §12: 3 ファイル全てに `[app.remodel_sender]` を追加 |
| 4 | `types.ts`/`utils.ts` への D1 バインディング追加忘れ | §16: `REMODEL_INDEX_DB` + `REMODEL_DATA_SIGNING_SECRET` の両方を追加 |
| 5 | `register_trait!` と個別 `impl` が同じ型で衝突 → compile error | §7: `register_trait!` から `remodel_slotlist::Res`, `remodel_slotlist_detail::{Req, Res}` の 3 型を除外（`remodel_slotlist::Req`, `remodel_slot::{Req, Res}` は除外不要 — `register_trait!` に残す） |
| 6 | `json_parser.rs` の `tokio::spawn` で Req/Res 順序が壊れる | §4: `Mutex<Option<T>>` + race 時は skip。json_parser.rs は変更しない |
| 7 | Req context 欠落時に 0 埋めで壊れたデータ保存 | §4, §7: `None` のとき `tracing::warn!` + `return Some(vec![])` |
| 8 | suppression key に timestamp を含めて毎回ユニーク化 | §9.3: `timestamp_ms` はデータ型に含めない。ハッシュはデータ型の直接シリアライズ |
| 9 | period_tag/table_version に silent default | §17.2: 必須パラメータとして 400 を返す。`period_tag` は `/^\d{4}-\d{2}$/` で検証、`timestamp_ms` は正の整数を強制 |
| 10 | 子テーブルに dataset_id/period_tag 等を重複保持 | §14: ingest_events を持たないため `dataset_id`, `period_tag`, `table_version` は各テーブルに直接保持。UNIQUE 制約で重複排除 |
| 11 | 秘書艦・曜日の取得タイミングが不適切で None が多発 | §3: 母港 API は改修画面アクセス前に必ずロード済み。`DeckPorts::load()` + `Ships::load()` は安全に呼べる |
| 12 | `remodel_slotlist` を収集せず改修ツリーの条件マッピングが欠落 | §0, §2.1: slotlist は改修ツリーの backbone — 秘書艦×曜日→レシピ一覧。2 API を収集 |
| 13 | detail に通常改修コスト（req_buildkit 等）を重複保持 | §5.1, §14: slotlist 側のみ保持。detail は確実改修コスト + 特殊アイテムに限定 |
| 14 | `Ship.ship_id` が `Option<i64>` なのに `Some()` で二重ラップ | §3, §7: `ship.ship_id` を直接返す（`Some(ship.ship_id)` ではなく） |
| 15 | kill switch の直接文字列比較 `!== 'true'` が不正値をサイレントに拒否 | §17.1: `createEnvContext` + `parseStrictBoolean` で厳密パース（既存ルートと統一） |
| 16 | `enable=true` なのに `ingest_endpoint` 未設定 → サイレントスキップ | §11: `expect()` で起動時パニック。設定ミスを即座に検出 |
| 17 | slotlist 複数エントリの INSERT が非アトミック | §17.4: `BEGIN IMMEDIATE` / `COMMIT` トランザクションで囲む |
| 18 | event_type 別フィールドの型未検証 → D1 エラーや null 混入 | §17.2: `isValidInt()` で slotlist entries 全フィールド / detail 必須フィールドを検証 |