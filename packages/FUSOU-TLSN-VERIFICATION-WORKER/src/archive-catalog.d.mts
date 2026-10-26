import type { ArchiveContext } from "./archive-readback.mjs";
export const ARCHIVE_CATALOG_STORAGE_KEY: "archive-catalog";
export class ArchiveCatalogError extends Error {}
export function archiveCatalogEqual(left: ConsumedArchiveCatalog | undefined, right: ConsumedArchiveCatalog | undefined): boolean;
export type ArchiveObjectSnapshot = ArchiveContext & {
  role: "presentation" | "result"; object_key: string; version_id: string; sha256: string; byte_length: number;
};
export type CatalogBinding = {
  status: string; binding_id: string; session_id: string; verification_job_id?: string;
  verification_attempt_id?: string; presentation_id?: string; result_sha256?: string; result_object_key?: string; used_at?: string;
  canonical_user_id?: string; device_id?: string;
  archive_catalog_created_at?: string;
};
export type ConsumedArchiveCatalog = {
  schema_version: 1; scope: "fusou-consumed-archive-catalog-v1"; capture_id: string; source_sha: string;
  writer: { authority_binding: "TLSN_BINDINGS"; archive_binding: "TLSN_PRESENTATIONS" };
  session_id: string; job_id: string; verification_attempt_id: string; binding_id: string; created_at: string; authority_used_at: string;
  validity_scope: "EXACT_CONSUMED_BINDING"; objects: Record<"presentation" | "result", ArchiveObjectSnapshot>;
  result_envelope_sha256: string; verifier_execution_receipt_sha256?: string;
  generation_semantics: "CURRENT_OBJECT_VERSION_EQUALITY"; previous_generation_retrieval: "NOT_IMPLEMENTED"; retention_status: "NOT_CHECKED";
};
export function archiveObjectSnapshot(object: { version: string }, role: "presentation" | "result", context: ArchiveContext,
  objectKey: string, digest: string, byteLength: number): ArchiveObjectSnapshot;
export function createConsumedArchiveCatalog(record: CatalogBinding, snapshots: ArchiveObjectSnapshot[], resultBytes: Uint8Array,
  verifierReceiptBytes?: Uint8Array): Promise<ConsumedArchiveCatalog>;
export function assertConsumedArchiveCatalog(catalog: ConsumedArchiveCatalog, record: CatalogBinding, resultBytes: Uint8Array,
  verifierReceiptBytes?: Uint8Array): Promise<void>;
export type ArchiveCatalogLookup = {
  session_id: string; canonical_user_id: string; device_id: string; verification_job_id: string;
};
export type CatalogReader = { getConsumedVerificationResult(captureId: string, lookup: ArchiveCatalogLookup): Promise<{
  record: CatalogBinding; bytes: Uint8Array; archive_catalog?: ConsumedArchiveCatalog; verifier_execution_receipt_bytes?: Uint8Array;
} | null> };
export function readAuthorityArchiveCatalog(authority: CatalogReader, captureId: string, lookup: ArchiveCatalogLookup): Promise<ConsumedArchiveCatalog>;
export function createAuthorityCatalogReadback(options: {
  authority: CatalogReader; captureId: string; sourceSha: string; lookup: ArchiveCatalogLookup; backendId: string;
  bucket: { get(key: string): Promise<{ version: string; customMetadata?: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer> } | null> };
}): Promise<{ catalog: ConsumedArchiveCatalog; get(request: { role: "presentation" | "result"; object_key: string }): Promise<{
  role: "presentation" | "result"; source_sha: string; session_id: string; job_id: string; verification_attempt_id: string;
  binding_id: string; object_key: string; version_id: string; capture_id: string; backend_id: string; sha256: string;
  bytes: Uint8Array; retention_status: "NOT_CHECKED";
}> }>;
