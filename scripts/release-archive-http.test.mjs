// Ephemeral RSA test keys stay in memory. All JWKS/HTTP/GitHub/R2 operations are local doubles.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/node_modules/jose/dist/webapi/index.js";
import { checkFixture } from "./release-check-fixture.mjs";
import { jsonBytes, verifyArchiveReadback } from "./release-checks.mjs";
import { sha256 } from "./release-bytes.mjs";
import { collectReleaseEvidence } from "./release-evidence-producer.mjs";
import { produceArchiveJob } from "./release-archive-job.mjs";
import { acquireArchiveHttp, requestActionsArchiveToken, verifyArchiveHttpExecution } from "./release-archive-http.mjs";
import { consumeReleaseRun } from "./release-consumer.mjs";
import { decodeReleaseTransport, encodeReleaseTransport } from "./release-transport.mjs";
import { EXECUTION_ORIGIN_FILE, executionSubject } from "./release-execution-origin.mjs";
import { archiveCustomMetadata } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-readback.mjs";
import { createConsumedArchiveCatalog } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-catalog.mjs";
import { ARCHIVE_HTTP_PATH, ARCHIVE_WORKFLOW_REF, GITHUB_OIDC_ISSUER, archiveReadRequest, archivePolicyBytes,
  boundedBody, encodeArchiveBytes, validateArchiveTransportSpec, verifyArchiveHttpResponse } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";
import { createArchiveOidcVerifier, GITHUB_OIDC_JWKS } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-oidc.mjs";
import { handleArchiveHttp } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http.mjs";

const [key, otherKey] = await Promise.all([generateKeyPair("RS256"), generateKeyPair("RS256")]);
const jwk = { ...await exportJWK(key.publicKey), alg: "RS256", use: "sig", kid: "synthetic-key" };
const otherJwk = { ...await exportJWK(otherKey.publicKey), alg: "RS256", use: "sig", kid: "rotated-key" };

async function fixture() {
  const f = await checkFixture(), expected = f.checkPolicy.archive, now = 1000;
  const endpoint = `https://archive.example.test${ARCHIVE_HTTP_PATH}`;
  expected.capture_id = expected.objects.result.binding_id;
  for (const o of Object.values(expected.objects)) Object.assign(o, { capture_id: expected.capture_id, backend_id: endpoint });
  const identity = { repository: "tsukasa-u/FUSOU", workflow_ref: ARCHIVE_WORKFLOW_REF, workflow_sha: f.context.workflow_sha,
    event_name: "workflow_run", ref: "refs/heads/main", run_id: f.context.run_id, run_attempt: f.context.run_attempt };
  const grant = { source_sha: f.context.source_sha, workflow_sha: f.context.workflow_sha, run_id: f.context.run_id,
    run_attempt: f.context.run_attempt, capture_id: expected.capture_id, binding_id: expected.capture_id,
    verification_attempt_id: expected.objects.result.verification_attempt_id,
    lookup: { session_id: expected.session_id, canonical_user_id: "synthetic-user", device_id: "synthetic-device",
      verification_job_id: expected.objects.result.job_id },
    not_before_ms: 0, expires_at_ms: 100_000, capture_not_before_ms: 0, capture_max_age_ms: 50_000 };
  const policy = { schema_version: 1, scope: "fusou-github-oidc-archive-read-v1", endpoint, audience: endpoint,
    repository: "tsukasa-u/FUSOU", repository_id: "7", repository_owner_id: "11", workflow_ref: ARCHIVE_WORKFLOW_REF, event_name: "workflow_run",
    ref: "refs/heads/main", clock_skew_seconds: 0, max_token_age_seconds: 60, max_object_bytes: 4096, grants: [grant] };
  const spec = { policy, policy_sha256: sha256(archivePolicyBytes(policy)) };
  const claims = { iss: GITHUB_OIDC_ISSUER, aud: endpoint, iat: 1, exp: 61, nbf: 0, sub: "not-a-legacy-sub-format",
    repository: policy.repository, repository_id: policy.repository_id,
    repository_owner: "tsukasa-u", repository_owner_id: policy.repository_owner_id, workflow_ref: policy.workflow_ref,
    workflow_sha: f.context.workflow_sha, event_name: policy.event_name, ref: policy.ref,
    run_id: String(f.context.run_id), run_attempt: String(f.context.run_attempt), sha: f.context.workflow_sha };
  const sign = (payload = claims, header = {}, privateKey = key.privateKey) =>
    new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "JWT", ...header }).sign(privateKey);
  const keyRequests = [], reads = [];
  const verifyToken = createArchiveOidcVerifier({ fetchKeys: async (url, options) => {
    keyRequests.push({ url, options }); return Response.json({ keys: [jwk] });
  } });
  const record = { ...grant.lookup, ...f.context, status: "consumed", binding_id: grant.binding_id,
    verification_job_id: grant.lookup.verification_job_id, verification_attempt_id: grant.verification_attempt_id,
    result_object_key: expected.objects.result.object_key, result_sha256: expected.objects.result.sha256,
    presentation_id: expected.objects.presentation.sha256, used_at: new Date(850).toISOString(), archive_catalog_created_at: new Date(900).toISOString() };
  const snapshots = Object.values(expected.objects).map(({ capture_id, backend_id, ...o }) => ({ ...o, byte_length: f.saved.get(o.role).byteLength }));
  const consumed = { record, bytes: Uint8Array.from(f.saved.get("result")), verifier_execution_receipt_bytes: Buffer.from("synthetic-receipt") };
  consumed.archive_catalog = await createConsumedArchiveCatalog(record, snapshots, consumed.bytes, consumed.verifier_execution_receipt_bytes);
  const authority = { getConsumedVerificationResult: async (captureId, lookup) => {
    assert.equal(captureId, grant.capture_id); assert.deepEqual(lookup, grant.lookup); return structuredClone(consumed);
  } };
  const objects = new Map(Object.values(expected.objects).map((o) => [o.object_key, {
    version: o.version_id, customMetadata: archiveCustomMetadata(o.role, o), bytes: Uint8Array.from(f.saved.get(o.role)),
  }]));
  const bucket = { get: async (objectKey) => {
    reads.push(objectKey);
    const o = objects.get(objectKey);
    return o ? { ...o, size: o.bytes.byteLength, arrayBuffer: async () => Uint8Array.from(o.bytes).buffer } : null;
  } };
  const options = () => ({ policyRaw: new TextDecoder().decode(archivePolicyBytes(policy)), policySha256: spec.policy_sha256, authority, bucket });
  const request = (role = "result") => archiveReadRequest(f.context, expected, role);
  const call = async ({ payload, header, privateKey, method = "POST", body = request(), token, url = endpoint, serverOptions,
    verifier = verifyToken, time = now } = {}) => {
    const authorization = token ?? await sign(payload, header, privateKey);
    return handleArchiveHttp(new Request(url, { method, headers: { authorization: `Bearer ${authorization}`, "content-type": "application/json" },
      ...(["GET", "HEAD"].includes(method) ? {} : { body: JSON.stringify(body) }) }),
    serverOptions ?? options(), { verifyToken: verifier, now: () => time });
  };
  const httpDependencies = { getToken: async () => sign(), fetchArchive: async (url, init) =>
    handleArchiveHttp(new Request(url, init), options(), { verifyToken, now: () => now }) };
  return { f, expected, identity, grant, policy, spec, claims, sign, verifyToken, keyRequests, consumed, authority, objects, bucket,
    reads, options, request, call, httpDependencies, now };
}

test("RS256 issuer/audience and signed non-legacy claims authorize only the independent grant/catalog object", async () => {
  const t = await fixture(), response = await t.call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.bytes, encodeArchiveBytes(t.f.saved.get("result")));
  assert.equal(result.authorization.kind, "TRUSTED_PRODUCER_HTTPS_FETCH");
  assert.equal(result.authorization.source_sha, t.f.context.source_sha);
  assert.notEqual(result.authorization.workflow_sha, result.authorization.source_sha);
  assert.equal(result.catalog.retention_status, "NOT_CHECKED");
  assert.deepEqual(t.reads, [t.expected.objects.result.object_key]);
  assert.deepEqual(t.keyRequests.map((r) => r.url), [GITHUB_OIDC_JWKS]);
  assert.equal(t.keyRequests[0].options.redirect, "error");
});
for (const [field, value] of Object.entries({ iss: "https://attacker.example.test", aud: "another-audience", exp: 0, iat: 100, nbf: 100,
  repository: "attacker/FUSOU", repository_id: "8", workflow_ref: "attacker/workflow@refs/heads/main",
  workflow_sha: "c".repeat(40), event_name: "pull_request", ref: "refs/heads/untrusted", run_id: "31", run_attempt: "2" })) {
  test(`signed claim ${field} is compared against independent policy/runtime grant, never against itself`, async () => {
    const t = await fixture(), response = await t.call({ payload: { ...t.claims, [field]: value } });
    assert.ok([401, 403].includes(response.status)); assert.deepEqual(t.reads, []);
  });
}
for (const field of ["exp", "iat", "repository_id", "repository_owner", "repository_owner_id", "workflow_sha", "run_id", "run_attempt"]) {
  test(`missing signed ${field} fails before any authority-backed R2 read`, async () => {
    const t = await fixture(), claims = { ...t.claims }; delete claims[field];
    assert.equal((await t.call({ payload: claims })).status, 401); assert.deepEqual(t.reads, []);
  });
}
test("invalid RSA signature, raw JWT payload mutation and unsupported algorithm are rejected", async () => {
  const t = await fixture();
  assert.equal((await t.call({ privateKey: otherKey.privateKey })).status, 401);
  const token = await t.sign(), parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ ...t.claims, sha: t.f.context.source_sha })).toString("base64url");
  assert.equal((await t.call({ token: parts.join(".") })).status, 401);
  const hmac = await new SignJWT(t.claims).setProtectedHeader({ alg: "HS256", kid: jwk.kid }).sign(new Uint8Array(32).fill(7));
  assert.equal((await t.call({ token: hmac })).status, 401);
  assert.deepEqual(t.reads, []);
});
for (const header of [{ jku: "https://attacker.test/jwks" }, { jwk }, { x5u: "https://attacker.test/cert" }, { kid: "unknown" }]) {
  test(`token-supplied key selector ${Object.keys(header)[0]} never chooses an attacker key source`, async () => {
    const t = await fixture();
    assert.equal((await t.call({ header })).status, 401);
    assert.ok(t.keyRequests.every((r) => r.url === GITHUB_OIDC_JWKS)); assert.deepEqual(t.reads, []);
  });
}
test("unknown kid refreshes only the fixed issuer JWKS; unavailable keys and refresh failure fail closed", async () => {
  const t = await fixture(); let count = 0;
  const verifier = createArchiveOidcVerifier({ cooldownDuration: 0, fetchKeys: async (url) => {
    assert.equal(url, GITHUB_OIDC_JWKS); count++; return Response.json({ keys: count === 1 ? [jwk] : [jwk, otherJwk] });
  } });
  assert.equal((await t.call({ verifier })).status, 200);
  assert.equal((await t.call({ verifier, header: { kid: otherJwk.kid }, privateKey: otherKey.privateKey })).status, 200);
  assert.equal(count, 2);
  let calls = 0;
  const unavailable = createArchiveOidcVerifier({ cooldownDuration: 0, fetchKeys: async () => {
    if (++calls > 1) throw new Error("synthetic key service down"); return Response.json({ keys: [jwk] });
  } });
  assert.equal((await t.call({ verifier: unavailable })).status, 200);
  assert.equal((await t.call({ verifier: unavailable, header: { kid: otherJwk.kid }, privateKey: otherKey.privateKey })).status, 503);
  const missing = createArchiveOidcVerifier({ fetchKeys: async () => { throw new Error("no keys"); } });
  assert.equal((await t.call({ verifier: missing })).status, 503);
});
test("JWT sha is not release source authority; swapping workflow SHA and release SHA is rejected", async () => {
  const t = await fixture();
  assert.equal((await t.call({ payload: { ...t.claims, sha: "d".repeat(40) } })).status, 200);
  t.reads.length = 0;
  assert.equal((await t.call({ body: { ...t.request(), workflow_sha: t.f.context.source_sha } })).status, 403);
  assert.equal((await t.call({ body: { ...t.request(), source_sha: t.f.context.workflow_sha } })).status, 403);
  assert.deepEqual(t.reads, []);
});
for (const method of ["GET", "HEAD", "PUT", "DELETE", "PATCH"]) {
  test(`authenticated ${method} cannot perform archive reads, writes or deletion`, async () => {
    const t = await fixture(); assert.equal((await t.call({ method })).status, 405); assert.deepEqual(t.reads, []);
  });
}
for (const mutation of ["object_key", "list", "role", "capture_id", "session_id", "job_id", "verification_attempt_id", "binding_id"]) {
  test(`request ${mutation} cannot override the independent authority target`, async () => {
    const t = await fixture(), body = { ...t.request(), [mutation]: "foreign" };
    if (mutation === "capture_id" || mutation === "binding_id") body[mutation] = "C".repeat(43);
    assert.ok([400, 403].includes((await t.call({ body })).status)); assert.deepEqual(t.reads, []);
  });
}
test("unknown authority capture, expired authorization grant and stale capture are rejected before R2", async () => {
  const t = await fixture();
  t.authority.getConsumedVerificationResult = async () => null;
  assert.equal((await t.call()).status, 404);
  const u = await fixture();
  assert.equal((await u.call({ time: 100_000, payload: { ...u.claims, iat: 100, exp: 160 } })).status, 403);
  u.consumed.record.archive_catalog_created_at = new Date(0).toISOString();
  u.consumed.archive_catalog = await createConsumedArchiveCatalog(u.consumed.record, Object.values(u.consumed.archive_catalog.objects),
    u.consumed.bytes, u.consumed.verifier_execution_receipt_bytes);
  assert.equal((await u.call({ time: 60_000 })).status, 403);
  assert.deepEqual(t.reads, []); assert.deepEqual(u.reads, []);
});
for (const mutation of ["version", "bytes", "size", "missing", "metadata", "get failure", "body failure"]) {
  test(`catalog expected version/length/digest/target is independent of R2 ${mutation}`, async () => {
    const t = await fixture(), object = t.objects.get(t.expected.objects.result.object_key);
    if (mutation === "version") object.version = "overwritten";
    if (mutation === "bytes") object.bytes[0] ^= 1;
    if (mutation === "size") object.bytes = new Uint8Array(5000);
    if (mutation === "missing") t.objects.clear();
    if (mutation === "metadata") object.customMetadata.fusou_job_id = "foreign";
    if (mutation === "get failure") t.bucket.get = async () => { throw new Error("synthetic R2 down"); };
    if (mutation === "body failure") t.bucket.get = async () => ({ ...object, size: 100, arrayBuffer: async () => { throw new Error("body failed"); } });
    assert.equal((await t.call()).status, 502);
  });
}
test("missing/mismatched policy and reused-workflow claims fail closed; no request supplies the expected pin", async () => {
  const t = await fixture();
  assert.equal((await t.call({ serverOptions: { ...t.options(), policyRaw: undefined } })).status, 503);
  assert.equal((await t.call({ serverOptions: { ...t.options(), policySha256: "X".repeat(43) } })).status, 503);
  t.policy.job_workflow_ref = ARCHIVE_WORKFLOW_REF; t.policy.job_workflow_sha = t.f.context.workflow_sha;
  t.spec.policy_sha256 = sha256(archivePolicyBytes(t.policy));
  assert.equal((await t.call()).status, 401);
  assert.equal((await t.call({ payload: { ...t.claims, job_workflow_ref: ARCHIVE_WORKFLOW_REF, job_workflow_sha: t.f.context.workflow_sha } })).status, 200);
});
test("clock skew is bounded; old iat, future nbf/iat, missing exp and audience arrays do not bypass checks", async () => {
  const t = await fixture();
  for (const claims of [{ ...t.claims, iat: -100 }, { ...t.claims, aud: [t.policy.audience] }, { ...t.claims, iat: 2 }]) {
    assert.equal((await t.call({ payload: claims })).status, 401);
  }
  t.policy.clock_skew_seconds = 2; t.spec.policy_sha256 = sha256(archivePolicyBytes(t.policy));
  assert.equal((await t.call({ payload: { ...t.claims, nbf: 2, iat: 2 } })).status, 200);
  assert.equal((await t.call({ payload: { ...t.claims, nbf: 4 } })).status, 401);
});
test("Actions token acquisition uses only runner credential and policy audience; token is never a report field", async () => {
  const t = await fixture(), calls = [], token = await t.sign();
  const environment = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/test?api-version=2",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-runner-credential" };
  assert.equal(await requestActionsArchiveToken(t.policy.audience, { environment, fetchToken: async (url, init) => {
    calls.push({ url, init }); return Response.json({ value: token });
  } }), token);
  assert.equal(new URL(calls[0].url).searchParams.get("audience"), t.policy.audience);
  assert.equal(calls[0].init.redirect, "error");
  await assert.rejects(requestActionsArchiveToken(t.policy.audience, { environment: {}, fetchToken: async () => assert.fail("no fetch") }),
    /CREDENTIALS_MISSING/);
  await assert.rejects(requestActionsArchiveToken(t.policy.audience, { environment: { ...environment, ACTIONS_ID_TOKEN_REQUEST_URL: "https://attacker.test" } }),
    /URL_INVALID/);
});
test("HTTP acquisition and producer record preserve raw responses; consumer validators recheck every input and do not claim native crypto", async () => {
  const t = await fixture(), f = t.f;
  f.checkPolicy.archive_transport = t.spec;
  const options = { report: f.report, identity: t.identity, checkPolicyBytes: jsonBytes(f.checkPolicy), checkPolicySha256: sha256(jsonBytes(f.checkPolicy)) };
  const production = await collectReleaseEvidence(options, { httpDependencies: t.httpDependencies, now: () => t.now });
  assert.equal(production.report.checks.archive_readback.acquisition, "TRUSTED_PRODUCER_HTTPS_FETCH");
  assert.equal(production.report.checks.offline_verification.blocker, "FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED");
  const execution = production.executions.get("archive_readback"), receipt = JSON.parse(execution.receipt);
  const inputs = new Map(Object.entries(receipt.inputs).map(([name, d]) => [name, execution.files.get(`evidence-${d.sha256}.bin`)]));
  assert.equal(inputs.size, 6);
  verifyArchiveReadback({ inputs, receipt, policy: t.expected, nowMs: t.now, httpTransportSpec: t.spec });
  await verifyArchiveHttpExecution({ inputs, receipt, expected: t.expected, spec: t.spec, context: f.context, nowMs: t.now });
  const serialized = Buffer.concat([...execution.files.values()]).toString();
  assert.equal(serialized.includes(await t.sign()), false);
  assert.equal(serialized.includes("synthetic-runner-credential"), false);
  assert.equal(production.report.publication_authorized, false);
  assert.equal(production.report.production_acceptance, "BLOCKED");
  inputs.get("http_result")[0] ^= 1;
  await assert.rejects(verifyArchiveHttpExecution({ inputs, receipt, expected: t.expected, spec: t.spec, context: f.context, nowMs: t.now }));
});
for (const mutation of ["raw bytes", "response identity", "HTTP error", "redirect", "fetch failure"]) {
  test(`remote ${mutation} cannot mint a successful archive capture`, async () => {
    const t = await fixture(), dependencies = { ...t.httpDependencies };
    dependencies.fetchArchive = async (url, init) => {
      if (mutation === "fetch failure") throw new Error("synthetic remote down");
      if (mutation === "HTTP error") return new Response("not authorized", { status: 403 });
      if (mutation === "redirect") return new Response(null, { status: 302, headers: { location: "https://attacker.test" } });
      const r = await t.httpDependencies.fetchArchive(url, init), body = await r.json();
      if (mutation === "raw bytes") body.bytes = encodeArchiveBytes(Buffer.from("forged"));
      else body.authorization.run_attempt++;
      return Response.json(body);
    };
    t.f.checkPolicy.archive_transport = t.spec;
    const production = await collectReleaseEvidence({ report: t.f.report, identity: t.identity,
      checkPolicyBytes: jsonBytes(t.f.checkPolicy), checkPolicySha256: sha256(jsonBytes(t.f.checkPolicy)) },
    { httpDependencies: dependencies, now: () => t.now });
    assert.equal(production.executions.size, 0);
    assert.equal(production.report.checks.archive_readback.status, "BLOCKED_EXTERNAL_INPUTS");
  });
}
test("missing runner credentials, isolated build job and wrong policy pin produce no successful record", async () => {
  const t = await fixture(); t.f.checkPolicy.archive_transport = t.spec;
  const options = { report: t.f.report, identity: t.identity, checkPolicyBytes: jsonBytes(t.f.checkPolicy), checkPolicySha256: sha256(jsonBytes(t.f.checkPolicy)) };
  const missing = await collectReleaseEvidence(options, { httpDependencies: {
    getToken: () => requestActionsArchiveToken(t.policy.audience, { environment: {} }) }, now: () => t.now });
  assert.equal(missing.report.checks.archive_readback.blocker, "ACTIONS_ARCHIVE_OIDC_CREDENTIALS_MISSING");
  const isolated = await collectReleaseEvidence(options, { httpEnabled: false, now: () => t.now });
  assert.equal(isolated.report.checks.archive_readback.blocker, "ARCHIVE_HTTP_ISOLATED_JOB_REQUIRED");
  assert.equal(missing.executions.size, 0); assert.equal(isolated.executions.size, 0); assert.deepEqual(t.reads, []);
});
test("bounded bodies reject advertised and streamed overflow instead of buffering unbounded input", async () => {
  await assert.rejects(boundedBody(new Response("abc", { headers: { "content-length": "9000" } }), 10), /BODY_TOO_LARGE/);
  await assert.rejects(boundedBody(new Response("oversized"), 2), /BODY_TOO_LARGE/);
  const t = await fixture(); t.policy.max_object_bytes = 100_000_000; t.spec.policy_sha256 = sha256(archivePolicyBytes(t.policy));
  await assert.rejects(validateArchiveTransportSpec(t.spec), /POLICY_INVALID/);
});

async function supplementalFixture() {
  const t = await fixture(), f = t.f;
  f.checkPolicy.archive_transport = t.spec;
  Object.assign(f.options, { checkPolicyBytes: jsonBytes(f.checkPolicy), checkPolicySha256: sha256(jsonBytes(f.checkPolicy)) });
  for (const check of ["archive_readback", "offline_verification"]) f.files.delete(`check-${check}.json`);
  f.report.evidence_production = (await collectReleaseEvidence({ report: f.report, identity: t.identity,
    checkPolicyBytes: f.options.checkPolicyBytes, checkPolicySha256: f.options.checkPolicySha256 },
  { httpEnabled: false, now: () => t.now })).report;
  f.files.set("release-report.json", jsonBytes(f.report));
  const origin = JSON.parse(f.files.get(EXECUTION_ORIGIN_FILE));
  origin.subject = executionSubject(f.report); delete origin.checks.archive_readback; delete origin.checks.offline_verification;
  f.files.set(EXECUTION_ORIGIN_FILE, jsonBytes(origin)); f.sync();
  const produced = await produceArchiveJob({ github: f.github, run: f.run, eligibility: f.eligibility, identity: t.identity,
    checkPolicyBytes: f.options.checkPolicyBytes, checkPolicySha256: f.options.checkPolicySha256,
    publicBuildInputsSha256: f.options.publicBuildInputsSha256, downloadArchive: f.options.downloadArchive },
  { transport: f.dependencies.transport, httpDependencies: t.httpDependencies, now: () => t.now });
  let archiveRaw = produced.transport;
  const meta = { ...f.metadata(), id: 51, name: `fusou-archive-${f.run.id}-${f.run.run_attempt}` };
  const sync = () => {
    meta.size_in_bytes = archiveRaw.length; meta.digest = `sha256:${createHash("sha256").update(archiveRaw).digest("hex")}`;
  };
  sync();
  f.github.rest.actions.listWorkflowRunArtifacts = async ({ name }) => ({ data: { total_count: 1,
    artifacts: [name === meta.name ? meta : f.metadata()] } });
  f.github.rest.actions.getArtifact = async ({ artifact_id }) => ({ data: artifact_id === meta.id ? meta : f.metadata() });
  const primaryDownload = f.options.downloadArchive;
  f.options.downloadArchive = async (id) => id === meta.id ? archiveRaw : primaryDownload(id);
  return { ...t, produced, meta, replaceSupplement(files) { archiveRaw = encodeReleaseTransport(files); sync(); } };
}
test("isolated producer -> API-authenticated supplementary artifact -> independent consumer; native stays blocked", async () => {
  const t = await supplementalFixture(), f = t.f;
  const result = await consumeReleaseRun(f.options, { transport: f.dependencies.transport,
    verifyRuntimeEnvelope: f.dependencies.verifyRuntimeEnvelope });
  assert.equal(result.archive_transport.id, t.meta.id);
  assert.equal(result.archive_acquisition_status, "AUTHENTICATED_PRODUCER_REPORT_VERIFIED");
  assert.equal(result.status, "BLOCKED_IMPLEMENTATION");
  assert.deepEqual(result.blockers, ["FORMAL_NATIVE_BUILD_IDENTITY_CONTRACT_UNDEFINED"]);
  assert.equal(result.publication_authorized, false); assert.equal(result.deployment_status, "NOT_CHECKED");
  assert.equal(result.production_acceptance, "BLOCKED");
  assert.notEqual(result.artifact_status, "RELEASE_ARTIFACTS_VALIDATED");
});
for (const mutation of ["attempt", "workflow SHA", "artifact run", "report", "raw evidence", "origin", "extra build check"]) {
  test(`independent consumer rejects supplemental ${mutation} substitution instead of trusting the artifact's own claims`, async () => {
    const t = await supplementalFixture(), f = t.f, files = decodeReleaseTransport(t.produced.transport);
    if (mutation === "attempt") t.meta.name = `fusou-archive-${f.run.id}-2`;
    if (mutation === "workflow SHA") t.meta.workflow_run = { ...t.meta.workflow_run, head_sha: "e".repeat(40) };
    if (mutation === "artifact run") t.meta.workflow_run = { ...t.meta.workflow_run, id: 999 };
    if (mutation === "report") files.set("release-report.json", jsonBytes({ ...f.report, commit_sha: "e".repeat(40) }));
    if (mutation === "raw evidence") {
      const name = [...files.keys()].find((key) => key.startsWith("evidence-")); files.set(name, Buffer.from("forged"));
    }
    if (mutation === "origin") {
      const seal = JSON.parse(files.get(EXECUTION_ORIGIN_FILE)); seal.issuer.run_attempt++; files.set(EXECUTION_ORIGIN_FILE, jsonBytes(seal));
    }
    if (mutation === "extra build check") {
      const seal = JSON.parse(files.get(EXECUTION_ORIGIN_FILE)); seal.checks.locked_dependencies = {}; files.set(EXECUTION_ORIGIN_FILE, jsonBytes(seal));
    }
    t.replaceSupplement(files);
    await assert.rejects(consumeReleaseRun(f.options, { transport: f.dependencies.transport,
      verifyRuntimeEnvelope: f.dependencies.verifyRuntimeEnvelope }), /artifact|report|evidence|execution issuer/);
  });
}
test("missing supplementary evidence keeps independent consumer blocked, and a declared success alone never authenticates it", async () => {
  const t = await supplementalFixture(), f = t.f;
  f.github.rest.actions.listWorkflowRunArtifacts = async ({ name }) => ({ data: {
    total_count: name === t.meta.name ? 0 : 1, artifacts: name === t.meta.name ? [] : [f.metadata()] } });
  const missing = await consumeReleaseRun(f.options, { transport: f.dependencies.transport,
    verifyRuntimeEnvelope: f.dependencies.verifyRuntimeEnvelope });
  assert.deepEqual(missing.blockers, ["AUTHENTICATED_ARCHIVE_HTTP_ARTIFACT_MISSING"]);
  assert.equal(missing.archive_acquisition_status, undefined);
  assert.equal(missing.production_acceptance, "BLOCKED");
  const u = await supplementalFixture(), files = decodeReleaseTransport(u.produced.transport);
  files.delete("check-archive_readback.json"); files.delete(EXECUTION_ORIGIN_FILE);
  files.set("archive-production.json", jsonBytes({ authenticated: true, status: "PASS" })); u.replaceSupplement(files);
  const selfAsserted = await consumeReleaseRun(u.f.options, { transport: u.f.dependencies.transport,
    verifyRuntimeEnvelope: u.f.dependencies.verifyRuntimeEnvelope });
  assert.deepEqual(selfAsserted.blockers, ["AUTHENTICATED_ARCHIVE_HTTP_EXECUTION_MISSING"]);
  assert.equal(selfAsserted.archive_acquisition_status, undefined);
});
test("development eligibility never requests OIDC or runs an archive read", async () => {
  const t = await fixture(), f = t.f;
  const development = { ...f.eligibility, status: "DEVELOPMENT_VALIDATED", tag: "fusou-dev-synthetic" };
  f.files.set("release-report.json", jsonBytes(development)); f.sync();
  const result = await produceArchiveJob({ github: f.github, run: f.run, eligibility: development, identity: t.identity,
    downloadArchive: f.options.downloadArchive }, { transport: f.dependencies.transport,
    httpDependencies: { getToken: async () => assert.fail("development must not request a token") } });
  assert.equal(result.report.status, "NOT_APPLICABLE");
  assert.deepEqual(t.reads, []);
});
test("missing audience/repository ID, duplicate grants and altered policy bytes never manufacture independent expectations", async () => {
  const t = await fixture();
  for (const field of ["audience", "repository_id", "workflow_ref"]) {
    const policy = structuredClone(t.policy); delete policy[field];
    await assert.rejects(validateArchiveTransportSpec({ policy, policy_sha256: sha256(archivePolicyBytes(policy)) }), /POLICY_INVALID/);
  }
  const policy = structuredClone(t.policy); policy.grants.push(structuredClone(policy.grants[0]));
  await assert.rejects(validateArchiveTransportSpec({ policy, policy_sha256: sha256(archivePolicyBytes(policy)) }), /GRANT_AMBIGUOUS/);
  await assert.rejects(validateArchiveTransportSpec({ policy: t.policy, policy_sha256: "Z".repeat(43) }), /PIN_MISSING_OR_MISMATCH/);
});
test("canonical response schema rejects duplicate/extra fields rather than persisting an unexpected token field", async () => {
  const t = await fixture();
  for (const mutation of ["extra", "duplicate", "catalog extra"]) {
    const dependencies = { ...t.httpDependencies, fetchArchive: async (url, init) => {
      const r = await t.httpDependencies.fetchArchive(url, init), raw = await r.text(), body = JSON.parse(raw);
      if (mutation === "extra") body.token = "must-not-persist";
      if (mutation === "catalog extra") body.catalog.token = "must-not-persist";
      return new Response(mutation === "duplicate" ? raw.replace('"schema_version":1', '"schema_version":9,"schema_version":1') :
        archivePolicyBytes(body), { headers: { "content-type": "application/json" } });
    } };
    await assert.rejects(acquireArchiveHttp({ spec: t.spec, context: t.f.context, expected: t.expected },
      { ...dependencies, now: () => t.now }), /RESPONSE_CONTEXT|CATALOG_SCOPE/);
  }
});
test("consumer-side validators reject catalog/raw size and target substitution even after raw-response digests are recomputed", async () => {
  const t = await fixture(), acquired = await acquireArchiveHttp({ spec: t.spec, context: t.f.context, expected: t.expected },
    { ...t.httpDependencies, now: () => t.now });
  for (const mutation of ["version", "byte_length", "sha256", "session_id", "job_id", "binding_id", "verification_attempt_id", "retention_status"]) {
    const response = JSON.parse(acquired.httpTransport.responses.get("result"));
    if (mutation === "retention_status") response.catalog.retention_status = "VERIFIED";
    else response.catalog.objects.result[mutation] = mutation === "byte_length" ? 123 : "forged";
    const responses = new Map(acquired.httpTransport.responses); responses.set("result", archivePolicyBytes(response));
    const inputs = new Map();
    for (const role of ["presentation", "result"]) {
      inputs.set(`readback_${role}`, t.f.saved.get(role)); inputs.set(`http_${role}`, responses.get(role));
    }
    const receipt = { output: { transport: { kind: "TRUSTED_PRODUCER_HTTPS_FETCH", policy_sha256: t.spec.policy_sha256,
      responses_sha256: Object.fromEntries([...responses].map(([role, raw]) => [role, sha256(raw)])) } } };
    await assert.rejects(verifyArchiveHttpExecution({ inputs, receipt, expected: t.expected, spec: t.spec, context: t.f.context, nowMs: t.now }),
      /CATALOG|RAW_BYTES/);
  }
});
test("token expiration gates requests, not later report authentication within independently allowed evidence freshness", async () => {
  const t = await fixture();
  t.policy.grants[0].capture_max_age_ms = 100_000;
  t.spec.policy_sha256 = sha256(archivePolicyBytes(t.policy)); t.expected.max_age_ms = 100_000;
  const response = await t.call(), raw = new Uint8Array(await response.arrayBuffer());
  const observed = await verifyArchiveHttpResponse(raw, { spec: t.spec, policy: t.policy, request: t.request(), expected: t.expected, nowMs: 62_000 });
  assert.deepEqual(observed.bytes, Uint8Array.from(t.f.saved.get("result")));
  assert.equal((await t.call({ time: 62_000 })).status, 401);
  await assert.rejects(verifyArchiveHttpResponse(raw, { spec: t.spec, policy: t.policy, request: t.request(),
    expected: { ...t.expected, max_age_ms: 500 }, nowMs: 62_000 }), /RESPONSE_CONTEXT/);
});
