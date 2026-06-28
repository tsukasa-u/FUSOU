-- Add trust tag propagation columns for upload -> compaction -> read pipeline
ALTER TABLE buffer_logs ADD COLUMN trust_tag TEXT DEFAULT NULL;
ALTER TABLE block_indexes ADD COLUMN trust_tag TEXT DEFAULT NULL;
