export type ArchiveContext = { source_sha: string; session_id: string; job_id: string; verification_attempt_id: string; binding_id: string };
export function archiveCustomMetadata(role: "presentation" | "result", context: ArchiveContext): Record<string, string>;
export function assertArchiveGeneration(written: Pick<R2Object, "version"> | null, observed: Pick<R2Object, "version" | "customMetadata">,
  role: "presentation" | "result", context: ArchiveContext): void;
export type ArchiveReadIdentity = ArchiveContext & { role: "presentation" | "result"; object_key: string; version_id: string };
export function createR2ArchiveReadbackBackend(options: {
  bucket: { get(key: string): Promise<{ version: string; customMetadata?: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer> } | null> };
  backendId: string;
  resolveCapture(identity: ArchiveReadIdentity): Promise<string>;
}): { get(input: { object_key: string }): Promise<ArchiveReadIdentity & {
  backend_id: string; capture_id: string; sha256: string; bytes: Uint8Array; retention_status: "NOT_CHECKED";
}> };
