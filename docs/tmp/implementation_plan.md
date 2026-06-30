# シミュレータページ リファクタリング計画 (完全版)

## 概要

現在 `simulator-details-catalog.tsx` に装備詳細パネルと艦詳細パネルが混在している状態からスタートし、以下の目的を達成するための完全なリファクタリング計画です：

1. **装備詳細と艦詳細の分離** — 別ファイルへの分割。
2. **共通ロジック・UIコンポーネントの抽出** — 重複排除、再利用可能なコンポーネント化。
3. **DOM操作の完全な TSX 化** — `index.astro`、`fleets.astro`、および `src/features/simulator/` 配下のすべての `.ts` ファイルに散在する命令的なDOM操作 (`document.getElementById`, `document.createElement`, `innerHTML`, `style.display` 等) を完全に排除し、すべて SolidJS の TSX (宣言的 UI) へ移行。
4. **Astro の責務限定** — Astroコンポーネントはタブ配置・インポート・初期データの収集とコンポーネントのマウントのみに限定する。
5. **TS は純粋計算ロジックのみ** — `.ts` ファイルからDOMを扱う処理を完全に分離し、状態管理 (NanoStores) や計算ロジックのみを記述する。

---

## 実施フェーズ（Phase 1 ～ Phase 12）

### 【前半】詳細パネル分離と編成タブのTSX化

#### Phase 1: 共通モジュール抽出
- `ship-growth-utils.ts`: Ship-growth 関連の型・ユーティリティ関数を共通化。
- `synergy-utils.ts`: シナジー計算ロジックを抽出（DOMを扱わない純粋関数）。
- `display-utils.ts`: 表示関連のユーティリティ関数。

#### Phase 2: 共通UIコンポーネント抽出
- `shared-ui.tsx`: 両パネルおよび他の画面で共通利用される SolidJS UI コンポーネントを定義。

#### Phase 3: 装備詳細・艦詳細の分離
- `simulator-details-catalog.tsx` を `ship-detail-panel.tsx` と `equip-detail-panel.tsx` に分割。

#### Phase 4: `index.astro` の完全な TSX 化
- `SimulatorFleetTab.tsx` および `SimulatorTabManager.tsx` を作成し、SolidJS の状態管理を用いた宣言的 UI に移行。

#### Phase 5: `fleets.astro` の DOM 操作を TSX へ移行
- モーダル等の HTML 構造を `SimulatorModals.tsx` などに移管。

#### Phase 6: `simulator-renderer.tsx` の共通化適用
- `ship-growth-utils.ts` などの共通モジュールを `simulator-renderer.tsx` からも呼び出すように修正。

#### Phase 7: 第1段階ビルドチェック
- 前半の変更が `npx astro check` で通過することを確認。

---

### 【後半】モーダルおよびユーティリティ群のDOM操作排除

#### Phase 8: 装備・艦選択モーダルの TSX 化
- `ship-modal.ts` と `equip-modal.ts` のUI生成ロジック (`document.createElement` 等) を削除し、`ShipSelectionModal.tsx` および `EquipSelectionModal.tsx` を作成。

#### Phase 9: ユーティリティ内の DOM 生成の TSX 化
- `equip-calc.ts` にあった `createWeaponIconEl` 等を削除し、純粋な JSX `<WeaponIcon>` コンポーネントに置換。

#### Phase 10: 最終検証 (第1回実施完了・一部差し戻し)
- `io-handlers.ts` 等にDOM操作の残存が発覚したため、Phase 11および12を追加。

---

### 【追加・徹底】全TSファイルからのDOM操作排除

#### Phase 11: `src/features/simulator/*.ts` 内のDOM操作の特定と一掃 [x]
以下のファイルに存在するすべての `document.` 呼び出し（要素の取得・生成・イベント付与・スタイル変更）をTSXコンポーネントに移植し、`.ts` 側からは完全に削除する。※ただし、`image-capture.ts` 内での「画像化のためにDOMノードを文字列やcanvasに変換する処理」のみ例外として許容する。

- **`io-handlers.ts`**: (約1500行)
  - ワークスペースパネルやプレイグラウンドを描画している処理（`renderWorkspacePanel` 等）を `WorkspacePanel.tsx` (新規) などの SolidJS コンポーネントに移行する。
  - インポート・共有・ワークスペース登録などに使われている各種モーダルの DOM 操作を `SimulatorModals.tsx` 等へ移行する。
  - `initIOEvents` での直接的な `addEventListener` を、TSX 側からの `onClick` や状態変更（NanoStores経由）で呼び出す形に変更する。
- **`airbase-renderer.ts`**:
  - `initDisplaySettings` 内に残存している、表示設定モーダルの値の読み取り (`document.getElementById("display-fleet-1")`等) やイベントリスナー登録を完全に排除し、`SimulatorModals.tsx` 内の SolidJS ステートに紐付ける。
- **`data-loader.ts`**:
  - `updateStatusUI` で行われている `document.getElementById("data-status")` 等を通じたローディングUIの更新を、SolidJS の Reactive ステートに変更し、`DataStatusAlert.astro` (または `.tsx`) 側で宣言的に描画するよう改修する。
- **`virtual-scroll.ts`**:
  - 旧モーダルで使用していたDOM生成関数 (`createGroupHeader`, `renderCategoryNav`) が不要になっているため削除する。

#### Phase 12: 最終バグ調査およびビルドチェック [x]
- `npx astro check` を実行し、0 Error であること。
- `grep` 等を用いて `src/features/simulator/*.ts` (image-capture.ts除く) から `document.` が一切検出されないことを確認する。
- ブラウザ実機で各モーダル・パネルが崩れず動作することを確認する。

---

## Verification Plan (検証項目)

### 自動テスト
- `npx astro check` を実行し、0 Error であること。
- `image-capture.ts` 以外の `src/features/simulator/*.ts` に対して `grep "document\."` を実行し、結果が0件であること。

### ブラウザでの実機確認項目 (細分化版)
- [ ] シミュレータページ (`/simulator`) 全体がクラッシュせずレンダリングされること。
- [ ] **編成タブ** が正しく表示され、機能すること。
- [ ] **艦選択・装備選択モーダル** が開き、検索・ソート・選択が機能すること。
- [ ] **ワークスペース** のパネル（チップ一覧）が正しく描画され、追加・切り替え・削除などの状態変化が画面に反映されること。
- [ ] **表示設定機能** (`btn-display-settings`) を押すとモーダルが開き、表示設定を変更すると連動してUIが切り替わること。
- [ ] **インポート機能** のボタンを押すとモーダルが開き、APIレスポンスから編成を展開できること。
- [ ] **R2読込機能** のボタンを押すとモーダルが開き、一覧からロードできること。
- [ ] **編成共有機能** のボタンを押すとモーダルが開き、共有URLが正常に生成されること。
- [ ] 基地航空隊のレイアウト切り替えが動作すること。
- [ ] データのローディング時に、ステータスUI（`data-status`）が正しく表示・更新されること。
