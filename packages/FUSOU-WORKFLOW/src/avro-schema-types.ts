/**
 * Type definitions for Avro schema D1 database tables
 * 
 * These types correspond to the schema defined in docs/sql/d1/avro-schema.sql
 */

/**
 * Main table: Tracks the current state of each Avro file
 * One record per file. Updated on each append operation.
 */
export interface AvroFile {
  /** Primary key (matches R2 object key) - e.g., "dataset123/battle/202412.avro" */
  file_key: string;
  
  /** Dataset identifier */
  dataset_id: string;
  
  /** Table name (e.g., "battle", "api_port") */
  table_name: string;
  
  /** Period tag for grouping (e.g., "202412", "202412-W3") */
  period_tag: string;
  
  /** Current total file size in bytes */
  current_size: number;
  
  /** Estimated number of records (optional) */
  record_count: number;
  
  /** TRUE if file exceeded 512MB and was segmented */
  is_segmented: boolean;
  
  /** Number of segments (0 = not segmented) */
  segment_count: number;
  
  /** Most recent R2 ETag */
  last_etag: string | null;
  
  /** SHA-256 hash of last appended data (for deduplication) */
  content_hash: string | null;
  
  /** Initial file creation time (Unix timestamp in milliseconds) */
  created_at: number;
  
  /** Most recent append operation time (Unix timestamp in milliseconds) */
  last_appended_at: number;
  
  /** Supabase user ID of last uploader */
  uploaded_by: string | null;
  
  /** JSON representation of Avro schema (optional) */
  avro_schema: string | null;
}

/**
 * Segment table: Tracks individual segment files created when parent exceeds 512MB
 * Only populated when segmentation occurs.
 */
export interface AvroSegment {
  /** Primary key (matches R2 object key) - e.g., "dataset123/battle/202412/20241222-abc123.avro" */
  segment_key: string;
  
  /** Parent file reference (foreign key to avro_files.file_key) */
  parent_file_key: string;
  
  /** Sequential segment number (1, 2, 3, ...) */
  segment_number: number;
  
  /** Bytes in this segment */
  segment_size: number;
  
  /** Estimated records in this segment (optional) */
  record_count: number;
  
  /** R2 ETag */
  etag: string | null;
  
  /** SHA-256 hash of segment data */
  content_hash: string | null;
  
  /** Segment creation time (Unix timestamp in milliseconds) */
  created_at: number;
}

/**
 * Optional append history table: Audit trail for all append operations
 * Useful for debugging, monitoring, and compliance.
 */
export interface AvroAppendHistory {
  /** Auto-increment ID */
  id: number;
  
  /** Target file key */
  file_key: string;
  
  /** Bytes added in this operation */
  appended_bytes: number;
  
  /** Records added (estimated, optional) */
  appended_records: number;
  
  /** File size before append */
  size_before: number;
  
  /** File size after append */
  size_after: number;
  
  /** Operation result: 'append', 'segment_created', 'new_file' */
  action: 'append' | 'segment_created' | 'new_file';
  
  /** If action='segment_created', the segment_key */
  segment_created: string | null;
  
  /** SHA-256 hash of appended data */
  content_hash: string | null;
  
  /** When this append occurred (Unix timestamp in milliseconds) */
  appended_at: number;
  
  /** Original request timestamp from client (Unix timestamp in milliseconds) */
  triggered_at: number | null;
  
  /** Supabase user ID */
  uploaded_by: string | null;
}

/**
 * View: Current state of all files with their total size (including segments)
 */
export interface AvroFileWithTotalSize extends Omit<AvroFile, 'avro_schema'> {
  /** Total size including all segments */
  total_size: number;
}

/**
 * View: Latest files per dataset/table combination
 */
export interface AvroFileLatest {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  file_key: string;
  current_size: number;
  segment_count: number;
  is_segmented: boolean;
  last_appended_at: number;
  uploaded_by: string | null;
}

/**
 * View: Period summary - aggregated statistics per period
 */
export interface AvroPeriodSummary {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  file_count: number;
  total_bytes: number;
  total_segments: number;
  period_start: number;
  period_end: number;
}

/**
 * View: Global summary - all tables across all datasets
 */
export interface AvroGlobalSummary {
  table_name: string;
  file_count: number;
  total_bytes: number;
  total_segments: number;
  segmented_files: number;
  earliest_file: number;
  latest_append: number;
}
