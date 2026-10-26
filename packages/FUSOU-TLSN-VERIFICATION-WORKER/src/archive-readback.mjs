import { sha256Base64Url } from "./origin-trust-contract.mjs";
export class ArchiveReadbackError extends Error {}

export function archiveCustomMetadata(role, context) {
  const keys = ["source_sha", "session_id", "job_id", "verification_attempt_id", "binding_id"];
  if (!["presentation", "result"].includes(role) || !/^[0-9a-f]{40}$/.test(context.source_sha ?? "") ||
      !keys.every((key) => typeof context[key] === "string" && context[key]) || !/^[A-Za-z0-9_-]{43}$/.test(context.binding_id)) {
    throw new ArchiveReadbackError("archive execution identity is incomplete");
  }
  return { fusou_role: role, ...Object.fromEntries(keys.map((key) => [`fusou_${key}`, context[key]])) };
}
export function assertArchiveGeneration(written, observed, role, context) {
  const metadata = archiveCustomMetadata(role, context);
  if (typeof written?.version !== "string" || !written.version || observed?.version !== written.version ||
      !Object.entries(metadata).every(([key, value]) => observed.customMetadata?.[key] === value)) {
    throw new ArchiveReadbackError("archive generation/observed authority metadata mismatch");
  }
}
export function createR2ArchiveReadbackBackend({ bucket, backendId, resolveCapture }) {
  if (!bucket?.get || typeof backendId !== "string" || !backendId || typeof resolveCapture !== "function") {
    throw new ArchiveReadbackError("authenticated R2 backend and independent capture resolver are required");
  }
  return { get: async ({ object_key }) => {
    const object = await bucket.get(object_key);
    if (!object || typeof object.version !== "string" || !object.version) throw new ArchiveReadbackError("archived object/version is missing");
    const bytes = new Uint8Array(await object.arrayBuffer()), metadata = object.customMetadata ?? {};
    const identity = { role: metadata.fusou_role, session_id: metadata.fusou_session_id,
      job_id: metadata.fusou_job_id, verification_attempt_id: metadata.fusou_verification_attempt_id,
      binding_id: metadata.fusou_binding_id, source_sha: metadata.fusou_source_sha };
    archiveCustomMetadata(identity.role, { source_sha: identity.source_sha, session_id: identity.session_id,
      job_id: identity.job_id, verification_attempt_id: identity.verification_attempt_id, binding_id: identity.binding_id });
    const captureId = await resolveCapture({ ...identity, object_key, version_id: object.version });
    if (typeof captureId !== "string" || !captureId) throw new ArchiveReadbackError("independent archive capture mapping is missing");
    return { ...identity, backend_id: backendId, object_key, version_id: object.version, capture_id: captureId,
      sha256: await sha256Base64Url(bytes), bytes, retention_status: "NOT_CHECKED" };
  } };
}
