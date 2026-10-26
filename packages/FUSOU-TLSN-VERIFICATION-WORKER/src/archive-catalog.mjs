import { archiveCustomMetadata, createR2ArchiveReadbackBackend } from "./archive-readback.mjs";
import { canonicalJson, sha256Base64Url } from "./origin-trust-contract.mjs";

export const ARCHIVE_CATALOG_STORAGE_KEY = "archive-catalog";
export class ArchiveCatalogError extends Error {}
export function archiveCatalogEqual(left, right) {
  return left === undefined || right === undefined ? left === right : canonicalJson(left) === canonicalJson(right);
}

export function archiveObjectSnapshot(object, role, context, objectKey, digest, byteLength) {
  archiveCustomMetadata(role, context);
  if (typeof object?.version !== "string" || !object.version ||
    objectKey !== `tlsn-verification/${context.verification_attempt_id}/${role}.${role === "presentation" ? "bin" : "json"}` ||
    !/^[A-Za-z0-9_-]{43}$/.test(digest) || !Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new ArchiveCatalogError("verified archive snapshot identity/generation is incomplete");
  }
  return { role, ...context, object_key: objectKey, version_id: object.version, sha256: digest, byte_length: byteLength };
}

export async function createConsumedArchiveCatalog(record, snapshots, resultBytes, verifierReceiptBytes) {
  if (record.status !== "consumed" || !Array.isArray(snapshots) || snapshots.length !== 2 ||
    !(resultBytes instanceof Uint8Array) || await sha256Base64Url(resultBytes) !== record.result_sha256 ||
    !Number.isFinite(Date.parse(record.used_at)) || !Number.isFinite(Date.parse(record.archive_catalog_created_at))) {
    throw new ArchiveCatalogError("archive catalog requires an exact consumed authority Result");
  }
  const objects = {};
  for (const role of ["presentation", "result"]) {
    const snapshot = snapshots.find((entry) => entry?.role === role);
    if (!snapshot || snapshot.binding_id !== record.binding_id || snapshot.session_id !== record.session_id ||
      snapshot.job_id !== record.verification_job_id || snapshot.verification_attempt_id !== record.verification_attempt_id ||
      snapshot.sha256 !== (role === "presentation" ? record.presentation_id : record.result_sha256) ||
      role === "result" && (snapshot.object_key !== record.result_object_key || snapshot.byte_length !== resultBytes.byteLength)) {
      throw new ArchiveCatalogError("archive catalog authority/target/digest mismatch");
    }
    objects[role] = archiveObjectSnapshot({ version: snapshot.version_id }, role, {
      source_sha: snapshot.source_sha, binding_id: snapshot.binding_id, session_id: snapshot.session_id,
      job_id: snapshot.job_id, verification_attempt_id: snapshot.verification_attempt_id,
    }, snapshot.object_key, snapshot.sha256, snapshot.byte_length);
  }
  if (objects.presentation.source_sha !== objects.result.source_sha) throw new ArchiveCatalogError("archive catalog writer source mismatch");
  if (verifierReceiptBytes !== undefined && (!(verifierReceiptBytes instanceof Uint8Array) || verifierReceiptBytes.byteLength === 0)) {
    throw new ArchiveCatalogError("archive catalog execution receipt bytes are missing");
  }
  return { schema_version: 1, scope: "fusou-consumed-archive-catalog-v1", capture_id: record.binding_id,
    source_sha: objects.result.source_sha, writer: { authority_binding: "TLSN_BINDINGS", archive_binding: "TLSN_PRESENTATIONS" },
    session_id: record.session_id, job_id: record.verification_job_id, verification_attempt_id: record.verification_attempt_id,
    binding_id: record.binding_id, created_at: record.archive_catalog_created_at, authority_used_at: record.used_at,
    validity_scope: "EXACT_CONSUMED_BINDING",
    objects, result_envelope_sha256: record.result_sha256,
    ...(verifierReceiptBytes ? { verifier_execution_receipt_sha256: await sha256Base64Url(verifierReceiptBytes) } : {}),
    generation_semantics: "CURRENT_OBJECT_VERSION_EQUALITY", previous_generation_retrieval: "NOT_IMPLEMENTED",
    retention_status: "NOT_CHECKED" };
}

export async function assertConsumedArchiveCatalog(catalog, record, resultBytes, verifierReceiptBytes) {
  const expected = await createConsumedArchiveCatalog(record, Object.values(catalog?.objects ?? {}), resultBytes, verifierReceiptBytes);
  if (!archiveCatalogEqual(catalog, expected)) throw new ArchiveCatalogError("stored archive catalog/authority mismatch");
}

export async function readAuthorityArchiveCatalog(authority, captureId, lookup) {
  if (typeof authority?.getConsumedVerificationResult !== "function") throw new ArchiveCatalogError("AUTHORITY_CATALOG_READER_NOT_REGISTERED");
  if (typeof captureId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(captureId) || !lookup) {
    throw new ArchiveCatalogError("archive capture binding identity/lookup is missing");
  }
  const consumed = await authority.getConsumedVerificationResult(captureId, lookup);
  if (!consumed?.archive_catalog) throw new ArchiveCatalogError("AUTHORITY_ARCHIVE_CATALOG_MISSING");
  if (consumed.record.binding_id !== captureId || !["session_id", "canonical_user_id", "device_id", "verification_job_id"]
    .every((key) => typeof lookup[key] === "string" && lookup[key] && consumed.record[key] === lookup[key])) {
    throw new ArchiveCatalogError("authority archive catalog subject/job mismatch");
  }
  await assertConsumedArchiveCatalog(consumed.archive_catalog, consumed.record, consumed.bytes, consumed.verifier_execution_receipt_bytes);
  return structuredClone(consumed.archive_catalog);
}

export async function createAuthorityCatalogReadback({ authority, captureId, sourceSha, lookup, bucket, backendId }) {
  const catalog = await readAuthorityArchiveCatalog(authority, captureId, lookup);
  if (!/^[0-9a-f]{40}$/.test(sourceSha) || catalog.source_sha !== sourceSha) throw new ArchiveCatalogError("catalog/independent release source mismatch");
  const backend = createR2ArchiveReadbackBackend({ bucket, backendId, resolveCapture: async (observed) => {
    const pinned = catalog.objects[observed.role];
    if (!pinned || !["role", "source_sha", "session_id", "job_id", "verification_attempt_id", "binding_id", "object_key", "version_id"]
      .every((key) => observed[key] === pinned[key])) throw new ArchiveCatalogError("catalog/archive metadata or generation mismatch");
    return catalog.capture_id;
  } });
  return { catalog: structuredClone(catalog), get: async (request) => {
    const pinned = ["presentation", "result"].includes(request?.role) ? catalog.objects[request.role] : undefined;
    if (!pinned || request.object_key !== pinned.object_key) throw new ArchiveCatalogError("arbitrary archive key/role is forbidden");
    const observed = await backend.get({ object_key: pinned.object_key });
    if (observed.sha256 !== pinned.sha256 || observed.bytes.byteLength !== pinned.byte_length) {
      throw new ArchiveCatalogError("catalog/archive raw bytes mismatch");
    }
    return observed;
  } };
}
