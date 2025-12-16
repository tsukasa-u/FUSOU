# FUSOU-WEB リファクタリングログ

日付: 2025年12月13日

## 概要

FUSOU-WEB パッケージの包括的なコード品質改善を実施しました。以下の主要なカテゴリで改善を行いました：

- wasm-pack パス解決の修正
- 暗黙 any 型の削除
- 未使用変数の削除
- 型安全性の向上
- 管理用API (adminAPI) の削除

---

## 1. Wasm-Pack パス解決の修正

### 問題
`pnpm exec wasm-pack build` がルート実行時に「Cargo.toml が見つからない」というエラーを出していた。

### 原因
wasm-pack の `--manifest-path` フラグは実際には存在しない。wasm-pack は `PATH` 引数として明示的にクレートディレクトリを指定する必要がある。

### 解決策
`scripts/build_strict.sh` と `scripts/dev_strict.sh` を修正：

```bash
# 修正前（非動作）
pnpm exec wasm-pack build \
  --manifest-path "$WASM_CRATE_DIR/Cargo.toml" \
  --target bundler \
  --out-dir "$WASM_CRATE_DIR/pkg"

# 修正後（動作確認済）
pnpm exec wasm-pack build "$WASM_CRATE_DIR" \
  --target bundler \
  --out-dir pkg
```

### 影響ファイル
- `scripts/build_strict.sh`
- `scripts/dev_strict.sh`

### 検証
`pnpm build` 成功、wasm-pack が正常に実行される。

---

## 2. 暗黙 any 型の削除

### 問題
TypeScript 診断で「Parameter implicitly has an 'any' type」警告が複数箇所で発生。

### 解決内容

#### 2.1 構造体型の定義と型付与

**LeftMenu.astro**
- `MenuEntry` 型を定義
- map コールバックに型注釈を追加

**download.astro**
- `DownloadEntry`, `Architecture`, `Platform` 型を定義
- forEach/map パラメータに型を付与

**admin.ts**（削除予定対象だが当時修正）
- `R2ObjectLike` 構造体型を定義してR2オブジェクトを型安全に扱う

#### 2.2 セッション・ページデータ型の利用

**loadData.tsx**
- `SessionInfo` 型をインポート
- `SelectionFlag` 型を定義
- チェック用ストアのコールバックに型注釈

#### 2.3 DOM操作の型付け

**PeriodFilter.astro** → **未対応**
**download.astro**
- `HTMLElement`, `HTMLButtonElement` 型で forEach/map パラメータ整理

### 影響ファイル
- `src/components/docs/LeftMenu.astro`
- `src/pages/download.astro`
- `src/server/routes/admin.ts` (後に削除)
- `src/components/solid/loadData.tsx`
- `src/server/routes/assets.ts`
- `src/layouts/DocsLayout.astro`

### 検証
astro check で暗黙 any 警告 0（ts(7044) など削除）

---

## 3. 管理用API (adminAPI) の削除

### 問題・要件
管理用API が不要になったため、関連コードを全削除。

### 削除内容

#### 3.1 API ルート
- `src/server/routes/admin.ts` ファイル削除
- `/admin` ルートを `src/server/app.ts` から削除

#### 3.2 環境変数・型定義
- `ADMIN_API_SECRET` を `src/server/types.ts` (`Bindings`) から削除
- `src/server/utils.ts` の `injectEnv()` から `ADMIN_API_SECRET` 除去

### 影響ファイル
- `src/server/routes/admin.ts` (削除)
- `src/server/app.ts`
- `src/server/types.ts`
- `src/server/utils.ts`

### 検証
`pnpm build` 成功、ADMIN_API_SECRET 参照なし

---

## 4. 未使用変数の削除

### 問題
「declared but its value is never read」警告が 30+ 箇所で発生。

### 解決策

#### 4.1 未使用パラメータの削除・プリフィックス

| ファイル | 修正内容 |
|---------|---------|
| `functions/_scheduled.ts` | `(event, env, ctx)` → `()` 削除 |
| `src/components/PeriodFilter.astro` | `(e)` → `(_e)`, タプル要素整理 `([d, parsed])` → `([, parsed])` |
| `src/components/react/chart.tsx` | `randomName`, `randomEmail` 削除 |
| `src/components/react/vtable.jsx` | `(index, user)` → `(_index, user)` |
| `src/server/routes/assets.ts` | `(body, user)` → `(body, _user)` |
| `src/server/routes/fleet.ts` | `userId` → `_userId` (2箇所) |
| `src/server/routes/compact.ts` | 未使用 `env` 変数削除 |

#### 4.2 未使用インポート削除

| ファイル | 削除内容 |
|---------|---------|
| `src/components/solid/chartSample.tsx` | `onMount`, `createSignal`, `createEffect`, `Chart`, `Line`, `Scatter` |
| `src/components/solid/loadData.tsx` | `createUniqueId`, unused `provider_list` store, `providerInfo` 型定義 |
| `src/components/solid/sidePage.tsx` | `sidePageSlected` (最終的に) |
| `src/components/states/sidePageMap.ts` | `map` 関数削除 |
| `src/db/duckDB.tsx` | `ResourceOptions` 型削除 |
| `src/layouts/Layout.astro` | `rest` props 削除 |
| `src/pages/chartPage.astro` | `MyChart` コンポーネント削除, `pagedata` パラメータ削除 |
| `src/pages/auth/signin.astro` | `redirect` → `Astro.redirect()` に変更 |
| `src/server/routes/assets.ts` | `BucketBinding`, `D1Database`, `PrepareResult`, `ExecuteResult` |
| `src/server/utils/upload.ts` | `bucket` 変数削除 |

### 影響ファイル
30+ ファイル (上記参照)

### 検証
astro check で未使用警告 0

---

## 5. Astro スクリプト処理ヒントの解決

### 問題
属性付き `<script>` タグで「treated as is:inline」ヒントが表示。

### 解決策
`is:inline` 属性を明示的に追加：

```astro
<!-- 修正前 -->
<script type="module">...</script>
<script defer src="..."></script>

<!-- 修正後 -->
<script type="module" is:inline>...</script>
<script defer is:inline src="..."></script>
```

### 影響ファイル
- `src/components/PeriodFilter.astro` (2箇所)
- `src/layouts/DocsLayout.astro`
- `src/layouts/Layout.astro`

---

## 6. 非推奨 API の修正

### 問題
`document.execCommand("copy")` が非推奨。

### 解決策
`src/pages/auth/local/callback.astro` で try-catch でラップ：

```typescript
try {
  const ok = document.execCommand("copy");
  showStatus(ok ? "Copied" : "Copy failed");
} catch (e) {
  showStatus("Copy failed");
}
```

---

## ビルド結果

### 修正前
- エラー: 0
- 警告: 0
- ヒント: 43+
  - 暗黙 any (ts(7044)): 約10件
  - 未使用変数 (ts(6133)): 約30件
  - Astro `is:inline` ヒント (astro(4000)): 5件
  - 非推奨 API (ts(6387)): 1件

### 修正後
- エラー: 0
- 警告: 0
- ヒント: 1 (非推奨 API 警告のみ、抑止不可)
- CSS/チャンク警告: ビルドレベルのみ (daisyUI由来・Vite最適化)

---

## スクリプト改善

### build_strict.sh / dev_strict.sh
wasm-pack 呼び出しを修正し、クレートディレクトリから直接ビルド：

```bash
WASM_CRATE_DIR="${WASM_CRATE_DIR:-src/wasm/compactor}"

# ... checks ...

pnpm exec wasm-pack build "$WASM_CRATE_DIR" \
  --target bundler \
  --out-dir pkg
```

---

## 変更ファイル一覧

### 削除
- `src/server/routes/admin.ts`

### 修正 (主要)
1. `scripts/build_strict.sh`
2. `scripts/dev_strict.sh`
3. `src/server/app.ts`
4. `src/server/types.ts`
5. `src/server/utils.ts`
6. `src/components/docs/LeftMenu.astro`
7. `src/pages/download.astro`
8. `src/components/solid/chartSample.tsx`
9. `src/components/solid/loadData.tsx`
10. `src/components/solid/sidePage.tsx`
11. `src/components/PeriodFilter.astro`
12. `src/components/react/chart.tsx`
13. `src/components/react/vtable.jsx`
14. `src/layouts/DocsLayout.astro`
15. `src/layouts/Layout.astro`
16. `src/pages/chartPage.astro`
17. `src/pages/auth/signin.astro`
18. `src/pages/auth/local/callback.astro`
19. `src/server/routes/assets.ts`
20. `src/server/routes/compact.ts`
21. `src/server/routes/fleet.ts`
22. `src/server/utils/upload.ts`
23. `src/components/states/sidePageMap.ts`
24. `src/db/duckDB.tsx`
25. 他 5+ ファイル

---

## テスト・検証方法

```bash
# 厳格なビルド実行
pnpm build

# 開発サーバー起動（wasm-pack 実行）
pnpm dev

# 型チェックのみ
astro check
```

---

## 今後の課題

1. **Viteチャンクサイズ最適化**
   - `chart.BzY2_gTL.js` (605 kB) のコード分割化
   - `build.rollupOptions.output.manualChunks` 設定

2. **daisyUI CSS 警告**
   - `:not:only-child` → `:not(:only-child)`
   - `@property` サポート確認

3. **非推奨 API の完全廃止**
   - `document.execCommand` の Clipboard API 置き換え候補

---

## 参考資料

- [wasm-pack CLI ドキュメント](https://rustwasm.github.io/docs/wasm-pack/commands/build.html)
- [TypeScript 暗黙 any](https://www.typescriptlang.org/tsconfig#noImplicitAny)
- [Astro script 最適化](https://docs.astro.build/en/guides/client-side-scripts/)
- [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard)
