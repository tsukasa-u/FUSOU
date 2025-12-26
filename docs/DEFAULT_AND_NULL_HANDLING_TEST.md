# DEFAULT 値処理の検証テスト
**Date:** 2025-12-26

## 問題: ALTER TABLE ADD COLUMN のデフォルト値処理

### シナリオ
運用中に以下の操作を実施：

```sql
-- 既存データ (例: 100行)
INSERT INTO archived_files (file_path, file_size, compression_codec) VALUES (...);

-- その後、マイグレーション実行
ALTER TABLE archived_files ADD COLUMN schema_version TEXT NOT NULL DEFAULT 'v1';
```

### 予想される動作 (SQLite)
✓ ALTER TABLE で既存の100行は自動的に schema_version='v1' で埋められる

### 検証テスト

```sql
-- ステップ1: 初期状態を確認
SELECT COUNT(*) as total FROM archived_files;
SELECT COUNT(*) as with_version FROM archived_files WHERE schema_version = 'v1';
SELECT COUNT(*) as nulls FROM archived_files WHERE schema_version IS NULL;

-- ステップ2: マイグレーション前の既存データをシミュレート
-- (本来は古いスキーマにあるので確認不可)

-- ステップ3: マイグレーション後の新規挿入
INSERT INTO archived_files (file_path, file_size) 
VALUES ('test-001.avro', 1024);
-- schema_version 指定なし → DEFAULT 'v1' が適用されるはず

SELECT * FROM archived_files WHERE file_path = 'test-001.avro';
-- Expected: schema_version = 'v1'

-- ステップ4: 明示的に指定した場合
INSERT INTO archived_files (file_path, file_size, schema_version) 
VALUES ('test-002.avro', 2048, 'v2');

SELECT * FROM archived_files WHERE file_path = 'test-002.avro';
-- Expected: schema_version = 'v2'
```

## 危険性: NULL 値の潜在化

### 考慮漏れ: column NOT NULL なのに NULL が入る可能性

```sql
-- ケース1: マイグレーションスクリプトのバグ
ALTER TABLE archived_files ADD COLUMN schema_version TEXT DEFAULT 'v1';
-- ↑ NOT NULL がない場合、NULL で埋まる可能性

-- ケース2: アプリケーションレベルでの挿入
-- 何らかの理由で NULL を明示的に挿入しようとしたら？
INSERT INTO archived_files (file_path, schema_version) VALUES ('test.avro', NULL);
-- → NOT NULL 制約でエラーになるはず（OK）

-- ケース3: trigger や外部プロセスの介入
-- D1 の管理画面から直接編集された場合？
```

### 実装: 安全なマイグレーション戦略

1. **マイグレーション スクリプトで DEFAULT を指定**
   ```sql
   ALTER TABLE archived_files ADD COLUMN schema_version TEXT NOT NULL DEFAULT 'v1';
   ```
   ✓ 既存行にも 'v1' が割り当てられる
   ✓ 新規行も 'v1' になる

2. **事後確認**
   ```sql
   SELECT COUNT(*) as null_count FROM archived_files WHERE schema_version IS NULL;
   -- NULL があれば、以下で修正
   UPDATE archived_files SET schema_version = 'v1' WHERE schema_version IS NULL;
   ```

3. **アプリケーション防御**
   - buffer-consumer.ts で schema_version が渡されない場合、デフォルト 'v1' を使用
   - cron.ts で registerArchivedFile() に NULL は渡さない（Rust 型で強制）
   - reader.ts で NULL を許容（古いデータ対応）

## テスト実施

### Test Case: マイグレーション前後の一貫性

```typescript
// FUSOU-WORKFLOW test/test_migration_safety.mjs

import test from 'ava';

test('DEFAULT v1 is applied to new records', async (t) => {
  const db = /* ... */;
  
  // Insert without schema_version
  await db.prepare(
    'INSERT INTO archived_files (file_path, file_size) VALUES (?, ?)'
  ).bind('test.avro', 1024).run();
  
  // Verify DEFAULT was applied
  const result = await db.prepare(
    'SELECT schema_version FROM archived_files WHERE file_path = ?'
  ).bind('test.avro').first();
  
  t.is(result?.schema_version, 'v1');
});

test('Explicit schema_version overrides DEFAULT', async (t) => {
  const db = /* ... */;
  
  await db.prepare(
    'INSERT INTO archived_files (file_path, schema_version) VALUES (?, ?)'
  ).bind('test-v2.avro', 'v2').run();
  
  const result = await db.prepare(
    'SELECT schema_version FROM archived_files WHERE file_path = ?'
  ).bind('test-v2.avro').first();
  
  t.is(result?.schema_version, 'v2');
});

test('NULL values are rejected (NOT NULL constraint)', async (t) => {
  const db = /* ... */;
  
  // This should fail
  const error = await t.throwsAsync(
    () => db.prepare(
      'INSERT INTO archived_files (file_path, schema_version) VALUES (?, ?)'
    ).bind('test-null.avro', null).run()
  );
  
  t.match(error.message, /NOT NULL constraint/i);
});

test('Migrated data consistency', async (t) => {
  const db = /* ... */;
  
  // Count any NULL values (there should be none after migration)
  const result = await db.prepare(
    'SELECT COUNT(*) as null_count FROM archived_files WHERE schema_version IS NULL'
  ).first();
  
  t.is(result?.null_count, 0);
});
```

## 結論と推奨事項

✓ **現在の実装**: 安全
- NOT NULL DEFAULT 'v1' で保護されている
- アプリケーション側でも 'v1' がデフォルト

⚠️ **留意点**:
- マイグレーション中に old client と new client が混在する場合
  → old client が schema_version なしでアップロード → DEFAULT で 'v1' に
  → 問題なし（v1 が実装デフォルト）

⚠️ **将来的な対応**:
- v2 へ移行するときは feature flag で制御
  - FUSOU-APP が schema_v2 feature を有効にしたら v2 を送信
  - server が v2 をサポートしたら 'v2' を受け入れる
  - 古い records は 'v1' のまま（ロールバック対応）

**推奨**: 本当の運用開始前に以下を確認
1. D1 production で ALTER TABLE 実行 (NULL は出ないはず)
2. 既存データが全て schema_version='v1' であることを確認
3. FUSOU-WORKFLOW deploy 後、新規アップロードが全て schema_version='v1' に
4. reader.ts が NULL を許容（古いデータ読み取り）
5. 監視: SELECT COUNT(*) FROM archived_files WHERE schema_version IS NULL daily
