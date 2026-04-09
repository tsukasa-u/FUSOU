/**
 * Synergy Manifest - Specification for sp_effect_item.json tracking
 * 
 * User-managed workflow:
 * 1. Generate sp_effect_item.json with embedded metadata (period_tag, api_start2_batch_hash, etc.)
 * 2. Compute SHA256 hash of file
 * 3. Upload to R2: master_data_meta/sp_effect/{period_tag}/rev{period_revision}/{content_hash}.json
 * 4. Create manifest sidecar: master_data_meta/manifest/{period_tag}/rev{period_revision}/{content_hash}.manifest.json
 * 5. Mark in D1 as completed via POST /api/master-data/synergy-manifest/complete
 */

export interface SynergyManifest {
  id: number;
  period_tag: string; // YYYY-MM-DD format
  period_revision: number; // Auto-incremented per (period_tag, period_revision) UNIQUE constraint
  content_hash: string; // SHA256 hex (lowercase, 64 chars)
  sp_effect_sha256: string; // SHA256 of sp_effect_item.json content
  api_start2_batch_hash: string; // SHA256 of api_start2 master data batch used for generation
  generator_version: string; // Semantic version: "v1.0.0"
  generated_at: number; // Unix epoch seconds
  upload_status: 'pending' | 'completed' | 'superseded' | 'failed';
  created_at: number; // Unix epoch seconds (auto)
  completed_at?: number; // Unix epoch seconds (when marked completed)
}

export interface SynergyManifestRequest {
  period_tag: string;
  sp_effect_sha256: string;
  api_start2_batch_hash: string;
  generator_version: string;
  generated_at: string; // ISO8601
}

export interface SynergyManifestResponse {
  period_tag: string;
  period_revision: number;
  sp_effect_sha256: string;
  api_start2_batch_hash: string;
  generator_version: string;
  r2_keys: {
    sp_effect_json: string;
    manifest: string;
  };
  upload_status: 'pending' | 'completed' | 'superseded' | 'failed';
  completed_at?: number;
}

/**
 * Validation Functions
 */

export function validateSHA256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

export function validatePeriodTag(tag: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(tag);
}

export function validateGeneratorVersion(version: string): boolean {
  return /^v\d+\.\d+\.\d+/.test(version);
}

export function getSynergyManifestR2Keys(
  period_tag: string,
  period_revision: number,
  content_hash: string
): { sp_effect_json: string; manifest: string } {
  const basePath = `master_data_meta/sp_effect/${period_tag}/rev${period_revision}/${content_hash}`;
  return {
    sp_effect_json: `${basePath}.json`,
    manifest: `master_data_meta/manifest/${period_tag}/rev${period_revision}/${content_hash}.manifest.json`,
  };
}
