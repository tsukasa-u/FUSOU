# DATABASE_TABLE_VERSION vs SCHEMA_VERSION: 分析結果サマリー

**日付:** 2025年12月25日  
**分析者:** GitHub Copilot  
**タイプ:** 深掘り分析＋複数案提示

---

## 🎯 ユーザーの指摘（重要）

> 「DATABASE_TABLE_VERSIONとv1，v2バージョンは用途が同じのはずです」

✅ **その通りです。** 両者の本質は「スキーマバージョン管理」で同じです。

---

## 📊 現状分析

### DATABASE_TABLE_VERSION（0.4）
- **定義:** ファイル：`/packages/kc_api/DATABASE_TABLE_VERSION`
- **用途:** KanColle ゲームデータ構造バージョン
- **管理:** ファイル直接編集（ゲーム更新に応じて）
- **保存:** D1 `env_info.version`、Avro スキーマに埋め込み
- **体系:** セマンティック版 (0.4, 0.5, 0.6...)

### SCHEMA_VERSION（v1）
- **定義:** Rust code：`schema_version.rs`
- **用途:** Avro OCF アーカイブ形式バージョン
- **管理:** Cargo feature flag (`schema_v1`, `schema_v2`)
- **保存:** D1 `buffer_logs.schema_version`、R2 メタデータ
- **体系:** Codename (v0, v1, v2...)

### 問題認識

| 項目 | 状況 |
|------|------|
| **バージョン管理の目的** | **同じ**（スキーマ互換性） |
| **実装方法** | **異なる**（ファイル vs feature）|
| **バージョン体系** | **異なる**（0.4 vs v1）|
| **保存位置** | **異なる**（env_info vs buffer_logs）|
| **管理主体** | **異なる**（ゲーム vs 運用）|

→ **本質は同じだが、実装が分散している**

---

## 💡 6つの実装案

### 優先度ランキング

```
1位⭐⭐⭐⭐⭐: 案 B-1「階層化」      【推奨】
2位⭐⭐⭐⭐  : 案 B-2「互換性マッピング」
3位⭐⭐⭐    : 案 A-2「v1統一」
4位⭐⭐      : 案 A-1「v0統一」
5位⭐⭐      : 案 C-2「改名」
6位⭐        : 案 C-1「現状維持」
```

---

### 案 A-1: v0形式統一

```
概要: DATABASE_TABLE_VERSION（0.4）をシングルソースに
削除: SCHEMA_VERSION を廃止
結果: 0.4, 0.5, 0.6... で統一
```

**メリット:** シンプル、自動同期  
**デメリット:** Avro形式変更に対応不可、既存コード大量修正

---

### 案 A-2: v1形式統一

```
概要: SCHEMA_VERSION（v0/v1/v2）をシングルソースに
削除: DATABASE_TABLE_VERSION を v-system に統一
結果: v0, v1, v2... で統一
```

**メリット:** Feature flag で版管理、コンパイル時チェック  
**デメリット:** "0.4"→"v0" 移行が大きい、ゲーム版と Avro 版が一体化

---

### 案 B-1: 階層化（⭐推奨）

```
概要: 両者を独立させて D1 に並記
DATABASE_TABLE_VERSION: 0.4, 0.5... （ゲーム構造版）
SCHEMA_VERSION: v1, v2... （Avro 形式版）
→ D1 に両方記録
```

**メリット:**
- ✅ 最小限の修正
- ✅ 後方互換性が最高
- ✅ 将来の柔軟性が最高
- ✅ ゲーム更新と Avro 形式を独立管理

**デメリット:**
- ⚠️  2つのバージョンを追跡
- ⚠️  D1 スキーマに新フィールド必要

**実装例:**
```typescript
// D1 buffer_logs
{
    schema_version: "v1",           // Avro形式版
    database_table_version: "0.4",  // ゲーム構造版
    ...
}
```

---

### 案 B-2: 互換性マッピング

```
概要: B-1 + 互換性チェック機能
マトリックス: v1 は 0.4+ 対応、v2 は 0.5+ 対応、など
```

**メリット:** B-1 の機能 + バージョン検証  
**デメリット:** コスト が B-1 より高い

---

### 案 C-1: 現状維持

```
概要: コード変更なし、ドキュメント充実
現在のまま: DATABASE_TABLE_VERSION（0.4）+ SCHEMA_VERSION（v1）
追加: ドキュメントで関連付けを明記
```

**メリット:** コード変更ゼロ  
**デメリット:** 技術的負債が残る、将来の統一が困難

---

### 案 C-2: 改名

```
概要: SCHEMA_VERSION → DATA_FORMAT_VERSION に改名
DATABASE_TABLE_VERSION: そのまま
→ 名前で区別を明確化
```

**メリット:** 命名で区別が一発  
**デメリット:** リネーム工数が大（500+行）

---

## 🏆 最優先推奨: 案 B-1「階層化」

### なぜ B-1 か？

1. **互換性を重視** - 旧データも新データも一貫性あり
2. **段階的対応** - 今すぐ実装 → 1年後も対応可能
3. **複雑度が許容** - 2つのバージョンは管理可能な範囲
4. **コスト効率** - 修正量が最小限（D1 + TypeScript）
5. **技術負債なし** - 将来への不安がない

### B-1 の実装イメージ

```
今日: DATABASE_TABLE_VERSION=0.4, SCHEMA_VERSION=v1 で並行運用
      ↓ D1 に両方記録
      
1年後: ゲーム 0.5 に更新
      ├─ Avro 形式非互換 → SCHEMA_VERSION → v2 新規実装
      ├─ 旧 v1 データ → v1/{period}/{table}.avro に保存
      └─ 新 v2 データ → v2/{period}/{table}.avro に保存
           ↓
      読取時に schema_version で自動判別 ✅
```

### 実装ステップ（B-1）

#### Step 1: D1 スキーマ拡張（最小限）
```sql
ALTER TABLE buffer_logs 
ADD COLUMN database_table_version TEXT DEFAULT '0.4';
```

#### Step 2: TypeScript コード修正（1箇所）
```typescript
// FUSOU-WORKFLOW/src/buffer-consumer.ts
interface BufferLogRecord {
    schema_version: string;           // 既存
    database_table_version: string;   // ← 新規追加
    ...
}
```

#### Step 3: ドキュメント整備
```markdown
# Version Compatibility Matrix

| Schema | Game Version | Notes |
|--------|--------------|-------|
| v1     | 0.4+         | Current |
| v2     | 0.5+ (future)| TBD |
```

**合計工数: 1週間**

---

## 🔀 将来のシナリオ別対応

### シナリオ 1: ゲーム 0.5 更新（後方互換）

```
DATABASE_TABLE_VERSION: 0.4 → 0.5
SCHEMA_VERSION: v1（そのまま使用）
→ v1 が 0.5 に対応可能
→ 変更不要！
```

### シナリオ 2: ゲーム 0.5 更新（破棄的変更）

```
DATABASE_TABLE_VERSION: 0.4 → 0.5
SCHEMA_VERSION: v1 では対応不可
→ SCHEMA_VERSION v2 新規実装
→ feature 切り替え: schema_v1 → schema_v2
→ 新データから v2 で送信開始
```

### シナリオ 3: Avro 最適化（ゲーム無関係）

```
SCHEMA_VERSION: v1 → v2（形式改善）
DATABASE_TABLE_VERSION: 0.4（そのまま）
→ v2 は 0.4 ゲームデータに対応
→ ゲーム側の変更なし
```

**→ 全シナリオで B-1 が対応可能！**

---

## 📋 決定マトリックス

### コスト・効果・リスク

| 案 | 実装コスト | 柔軟性 | リスク | 総合 |
|----|----------|--------|--------|------|
| A-1 | 中 | 低 | 高 | ❌ |
| A-2 | 中 | 高 | 中 | ⭐⭐⭐ |
| **B-1** | **低** | **高** | **低** | **✅✅✅⭐** |
| B-2 | 低 | 高 | 低 | ⭐⭐⭐⭐ |
| C-1 | 0 | 低 | 高 | ⭐ |
| C-2 | 高 | 中 | 中 | ⭐⭐ |

---

## 🚀 実装ロードマップ（推奨）

### Phase 0: 現状把握（本日完了）
- ✅ DATABASE_TABLE_VERSION と SCHEMA_VERSION の関係を分析
- ✅ 6つの案を提示
- ✅ 推奨案を B-1 に決定

### Phase 1: ドキュメント整備（1日）
- [ ] VERSION_COMPATIBILITY.md 作成
- [ ] 既存ドキュメント更新
- [ ] チーム内での同意取得

### Phase 2: D1 スキーマ拡張（1-2日）
```sql
ALTER TABLE buffer_logs 
ADD COLUMN database_table_version TEXT DEFAULT '0.4';
```

### Phase 3: コード修正（2-3日）
- [ ] buffer-consumer.ts 修正
- [ ] cron.ts 修正（必要に応じて）
- [ ] テスト作成

### Phase 4: 本番デプロイ（1日）
- [ ] ステージング検証
- [ ] 本番反映
- [ ] モニタリング

**合計: 約1週間**

---

## ⚠️ 重要な注意点

### 互換性破棄的変更への対応

もし将来 SCHEMA_VERSION v2 が必要になった場合：

```rust
// schema_version.rs
#[cfg(feature = "schema_v1")]
pub const SCHEMA_VERSION: &str = "v1";

#[cfg(feature = "schema_v2")]
pub const SCHEMA_VERSION: &str = "v2";

#[cfg(not(any(feature = "schema_v1", feature = "schema_v2")))]
compile_error!("Must enable schema_v1 or schema_v2");
```

**コンパイル時に強制できるため、暗黙的な不一致が発生しません。**

---

## 📌 最終判断チェックリスト

- [ ] DATABASE_TABLE_VERSION と SCHEMA_VERSION が異なる目的だと思っていたが、実は同じ目的だと理解した
- [ ] 現在の "0.4" と "v1" の分散管理が問題であることを認識した
- [ ] B-1（階層化）が最適なバランスであることに同意する
- [ ] D1 スキーマ拡張（database_table_version カラム）を承認する
- [ ] 1週間以内に Phase 1-4 を実行することを決定する

---

## 📞 質問への回答

### Q1: 「バージョンが0.から始まっているのであればv0から始めるべき？」

**A:** 2つの選択肢があります：
1. **案 B-1（推奨）**: 0.4 のまま、v1 のまま並行管理
2. **案 A-2**: 0.4 を v0 に統一してから v1, v2... へ進化

→ **B-1 を推奨理由**: 既存データ 0.4 の互換性を保ちながら、新体系 v1 で Avro 管理

---

### Q2: 「既存のTABLE_VERSIONはどのように扱う？」

**A: B-1 の場合**
- **保持**: 0.4 のまま DATABASE_TABLE_VERSION ファイルを維持
- **記録**: D1 buffer_logs に database_table_version として記録
- **活用**: 将来の互換性検証に使用

---

### Q3: 「修正するべき？」

**A:**

| タイミング | 判断 |
|----------|------|
| **今すぐ** | C-1（現状維持）+ ドキュメント |
| **1-2週間内** | B-1 実装（推奨） |
| **1-2ヶ月後** | B-1 完全運用 + ドキュメント完成 |
| **ゲーム 0.5 確定時** | v2 対応判定 |

**→ 推奨: 今週 Phase 0-1 を完了、来週 Phase 2-3 実行**

---

## 🎓 技術的結論

### 本質的な問題
```
複雑性 = 2つの独立したバージョン体系が混在している
```

### 解決策
```
B-1 階層化 = 両者を D1 に並記することで、
「独立性を保ちながら相関関係を記録」
```

### 効果
```
✅ 現在: 0.4 + v1 で運用
✅ 将来: 0.5 + v1、または 0.5 + v2 で対応可能
✅ 旧データ: 0.4 + v1 のまま保存
✅ 互換性: 完全に担保
```

---

## 最後に

> 「ユーザーの指摘は正しい。DATABASE_TABLE_VERSION と SCHEMA_VERSION の目的は本質的に同じ（スキーマバージョン管理）である。」

その上で、**B-1 階層化**により、両者を独立させつつ相関関係を記録することで、**現在の問題を解決しながら将来への対応性も確保する**ことができます。

---

**推奨行動:**
- ✅ 本ドキュメントをチームで共有
- ✅ 案 B-1 の承認を得る
- ✅ Phase 1-2 を開始する

