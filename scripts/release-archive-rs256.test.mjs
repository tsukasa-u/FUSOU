import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, mock, test } from "node:test";
import { errors, importSPKI, jwtVerify } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/jose/dist/webapi/index.js";
import { PUBLIC_RS256_VECTOR as vector } from "./release-archive-rs256-fixture.mjs";
import { readRegularFile } from "./release-files.mjs";
import { provenanceFixture } from "./release-provenance-fixture.mjs";
import { acquireArchiveHttp } from "./release-archive-http.mjs";
import { sha256 } from "./release-bytes.mjs";
import { assertVerifiedArchiveOidcClaims } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs";
import { createArchiveOidcVerifier } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs";
import { handleArchiveHttp } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs";
import { ARCHIVE_WORKFLOW_REF, ArchiveTransportError, GITHUB_OIDC_ISSUER, archivePolicyBytes, archiveReadRequest,
  assertArchiveIdentityPolicy, validateArchiveTransportSpec } from
  "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";

const JWT_SHA256 = "16a7986eb30312746c1b11f7559c30aa491b3d00209423ab16e3a6440567853c";
const SPKI_SHA256 = "5b21737c49135c0e17dfd44fe8b99842086718b3a9963552c95fed9d938166ed";
const EXPECTED_PAYLOAD = Object.freeze({
  "urn:example:claim": true, iat: 1669056488, iss: "urn:example:issuer", aud: "urn:example:audience",
});
const NOW = (EXPECTED_PAYLOAD.iat + 1) * 1000;
const prohibitedCalls = [];
for (const method of ["generateKey", "sign"]) mock.method(crypto.subtle, method, () => {
  prohibitedCalls.push(method); throw new Error(`Forbidden WebCrypto operation: ${method}`);
});
mock.method(globalThis, "fetch", () => {
  prohibitedCalls.push("fetch"); throw new Error("External network is forbidden");
});
after(() => {
  try { assert.deepEqual(prohibitedCalls, []); }
  finally { mock.restoreAll(); }
});

function assertPinnedVector({ jwt, spki } = vector) {
  const hash = (value) => createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
  assert.equal(hash(jwt), JWT_SHA256, "Fixed JWT SHA-256 mismatch");
  assert.equal(hash(spki), SPKI_SHA256, "Fixed public SPKI SHA-256 mismatch");
  assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert(!spki.includes("\r")); assert(spki.endsWith("-----END PUBLIC KEY-----"));
}
async function verifyGeneric(token = vector.jwt, options = {}) {
  assertPinnedVector();
  const key = await importSPKI(vector.spki, "RS256");
  return jwtVerify(token, key, {
    algorithms: ["RS256"], issuer: EXPECTED_PAYLOAD.iss, audience: EXPECTED_PAYLOAD.aud,
    requiredClaims: ["iat", "iss", "aud"], maxTokenAge: 60, clockTolerance: 0,
    currentDate: new Date(NOW), ...options,
  });
}

test("public vector bytes, immutable reference and installed JOSE 6.1.2 pin are exact", async () => {
  assertPinnedVector();
  assert.equal(vector.source.commit, "bafcb74f5fc070f4f5fd48b12c8bb90af832385e");
  assert.equal(vector.source.path, "src/jwt/verify.ts");
  assert.equal(vector.source.url, `https://github.com/panva/jose/blob/${vector.source.commit}/src/jwt/verify.ts`);
  assert.equal(vector.source.provenance, "USER_SUPPLIED_OFFLINE");
  const packageAt = async (path) => JSON.parse(await readRegularFile(new URL(path, import.meta.url)));
  assert.equal((await packageAt("../packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/jose/package.json")).version, "6.1.2");
  assert.equal((await packageAt("../packages/FUSOU-TLSN-VERIFICATION-WORKER/package.json")).dependencies.jose, "6.1.2");
});
test("fixture byte drift is rejected by digest checks before key import or signature verification", () => {
  assert.throws(() => assertPinnedVector({ ...vector, jwt: `${vector.jwt}\n` }), /Fixed JWT SHA-256 mismatch/);
  assert.throws(() => assertPinnedVector({ ...vector, spki: `${vector.spki}\n` }), /Fixed public SPKI SHA-256 mismatch/);
  assert.throws(() => assertPinnedVector({ ...vector, spki: vector.spki.replaceAll("\n", "\r\n") }), /Fixed public SPKI SHA-256 mismatch/);
  assertPinnedVector();
});
test("STATIC_VECTOR_VERIFIED: real importSPKI and jwtVerify return exactly the generic published payload", async () => {
  const { payload, protectedHeader } = await verifyGeneric();
  assert.deepEqual(payload, EXPECTED_PAYLOAD);
  assert.deepEqual(protectedHeader, { alg: "RS256" });
  for (const name of ["exp", "repository", "repository_id", "repository_owner", "repository_owner_id",
    "workflow_ref", "workflow_sha", "job_workflow_ref", "job_workflow_sha", "run_id", "run_attempt"]) {
    assert.equal(Object.hasOwn(payload, name), false);
  }
});
test("SIGNATURE_TAMPER_REJECTED: a changed signature fails real RS256 verification without changing the original vector", async () => {
  const [header, payload, signature] = vector.jwt.split(".");
  const changedSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  const tampered = `${header}.${payload}.${changedSignature}`;
  assert.notEqual(tampered, vector.jwt);
  await assert.rejects(verifyGeneric(tampered), (error) =>
    error instanceof errors.JWSSignatureVerificationFailed && error.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED");
  assertPinnedVector();
});
test("the unchanged signed vector enforces issuer, audience, required exp and fixed-time maximum-age rules", async () => {
  for (const { options, claim, expired = false } of [
    { options: { issuer: GITHUB_OIDC_ISSUER }, claim: "iss" },
    { options: { audience: "https://archive.example.test/internal/tlsn/archive-readback/v1" }, claim: "aud" },
    { options: { requiredClaims: ["iat", "iss", "aud", "exp"] }, claim: "exp" },
    { options: { currentDate: new Date((EXPECTED_PAYLOAD.iat + 61) * 1000) }, claim: "iat", expired: true },
    { options: { currentDate: new Date((EXPECTED_PAYLOAD.iat - 1) * 1000) }, claim: "iat" },
  ]) {
    await assert.rejects(verifyGeneric(vector.jwt, options), (error) =>
      error instanceof (expired ? errors.JWTExpired : errors.JWTClaimValidationFailed) && error.claim === claim);
  }
});
test("OIDC_CLAIM_POLICY_REJECTED: a real verified generic payload does not satisfy the independent GitHub identity policy", async () => {
  const t = await provenanceFixture(), policy = await validateArchiveTransportSpec(t.spec);
  const { payload } = await verifyGeneric();
  assert.notEqual(payload.aud, policy.audience);
  assert.equal(Object.hasOwn(payload, "repository_id"), false);
  assert.equal(Object.hasOwn(payload, "repository_owner_id"), false);
  assert.throws(() => assertVerifiedArchiveOidcClaims(payload, policy, NOW), (error) =>
    error.code === "ARCHIVE_OIDC_CLAIMS_INVALID" && error.status === 401);
  assert.deepEqual(payload, EXPECTED_PAYLOAD);
});
test("OIDC_REPOSITORY_IDENTITY_REJECTED: the unchanged verified payload passes audience comparison then lacks repository", async () => {
  const { payload, protectedHeader } = await verifyGeneric();
  assert.deepEqual(protectedHeader, { alg: "RS256" });
  assert.deepEqual(payload, EXPECTED_PAYLOAD);
  const policyReads = [];
  // Observe only test-policy reads, never replace or modify the verified payload.
  const policy = new Proxy(Object.freeze({
    repository: "tsukasa-u/FUSOU", repository_id: "7", repository_owner_id: "11",
    workflow_ref: ARCHIVE_WORKFLOW_REF, event_name: "workflow_run", ref: "refs/heads/main",
    audience: EXPECTED_PAYLOAD.aud, clock_skew_seconds: 0,
  }), { get(target, key, receiver) {
    policyReads.push(key); return Reflect.get(target, key, receiver);
  } });
  assertArchiveIdentityPolicy(policy);
  assert.equal(payload.iss, EXPECTED_PAYLOAD.iss);
  assert.equal(payload.aud, policy.audience);
  for (const name of ["repository", "repository_id", "repository_owner", "repository_owner_id"]) {
    assert.equal(Object.hasOwn(payload, name), false);
  }
  assert.equal(payload.repository, undefined);
  assert.notEqual(payload.repository, policy.repository);
  policyReads.length = 0;
  assert.throws(() => assertVerifiedArchiveOidcClaims(payload, policy, NOW), (error) => {
    assert(error instanceof ArchiveTransportError);
    assert.equal(error.code, "ARCHIVE_OIDC_CLAIMS_INVALID");
    assert.equal(error.status, 401);
    assert.equal(error.message, "ARCHIVE_OIDC_CLAIMS_INVALID");
    return true;
  });
  const audienceComparison = policyReads.indexOf("audience");
  assert(audienceComparison >= 0);
  assert.deepEqual(policyReads.slice(audienceComparison), ["audience", "repository"]);
  assert.deepEqual(payload, EXPECTED_PAYLOAD);
});
test("the original token fails the production kid gate; body self-claims cannot create HTTP binding or acquisition output", async () => {
  const t = await provenanceFixture(), policy = await validateArchiveTransportSpec(t.spec);
  Object.assign(policy.grants[0], { not_before_ms: NOW - 1000, expires_at_ms: NOW + 10_000 });
  const spec = { policy, policy_sha256: sha256(archivePolicyBytes(policy)) };
  await validateArchiveTransportSpec(spec);
  let keyRequests = 0, stateReads = 0, objectReads = 0;
  const verifier = createArchiveOidcVerifier({ fetchKeys: async () => {
    keyRequests++; throw new Error("Unexpected JWKS request");
  } });
  await assert.rejects(verifier(vector.jwt, policy, NOW), (error) =>
    error.code === "ARCHIVE_OIDC_HEADER_INVALID" && error.status === 401);
  const options = { policyRaw: new TextDecoder().decode(archivePolicyBytes(policy)), policySha256: spec.policy_sha256,
    authority: { getConsumedVerificationResult: async () => { stateReads++; throw new Error("Unexpected authority read"); } },
    bucket: { get: async () => { objectReads++; throw new Error("Unexpected object read"); } } };
  const dependencies = { verifyToken: verifier, now: () => NOW };
  const input = archiveReadRequest(t.f.context, t.f.checkPolicy.archive, "result");
  for (const body of [input, { ...input, repository_id: "7", repository_owner_id: "11", approved: true }]) {
    const response = await handleArchiveHttp(new Request(policy.endpoint, { method: "POST",
      headers: { authorization: `Bearer ${vector.jwt}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    options, dependencies);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "ARCHIVE_OIDC_HEADER_INVALID" });
  }
  const audiences = [], urls = [], statuses = [];
  await assert.rejects(acquireArchiveHttp({ spec, context: t.f.context, expected: t.f.checkPolicy.archive }, {
    getToken: async (audience) => { audiences.push(audience); return vector.jwt; },
    fetchArchive: async (url, init) => {
      urls.push(url);
      const response = await handleArchiveHttp(new Request(url, init), options, dependencies);
      statuses.push(response.status); return response;
    }, now: () => NOW,
  }), /ARCHIVE_HTTP_REQUEST_FAILED/);
  assert.deepEqual(audiences, [policy.audience]); assert.deepEqual(urls, [policy.endpoint]); assert.deepEqual(statuses, [401]);
  assert.equal(keyRequests, 0); assert.equal(stateReads, 0); assert.equal(objectReads, 0);
});
