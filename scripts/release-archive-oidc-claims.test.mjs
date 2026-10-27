// Key-free contract tests: payloads model jwtVerify output, not authenticated real tokens.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readRegularFile } from "./release-files.mjs";
import { provenanceFixture } from "./release-provenance-fixture.mjs";
import { acquireArchiveHttp } from "./release-archive-http.mjs";
import { readDelegationBootstrapSources, inspectDelegationBootstrap } from "./release-grant-delegation.mjs";
import { WORKER_ROOT, WORKER_SOURCE_PATHS } from "./release-worker-source.mjs";
import { sha256 } from "./release-bytes.mjs";
import { assertVerifiedArchiveOidcClaims } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc-claims.mjs";
import { handleArchiveHttp } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs";
import {
  ARCHIVE_HTTP_PATH, ARCHIVE_WORKFLOW_REF, archivePolicyBytes, archiveReadRequest, archiveAuthorization,
  assertArchiveIdentityPolicy, isCanonicalGitHubId, encodeArchiveBytes, validateArchiveTransportSpec, verifyArchiveHttpResponse,
} from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";

const now = 1000;
const identityPolicy = () => ({
  repository: "tsukasa-u/FUSOU", repository_id: "7", repository_owner_id: "11",
  workflow_ref: ARCHIVE_WORKFLOW_REF, event_name: "workflow_run", ref: "refs/heads/main",
  audience: `https://archive.example.test${ARCHIVE_HTTP_PATH}`, clock_skew_seconds: 0,
});
const claims = (policy) => ({
  aud: policy.audience, repository: policy.repository, repository_id: policy.repository_id,
  repository_owner: "tsukasa-u", repository_owner_id: policy.repository_owner_id,
  workflow_ref: policy.workflow_ref, workflow_sha: policy.grants?.[0].workflow_sha ?? "b".repeat(40),
  event_name: policy.event_name, ref: policy.ref, run_id: String(policy.grants?.[0].run_id ?? 30),
  run_attempt: String(policy.grants?.[0].run_attempt ?? 1), iat: 1, exp: 61,
  sub: "opaque-subject-not-an-identity-source",
});
const rejects = (fn, code = "ARCHIVE_OIDC_CLAIMS_INVALID", status = 401) =>
  assert.throws(fn, (error) => {
    assert.equal(error.code, code); assert.equal(error.status, status);
    assert.equal(error.message, code);
    return true;
  });
const pin = (policy) => ({ policy, policy_sha256: sha256(archivePolicyBytes(policy)) });

test("repository and owner IDs both strictly match, with no identity coercion or authorization output", () => {
  const policy = identityPolicy(), payload = claims(policy);
  assert.equal(assertVerifiedArchiveOidcClaims(payload, policy, now), undefined);
  policy.repository_owner_id = "9007199254740993";
  payload.repository_owner_id = policy.repository_owner_id;
  assert.equal(assertVerifiedArchiveOidcClaims(payload, policy, now), undefined);
  payload.repository_owner_id = "9007199254740992";
  rejects(() => assertVerifiedArchiveOidcClaims(payload, policy, now));
});
test("missing and mismatched owner IDs reject even when repository ID and owner name match", () => {
  for (const owner of [undefined, null, "12", 11, 0, "", "0", "011", "+11", "11.0", "1.1e1", " 11", "11 ", "11\n", "\n11", "\u0661\u0661", true]) {
    const policy = identityPolicy(), payload = { ...claims(policy), repository_owner_id: owner };
    assert.equal(payload.repository_id, policy.repository_id);
    rejects(() => assertVerifiedArchiveOidcClaims(payload, policy, now));
  }
});
test("independent owner policy pin is required and canonical, not inferred from a name or claim", () => {
  for (const owner of [undefined, null, 11, "", "0", "011", "-11", " 11", false]) {
    const policy = { ...identityPolicy(), repository_owner_id: owner };
    const payload = { ...claims(identityPolicy()), repository_owner_id: "11" };
    rejects(() => assertVerifiedArchiveOidcClaims(payload, policy, now), "ARCHIVE_HTTP_POLICY_INVALID", 503);
  }
});
test("repository IDs remain canonical and independently checked alongside owner IDs", () => {
  for (const id of [undefined, null, 7, "8", "07", "0", "", true]) {
    const policy = identityPolicy();
    rejects(() => assertVerifiedArchiveOidcClaims({ ...claims(policy), repository_id: id }, policy, now));
  }
  for (const id of [undefined, null, 7, "07", "0"]) {
    rejects(() => assertArchiveIdentityPolicy({ ...identityPolicy(), repository_id: id }), "ARCHIVE_HTTP_POLICY_INVALID", 503);
  }
});
test("owner name must agree with the independently pinned repository owner; names and sub cannot supply IDs", () => {
  const policy = identityPolicy();
  for (const name of [undefined, null, 11, "foreign-owner", "tsukasa-u/other", "Tsukasa-u"]) {
    rejects(() => assertVerifiedArchiveOidcClaims({ ...claims(policy), repository_owner: name }, policy, now));
  }
  for (const sub of ["legacy-looking", "immutable-looking", "unrelated-format"]) {
    const payload = { ...claims(policy), sub };
    assert.equal(assertVerifiedArchiveOidcClaims(payload, policy, now), undefined);
    delete payload.repository_owner_id;
    rejects(() => assertVerifiedArchiveOidcClaims(payload, policy, now));
  }
});
test("caller workflow/run/event/ref/audience and time-order refusal conditions are preserved", () => {
  const policy = identityPolicy();
  for (const change of [
    { aud: "foreign" }, { repository: "foreign/FUSOU" }, { workflow_ref: "foreign.yml" },
    { workflow_sha: undefined }, { workflow_sha: "main" }, { event_name: "push" }, { ref: "refs/heads/other" },
    { run_id: undefined }, { run_id: 30 }, { run_id: "0" }, { run_id: "9007199254740992" },
    { run_attempt: 1 }, { run_attempt: "0" }, { iat: undefined }, { iat: 2 }, { exp: undefined }, { exp: 1 },
  ]) rejects(() => assertVerifiedArchiveOidcClaims({ ...claims(policy), ...change }, policy, now));
});
test("configured reusable identity requires both matching claims without replacing caller identity", () => {
  const policy = { ...identityPolicy(), job_workflow_ref: ARCHIVE_WORKFLOW_REF, job_workflow_sha: "c".repeat(40) };
  const payload = { ...claims(policy), job_workflow_ref: policy.job_workflow_ref, job_workflow_sha: policy.job_workflow_sha };
  assert.equal(assertVerifiedArchiveOidcClaims(payload, policy, now), undefined);
  for (const change of [
    { job_workflow_ref: undefined }, { job_workflow_sha: undefined }, { job_workflow_ref: "other.yml" },
    { job_workflow_sha: "b".repeat(40) }, { workflow_ref: "other.yml" }, { workflow_sha: "not-a-sha" },
  ]) rejects(() => assertVerifiedArchiveOidcClaims({ ...payload, ...change }, policy, now));
  for (const change of [
    { job_workflow_ref: undefined }, { job_workflow_sha: undefined },
    { job_workflow_ref: "tsukasa-u/FUSOU/.github/workflows/tlsn-grant-delegation.yml@refs/heads/main" },
  ]) rejects(() => assertVerifiedArchiveOidcClaims(payload, { ...policy, ...change }, now), "ARCHIVE_HTTP_POLICY_INVALID", 503);
});
test("missing owner policy is rejected by pinned transport validation and client before token acquisition", async () => {
  const t = await provenanceFixture(), policy = structuredClone(t.spec.policy);
  delete policy.repository_owner_id;
  const spec = pin(policy);
  await assert.rejects(validateArchiveTransportSpec(spec), (error) => error.code === "ARCHIVE_HTTP_POLICY_INVALID" && error.status === 503);
  let tokenCalls = 0, fetches = 0;
  await assert.rejects(acquireArchiveHttp({ spec, context: t.f.context, expected: t.f.checkPolicy.archive }, {
    getToken: async () => { tokenCalls++; throw new Error("unexpected token acquisition"); },
    fetchArchive: async () => { fetches++; throw new Error("unexpected HTTP"); }, now: () => now,
  }), /ARCHIVE_HTTP_POLICY_INVALID/);
  assert.equal(tokenCalls, 0); assert.equal(fetches, 0);
});
test("request owner claims and producer approval labels cannot replace registered policy or signed owner claims", async () => {
  const t = await provenanceFixture(), policy = t.spec.policy;
  const body = { ...archiveReadRequest(t.f.context, t.f.checkPolicy.archive, "result"),
    repository_owner_id: "11", authenticated: true, approved: true };
  let verifications = 0, stateReads = 0, objectReads = 0;
  const options = { policyRaw: new TextDecoder().decode(archivePolicyBytes(policy)), policySha256: t.spec.policy_sha256,
    authority: { getConsumedVerificationResult: async () => { stateReads++; throw new Error("unexpected state read"); } },
    bucket: { get: async () => { objectReads++; throw new Error("unexpected object read"); } } };
  const request = () => new Request(policy.endpoint, { method: "POST",
    headers: { authorization: "Bearer synthetic.synthetic.synthetic", "content-type": "application/json" }, body: JSON.stringify(body) });
  const dependencies = (owner) => ({ now: () => now, verifyToken: async () => {
    verifications++;
    const payload = { ...claims(policy), repository_owner_id: owner };
    assertVerifiedArchiveOidcClaims(payload, policy, now); return payload;
  } });
  for (const owner of [undefined, "12", 11]) {
    const response = await handleArchiveHttp(request(), options, dependencies(owner));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "ARCHIVE_OIDC_CLAIMS_INVALID" });
  }
  const before = verifications;
  for (const change of [
    { policyRaw: undefined }, { policySha256: undefined }, { policySha256: "x".repeat(43) },
    { policyRaw: JSON.stringify({ ...policy, approved: true, authenticated: true }) },
  ]) {
    const response = await handleArchiveHttp(request(), { ...options, ...change }, dependencies("11"));
    assert.equal(response.status, 503);
    const error = await response.text();
    assert(!error.includes("synthetic.synthetic.synthetic"));
    assert(!error.includes("repository_owner_id"));
  }
  assert.equal(verifications, before);
  assert.equal((await handleArchiveHttp(request(), options, dependencies("11"))).status, 400);
  assert.equal(stateReads, 0); assert.equal(objectReads, 0);
});
test("PROPOSED bootstrap policy is not a registered archive authorization policy even with a local digest", async () => {
  const { policy } = await readDelegationBootstrapSources();
  await assert.rejects(validateArchiveTransportSpec(pin(policy)), /ARCHIVE_HTTP_POLICY_INVALID/);
  const report = inspectDelegationBootstrap(await readDelegationBootstrapSources());
  assert.equal(report.policy_approval.status, "BLOCKED_POLICY_NOT_APPROVED");
  assert.equal(report.external_registration.status, "NOT_VERIFIED");
  assert.equal(report.publication_authorized, false);
  assert.equal(report.readiness.complete, false);
  assert.equal(report.offline_verification, "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED");
  assert(report.implementation.blockers.includes("ARCHIVE_GRANT_AUTHORITY_READER_NOT_REGISTERED"));
  assert(report.implementation.blockers.includes("ARCHIVE_GRANT_PUBLICATION_PROVIDER_NOT_REGISTERED"));
});
test("consumer raw-response authorization includes the pinned owner ID and rejects missing or altered owner binding", async () => {
  const t = await provenanceFixture(), policy = await validateArchiveTransportSpec(t.spec);
  const request = archiveReadRequest(t.f.context, t.f.checkPolicy.archive, "result");
  const response = { schema_version: 1, scope: "fusou-archive-http-response-v1",
    authorization: archiveAuthorization(policy, t.spec.policy_sha256, request), observed_at_ms: now,
    catalog: t.consumed.archive_catalog, bytes: encodeArchiveBytes(t.f.saved.get("result")) };
  const options = { spec: t.spec, policy, request, expected: t.f.checkPolicy.archive, nowMs: now };
  assert.equal(response.authorization.repository_owner_id, policy.repository_owner_id);
  assert.deepEqual((await verifyArchiveHttpResponse(archivePolicyBytes(response), options)).bytes, Uint8Array.from(t.f.saved.get("result")));
  for (const owner of [undefined, "12", 11]) {
    const changed = structuredClone(response);
    if (owner === undefined) delete changed.authorization.repository_owner_id;
    else changed.authorization.repository_owner_id = owner;
    await assert.rejects(verifyArchiveHttpResponse(archivePolicyBytes(changed), options), /ARCHIVE_HTTP_RESPONSE_CONTEXT/);
  }
});
test("JWT signature verification precedes claim-policy assertion and the new module is included in Worker source inputs", async () => {
  const source = (await readRegularFile(new URL(
    "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs", import.meta.url))).toString("utf8");
  const verified = source.indexOf("await jwtVerify(");
  const checked = source.indexOf("assertVerifiedArchiveOidcClaims(payload, policy, nowMs)");
  assert(verified >= 0 && checked > verified && source.indexOf("return payload", checked) > checked);
  assert.match(source, /"repository_owner",\s*"repository_owner_id"/);
  assert.match(source, /policy\.job_workflow_ref === undefined \? \[\] : \["job_workflow_ref", "job_workflow_sha"\]/);
  assert.doesNotMatch(source, /decodeJwt|payload\.sub|subject:/);
  assert(WORKER_SOURCE_PATHS.includes(`${WORKER_ROOT}/src/archive-oidc-claims.mjs`));
});
test("bootstrap owner ID string format matches the strict runtime identity policy while null stays nonoperational", async () => {
  const { schema, policy } = await readDelegationBootstrapSources();
  const pattern = new RegExp(schema.properties.repository_owner_id.pattern, "u");
  for (const value of ["11", "7", "9007199254740993", "", "0", "011", "+11", " 11", "11\n", "11.0"]) {
    assert.equal(isCanonicalGitHubId(value), pattern.test(value));
  }
  assert.equal(policy.repository_owner_id, null);
  assert.equal(isCanonicalGitHubId(policy.repository_owner_id), false);
});
