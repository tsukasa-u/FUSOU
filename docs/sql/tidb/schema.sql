-- FUSOU-WORKFLOW TiDB Schema
-- TiDB Cloud Serverless version of buffer_logs table
-- 
-- Execute each CREATE TABLE statement separately in TiDB Console

-- ============================================================
-- Table 1: buffer_logs (Hot buffer for recent writes)
-- ============================================================
CREATE TABLE IF NOT EXISTS buffer_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dataset_id VARCHAR(255) NOT NULL,
  table_name VARCHAR(255) NOT NULL,
  period_tag VARCHAR(50) NOT NULL DEFAULT 'latest',
  table_version VARCHAR(20) NOT NULL,
  timestamp BIGINT NOT NULL,
  data LONGBLOB NOT NULL,
  uploaded_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_buffer_dataset_table (dataset_id, table_name),
  INDEX idx_buffer_timestamp (timestamp),
  INDEX idx_buffer_period (period_tag)
);
