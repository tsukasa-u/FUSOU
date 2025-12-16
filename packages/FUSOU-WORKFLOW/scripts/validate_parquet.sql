-- DuckDB検証スクリプト
-- 使い方: duckdb < validate_parquet.sql

-- R2認証設定（環境変数から取得）
INSTALL httpfs;
LOAD httpfs;

SET s3_region='auto';
SET s3_endpoint='<ACCOUNT_ID>.r2.cloudflarestorage.com';
SET s3_access_key_id='<R2_ACCESS_KEY>';
SET s3_secret_access_key='<R2_SECRET_KEY>';

-- 設定確認
SELECT 'S3 Configuration:' as status;
SELECT current_setting('s3_endpoint') as endpoint;

-- テストファイルパス
.echo on
.mode line

-- 1. ファイル存在確認
SELECT 'File Check:' as step;
SELECT COUNT(*) as file_exists 
FROM 's3://dev-kc-battle-data/battle_compacted/2024Q4/dataset-123/battle/0.parquet' 
LIMIT 1;

-- 2. 行数カウント
SELECT 'Row Count:' as step;
SELECT COUNT(*) as total_rows 
FROM 's3://dev-kc-battle-data/battle_compacted/2024Q4/dataset-123/battle/0.parquet';

-- 3. スキーマ確認
SELECT 'Schema:' as step;
DESCRIBE SELECT * FROM 's3://dev-kc-battle-data/battle_compacted/2024Q4/dataset-123/battle/0.parquet';

-- 4. サンプルデータ
SELECT 'Sample Data (10 rows):' as step;
SELECT * FROM 's3://dev-kc-battle-data/battle_compacted/2024Q4/dataset-123/battle/0.parquet' 
LIMIT 10;

-- 5. 統計情報
SELECT 'Statistics:' as step;
SUMMARIZE 's3://dev-kc-battle-data/battle_compacted/2024Q4/dataset-123/battle/0.parquet';

-- 6. 複数ファイル統合クエリ（glob対応）
SELECT 'Multi-file Query:' as step;
SELECT COUNT(*) as total_rows_all_files
FROM 's3://dev-kc-battle-data/battle_compacted/2024Q4/dataset-123/battle/*.parquet';

.echo off
SELECT 'Validation completed successfully!' as result;
