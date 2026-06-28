-- Add trust tag support for compaction hot buffer
ALTER TABLE buffer_logs ADD COLUMN trust_tag VARCHAR(20) DEFAULT NULL;
