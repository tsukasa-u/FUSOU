/**
 * Master Data Types
 * 
 * Type definitions for master data R2 synchronization
 */

export interface MasterDataRecord {
  id: number;
  period_tag: string;
  table_name: string;
  content_hash: string;
  r2_key: string | null;
  upload_status: 'pending' | 'completed' | 'failed';
  uploaded_by: string;
  created_at: number;
  completed_at: number | null;
}

export interface MasterDataUploadRequest {
  table: string;
  kc_period_tag: string;
  content_hash: string;
  file_size: number;
}

export interface MasterDataUploadResponse {
  ok: true;
  r2_key: string;
  size: number;
  table: string;
  period_tag: string;
  content_hash: string;
}

export interface MasterDataExistsResponse {
  exists: boolean;
  data?: Omit<MasterDataRecord, 'id'>;
}

export interface MasterDataCleanupResult {
  cleaned: number;
  deleted: number;
  errors: string[];
}

export const ALLOWED_MASTER_TABLES = [
  'mst_ship',
  'mst_shipgraph',
  'mst_slotitem',
  'mst_slotitem_equiptype',
  'mst_payitem',
  'mst_equip_exslot',
  'mst_bgm',
  'mst_furniture',
  'mst_bgm_season',
  'mst_mapbgm',
  'mst_const',
  'mst_mission',
] as const;

export type AllowedMasterTable = typeof ALLOWED_MASTER_TABLES[number];
