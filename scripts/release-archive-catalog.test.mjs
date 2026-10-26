// Explicit Worker source reads with in-memory storage/R2 doubles; no services or native code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { sha256 } from "./release-bytes.mjs";
import { ARCHIVE_CATALOG_STORAGE_KEY, archiveCatalogEqual, assertConsumedArchiveCatalog, createAuthorityCatalogReadback,
  readAuthorityArchiveCatalog } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs";

const worker = new URL("../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/", import.meta.url);
async function loadSource(name) {
  let source = stripTypeScriptTypes(await readFile(new URL(name, worker), "utf8"), { mode: "transform" });
  source = source.replace('import { DurableObject } from "cloudflare:workers";', "class DurableObject { constructor(ctx) { this.ctx = ctx; } }");
  for (const module of ["archive-readback.mjs", "archive-catalog.mjs"]) {
    source = source.replace(JSON.stringify(`./${module}`), JSON.stringify(new URL(module, worker).href));
  }
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}
const [{ TlsnBindingAuthorityDurableObject }, archive] = await Promise.all([loadSource("binding_authority.ts"), loadSource("result_archive.ts")]);
const time = Date.parse("2026-10-23T00:00:00Z");
async function fixture({ legacy = false, failWriteKey } = {}) {
  const context = { source_sha: "a".repeat(40), binding_id: "B".repeat(43), session_id: "session", job_id: "job",
    verification_attempt_id: "attempt" };
  const presentation = Buffer.from("synthetic presentation"), result = Buffer.from('{"consume_receipt":{"synthetic":true},"result":"synthetic"}');
  const executionReceipt = Buffer.from("synthetic execution receipt");
  const key = (role) => `tlsn-verification/${context.verification_attempt_id}/${role}.${role === "presentation" ? "bin" : "json"}`;
  const record = { ...context, canonical_user_id: "user", device_id: "device", device_auth_nonce: "device-nonce", nonce: "nonce",
    tlsn_device_challenge: "challenge", binding_value: "binding-value", created_at: new Date(time - 1000).toISOString(),
    expires_at: new Date(time + 100000).toISOString(), status: "verifying", verification_job_id: context.job_id,
    verification_profile: "complete", verification_result_key: "job-result", result_object_key: key("result"),
    presentation_id: sha256(presentation), verification_lease_expires_at: new Date(time + 10000).toISOString() };
  const objects = new Map(), operations = [];
  let generation = 0;
  const bucket = {
    async put(objectKey, bytes, options) {
      const object = { bytes: Uint8Array.from(bytes), version: `generation-${++generation}`, customMetadata: options.customMetadata };
      objects.set(objectKey, object); return object;
    },
    async get(objectKey) {
      operations.push(objectKey);
      const object = objects.get(objectKey);
      return object ? { ...object, arrayBuffer: async () => Uint8Array.from(object.bytes).buffer } : null;
    },
    async delete(objectKey) { objects.delete(objectKey); },
  };
  const snapshots = [
    await archive.persistAndVerifyPresentationArchive(bucket, key("presentation"), presentation, sha256(presentation), context),
    await archive.persistAndVerifyResultArchive(bucket, key("result"), result, sha256(result), context),
  ];
  operations.length = 0;
  const state = new Map([["binding", record]]);
  const storage = { async transaction(callback) {
    const draft = structuredClone(state);
    const response = await callback({
      get: async (key) => structuredClone(draft.get(key)),
      put: async (key, value) => {
        if (key === failWriteKey) throw new Error("synthetic storage write failed");
        draft.set(key, structuredClone(value));
      },
      delete: async (key) => draft.delete(key),
    });
    state.clear(); for (const [key, value] of draft) state.set(key, value);
    return response;
  } };
  const authority = new TlsnBindingAuthorityDurableObject({ storage }, {});
  const input = { ...record, verification_attempt_id: context.verification_attempt_id, result_sha256: sha256(result),
    result_bytes: Uint8Array.from(result), verifier_execution_receipt_bytes: Uint8Array.from(executionReceipt),
    used_at: new Date(time).toISOString(), now: time, ...(!legacy ? { archive_snapshots: snapshots } : {}) };
  const lookup = { session_id: context.session_id, canonical_user_id: record.canonical_user_id, device_id: record.device_id,
    verification_job_id: record.verification_job_id };
  const reader = { async getConsumedVerificationResult(captureId, expected) {
    if (captureId !== context.binding_id) return null;
    const response = await authority.getConsumedVerificationResult(expected);
    return response.ok ? response.result : null;
  } };
  const readback = () => createAuthorityCatalogReadback({ authority: reader, captureId: context.binding_id,
    sourceSha: context.source_sha, lookup, bucket, backendId: "synthetic-binding" });
  return { context, key, state, snapshots, input, lookup, reader, authority, bucket, objects, operations, readback, result };
}

test("writer-observed generations and exact Result/receipt digest commit atomically; same capture retry is idempotent", async () => {
  const f = await fixture();
  assert.deepEqual(f.snapshots.map((s) => s.version_id), ["generation-1", "generation-2"]);
  assert.equal(f.state.has(ARCHIVE_CATALOG_STORAGE_KEY), false);
  assert.equal((await f.authority.commitVerifiedResult(f.input)).ok, true);
  const catalog = f.state.get(ARCHIVE_CATALOG_STORAGE_KEY);
  const replay = await f.authority.getConsumedVerificationResultForReplay(f.input);
  assert.equal(replay.ok, true); assert.deepEqual(replay.result.archive_catalog, catalog);
  assert.equal(catalog.capture_id, f.context.binding_id);
  assert.equal(catalog.result_envelope_sha256, sha256(f.result));
  assert.equal(catalog.verifier_execution_receipt_sha256, sha256(f.input.verifier_execution_receipt_bytes));
  assert.equal(catalog.objects.presentation.sha256, f.input.presentation_id);
  assert.equal((await f.authority.commitVerifiedResult(f.input)).ok, true);
  const backend = await f.readback();
  for (const role of ["presentation", "result"]) {
    const observed = await backend.get({ role, object_key: f.key(role) });
    assert.equal(observed.sha256, catalog.objects[role].sha256);
    assert.equal(observed.capture_id, catalog.capture_id);
    assert.equal(observed.retention_status, "NOT_CHECKED");
  }
  assert.equal(backend.put, undefined); assert.equal(backend.delete, undefined); assert.equal(backend.list, undefined);
  const reordered = Object.fromEntries(Object.entries(catalog).reverse());
  assert.equal(archiveCatalogEqual(catalog, reordered), true);
  await assertConsumedArchiveCatalog(reordered, f.state.get("binding"), f.input.result_bytes, f.input.verifier_execution_receipt_bytes);
});

for (const mutation of ["session_id", "job_id", "verification_attempt_id", "binding_id", "sha256", "object_key", "source_sha", "byte_length"]) {
  test(`authority expects its stored target and exact Result: changed snapshot ${mutation} cannot commit`, async () => {
    const f = await fixture();
    const before = structuredClone(f.state);
    f.input.archive_snapshots[1][mutation] = mutation === "byte_length" ? 999 : mutation === "source_sha" ? "b".repeat(40) : "foreign";
    const response = await f.authority.commitVerifiedResult(f.input);
    assert.equal(response.ok, false); assert.equal(response.error, "verification_result_mismatch");
    assert.deepEqual(f.state, before);
  });
}
test("missing presentation snapshot cannot commit Result/catalog; legacy records cannot invent a generation", async () => {
  const f = await fixture(); f.input.archive_snapshots.pop();
  assert.equal((await f.authority.commitVerifiedResult(f.input)).ok, false);
  assert.equal(f.state.has("verification-result"), false); assert.equal(f.state.has(ARCHIVE_CATALOG_STORAGE_KEY), false);
  const old = await fixture({ legacy: true });
  assert.equal((await old.authority.commitVerifiedResult(old.input)).ok, true);
  await assert.rejects(old.readback(), /AUTHORITY_ARCHIVE_CATALOG_MISSING/);
  const response = await old.authority.commitVerifiedResult({ ...old.input, archive_snapshots: old.snapshots });
  assert.equal(response.ok, false); assert.equal(response.error, "binding_consumed");
});
test("independent authority reader, not a producer's self-asserted success record, is required before R2", async () => {
  const f = await fixture();
  await assert.rejects(readAuthorityArchiveCatalog({ authenticated: true, archive_catalog: f.snapshots }, f.context.binding_id, f.lookup),
    /AUTHORITY_CATALOG_READER_NOT_REGISTERED/);
  assert.equal((await f.authority.commitVerifiedResult(f.input)).ok, true);
  await assert.rejects(readAuthorityArchiveCatalog(f.reader, "C".repeat(43), f.lookup), /CATALOG_MISSING/);
  for (const field of Object.keys(f.lookup)) {
    await assert.rejects(readAuthorityArchiveCatalog(f.reader, f.context.binding_id, { ...f.lookup, [field]: "foreign" }), /CATALOG_MISSING/);
  }
  assert.deepEqual(f.operations, []);
});
for (const mutation of ["bytes", "version", "session_id", "job_id", "verification_attempt_id", "binding_id", "source_sha", "role", "missing"]) {
  test(`authority catalog is the independent expectation; R2 ${mutation} substitution is rejected`, async () => {
    const f = await fixture(); assert.equal((await f.authority.commitVerifiedResult(f.input)).ok, true);
    const object = f.objects.get(f.key("result"));
    if (mutation === "bytes") object.bytes[0] ^= 1;
    else if (mutation === "version") object.version = "overwritten-generation";
    else if (mutation === "missing") f.objects.delete(f.key("result"));
    else object.customMetadata[`fusou_${mutation}`] = mutation === "binding_id" ? "C".repeat(43) :
      mutation === "source_sha" ? "c".repeat(40) : mutation === "role" ? "presentation" : "foreign";
    const backend = await f.readback();
    await assert.rejects(backend.get({ role: "result", object_key: f.key("result") }), /mismatch|missing/);
  });
}
test("unknown key/role is rejected before bucket access; catalog does not expose write/delete/list methods", async () => {
  const f = await fixture(); await f.authority.commitVerifiedResult(f.input);
  const backend = await f.readback();
  for (const request of [{ role: "result", object_key: "untrusted-key" }, { role: "registry", object_key: f.key("result") },
    { role: "toString" }, { role: "__proto__" }, null]) {
    await assert.rejects(backend.get(request), /arbitrary archive key\/role/);
  }
  assert.deepEqual(f.operations, []);
});
test("transaction failure after catalog write rolls back both catalog and Result, never returning success", async () => {
  const f = await fixture({ failWriteKey: "verification-result" });
  const before = structuredClone(f.state);
  await assert.rejects(f.authority.commitVerifiedResult(f.input), /synthetic storage write failed/);
  assert.deepEqual(f.state, before);
  await assert.rejects(f.readback(), /CATALOG_MISSING/);
});
test("a caller cannot change the reader's private authority expectation by mutating its exported catalog copy", async () => {
  const f = await fixture(); await f.authority.commitVerifiedResult(f.input);
  const backend = await f.readback(), forged = Buffer.from("forged result");
  backend.catalog.objects.result.sha256 = sha256(forged);
  backend.catalog.objects.result.byte_length = forged.byteLength;
  f.objects.get(f.key("result")).bytes = forged;
  await assert.rejects(backend.get({ role: "result", object_key: f.key("result") }), /raw bytes mismatch/);
});
test("same consumed capture cannot be reused with a different generation or without its catalog", async () => {
  const f = await fixture(); await f.authority.commitVerifiedResult(f.input);
  const before = structuredClone(f.state);
  f.input.archive_snapshots[0].version_id = "other-generation";
  assert.equal((await f.authority.commitVerifiedResult(f.input)).error, "binding_consumed");
  delete f.input.archive_snapshots;
  assert.equal((await f.authority.commitVerifiedResult(f.input)).error, "binding_consumed");
  assert.deepEqual(f.state, before);
});
for (const mutation of ["retention_status", "previous_generation_retrieval", "generation_semantics", "created_at", "validity_scope",
  "result_envelope_sha256", "verifier_execution_receipt_sha256", "source_sha"]) {
  test(`independent stored Result/receipt contract rejects catalog's claimed ${mutation}`, async () => {
    const f = await fixture(); await f.authority.commitVerifiedResult(f.input);
    f.state.get(ARCHIVE_CATALOG_STORAGE_KEY)[mutation] = "VERIFIED";
    await assert.rejects(f.readback(), /catalog\/authority mismatch/);
  });
  test("independent release source is required before any archive object read", async () => {
    const f = await fixture(); await f.authority.commitVerifiedResult(f.input);
    await assert.rejects(createAuthorityCatalogReadback({ authority: f.reader, captureId: f.context.binding_id,
      sourceSha: "f".repeat(40), lookup: f.lookup, bucket: f.bucket, backendId: "synthetic-binding" }), /independent release source mismatch/);
    assert.deepEqual(f.operations, []);
  });
}
test("writer rejects unrelated canonical key rather than creating an exportable snapshot", async () => {
  const f = await fixture();
  await assert.rejects(archive.persistAndVerifyResultArchive(f.bucket, "caller-selected-key", f.input.result_bytes, f.input.result_sha256, f.context),
    /archive verification failed/);
  assert.equal(f.objects.has("caller-selected-key"), false);
});
