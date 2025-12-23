#!/bin/bash
# スキーマ確認スクリプト

echo "=== D1 Database Schema Verification ==="
echo ""
echo "Run the following commands to verify D1 schema:"
echo ""
echo "# avro_files table structure"
echo "npx wrangler d1 execute fusou-battle-data --command \"PRAGMA table_info(avro_files);\""
echo ""
echo "# avro_segments table structure"
echo "npx wrangler d1 execute fusou-battle-data --command \"PRAGMA table_info(avro_segments);\""
echo ""
echo "# Avro-related indexes"
echo "npx wrangler d1 execute fusou-battle-data --command \"SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('avro_files','avro_segments');\""
echo ""
echo ""
echo "=== Supabase Schema Verification ==="
echo ""
echo "Run the following SQL in Supabase SQL Editor:"
echo ""
cat << 'EOF'
-- datasets table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'datasets'
ORDER BY ordinal_position;

-- processing_metrics table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'processing_metrics'
ORDER BY ordinal_position;

-- Check indexes
SELECT 
    tablename,
    indexname, 
    indexdef
FROM pg_indexes
WHERE schemaname = 'public' 
  AND tablename IN ('datasets', 'processing_metrics')
ORDER BY tablename, indexname;

-- Verify specific columns exist
SELECT 
    EXISTS(SELECT 1 FROM information_schema.columns 
           WHERE table_name='datasets' AND column_name='table_offsets') as datasets_has_table_offsets,
    EXISTS(SELECT 1 FROM information_schema.columns 
           WHERE table_name='datasets' AND column_name='compaction_in_progress') as datasets_has_compaction_in_progress,
    EXISTS(SELECT 1 FROM information_schema.columns 
           WHERE table_name='datasets' AND column_name='last_compacted_at') as datasets_has_last_compacted_at;
EOF
