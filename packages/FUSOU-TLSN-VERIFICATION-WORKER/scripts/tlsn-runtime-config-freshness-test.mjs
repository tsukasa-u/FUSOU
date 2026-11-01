#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJson } from "./production-trust-contract.mjs";
import {
  TLSN_RUNTIME_CONFIG_FRESHNESS as C,
  createRuntimeConfigFreshnessRequest,
  runtimeConfigFreshnessSigningBytes,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
} from "./tlsn-runtime-config-freshness.mjs";
import {
  createTestDelegationPayload,
  createTestEd25519KeyPair,
  createTestKeyDescriptor,
  createTestRuntimeConfigDelegation,
  InMemoryFreshnessClockForTest,
  InMemoryRuntimeConfigFreshnessAuthorityForTest,
} from "./tlsn-runtime-config-freshness-test-adapters.mjs";
import { tlsnRuntimeConfigSigningBytes, verifyTlsnRuntimeConfigProductionEnvelope } from "./tlsn-runtime-config-manifest.mjs";

const MANIFEST_URL =
  "https://runtime-config.example.com/tlsn/runtime-config/v2/manifest.json";
const VECTOR = JSON.parse(readFileSync(
  new URL("./fixtures/tlsn-runtime-config-independent-v2-vector.json", import.meta.url),
  "utf8",
));
const VECTOR_PAYLOAD = (() => {
  const envelope = JSON.parse(VECTOR.manifest_envelope_utf8);
  return JSON.parse(Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"));
})();
const VECTOR_INPUTS = Object.fromEntries(
  Object.entries(VECTOR.inputs_base64url).map(([name, value]) => [
    name,
    Buffer.from(value, "base64url"),
  ]),
);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function signManifest(payload, signer) {
  const payloadBase64Url = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  const signature = sign(
    null,
    tlsnRuntimeConfigSigningBytes(signer.key_id, payload),
    signer.private_key,
  );
  return Buffer.from(canonicalJson({
    schema_version: 2,
    scope: "fusou-tlsn-runtime-config-envelope-v2",
    signature_algorithm: "Ed25519",
    signer_key_id: signer.key_id,
    payload_base64url: payloadBase64Url,
    signature_base64url: signature.toString("base64url"),
  }), "utf8");
}

function freshManifest(signer, epoch) {
  return signManifest({ ...VECTOR_PAYLOAD, epoch }, signer);
}

function resignFreshnessPayload(responseRaw, setup, changes) {
  const envelope = JSON.parse(Buffer.from(responseRaw).toString("utf8"));
  const payload = JSON.parse(
    Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"),
  );
  Object.assign(payload, changes);
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  envelope.payload_base64url = payloadBytes.toString("base64url");
  envelope.signature_base64url = sign(
    null,
    runtimeConfigFreshnessSigningBytes(
      C.freshnessDomain,
      setup.freshnessSigner.key_id,
      payloadBytes,
    ),
    setup.freshnessSigner.private_key,
  ).toString("base64url");
  return Buffer.from(canonicalJson(envelope), "utf8");
}

function makeHarness({
  sharedClock = new InMemoryFreshnessClockForTest(VECTOR.policy.now_ms),
  journalClock = sharedClock,
  releaseClock = sharedClock,
} = {}) {
  const rootPair = createTestEd25519KeyPair();
  const releasePair = createTestEd25519KeyPair();
  const freshnessPair = createTestEd25519KeyPair();
  const rootSigner = Object.freeze({
    scope: "fusou-tlsn-runtime-config-signing-root-v2",
    key_id: "freshness-test-root",
    public_key_spki: rootPair.publicKeySpki,
  });
  const manifestSigner = Object.freeze({
    key_id: rootSigner.key_id,
    private_key: rootPair.privateKey,
  });
  const freshnessAudience = hash(Buffer.from(MANIFEST_URL, "utf8"));
  const releaseAudience = `${C.releaseAudiencePrefix}production`;
  const delegationIssuedAt = new Date(sharedClock.now() - 60_000).toISOString();
  const releaseDelegationRaw = createTestRuntimeConfigDelegation({
    rootPrivateKey: rootPair.privateKey,
    rootKeyId: rootSigner.key_id,
    payload: createTestDelegationPayload({
      delegationId: "00000000-0000-4000-8000-000000000101",
      purpose: "release-commit-record-v1",
      keyId: "test-release-key",
      publicKeySpki: releasePair.publicKeySpki,
      audience: releaseAudience,
      issuedAt: delegationIssuedAt,
      notBefore: delegationIssuedAt,
    }),
  });
  const freshnessDelegationRaw = createTestRuntimeConfigDelegation({
    rootPrivateKey: rootPair.privateKey,
    rootKeyId: rootSigner.key_id,
    payload: createTestDelegationPayload({
      delegationId: "00000000-0000-4000-8000-000000000102",
      purpose: "freshness-response-v1",
      keyId: "test-freshness-key",
      publicKeySpki: freshnessPair.publicKeySpki,
      audience: freshnessAudience,
      issuedAt: delegationIssuedAt,
      notBefore: delegationIssuedAt,
    }),
  });
  const releaseSigner = createTestKeyDescriptor(
    "test-release-key",
    releasePair,
    releaseDelegationRaw,
  );
  const freshnessSigner = createTestKeyDescriptor(
    "test-freshness-key",
    freshnessPair,
    freshnessDelegationRaw,
  );
  const manifestVerifier = async (raw, r2) => {
    const payload = JSON.parse(
      Buffer.from(JSON.parse(Buffer.from(raw).toString("utf8")).payload_base64url, "base64url")
        .toString("utf8"),
    );
    const inputs = {
      worker_reference_raw: r2.getObject(
        `tlsn/runtime-config/v2/artifacts/worker-reference/${payload.source.worker_reference_sha256}`,
      ),
      origin_inventory_raw: r2.getObject(
        `tlsn/runtime-config/v2/artifacts/origin-inventory/${payload.production_authority_pins.origin_inventory_sha256}`,
      ),
      target_approval_raw: r2.getObject(
        `tlsn/runtime-config/v2/artifacts/target-approval/${payload.production_authority_pins.target_approval_artifact_sha256}`,
      ),
      security_registry_set_raw: r2.getObject(
        `tlsn/runtime-config/v2/artifacts/security-registry-set/${payload.production_authority_pins.security_registry_set_sha256}`,
      ),
      result_registry_envelope_raw: r2.getObject(
        `tlsn/runtime-config/v2/artifacts/result-registry-envelope/${payload.result_registry_pins.result_registry_envelope_sha256}`,
      ),
    };
    if (Object.values(inputs).some((value) => value === null)) {
      throw new Error("test Runtime Config artifact is missing from fake R2");
    }
    const verification = verifyTlsnRuntimeConfigProductionEnvelope(raw, {
      trustedSigner: rootSigner,
      policy: {
        ...VECTOR.policy,
        now_ms: sharedClock.now(),
        last_accepted_epoch: "0",
        last_accepted_manifest_sha256: null,
      },
      independentInputs: inputs,
    });
    return {
      schema_version: verification.payload.schema_version,
      epoch: verification.payload.epoch,
    };
  };
  const authority = new InMemoryRuntimeConfigFreshnessAuthorityForTest({
    manifestUrl: MANIFEST_URL,
    rootSigner,
    releaseSigner,
    freshnessSigner,
    releaseClock,
    journalClock,
    freshnessClock: sharedClock,
    manifestVerifier,
    testOnlyGenesisApproval: "TEST_ONLY_APPROVED_GENESIS",
  });
  const artifacts = [
    ["worker-reference", VECTOR_INPUTS.worker_reference_raw],
    ["origin-inventory", VECTOR_INPUTS.origin_inventory_raw],
    ["target-approval", VECTOR_INPUTS.target_approval_raw],
    ["security-registry-set", VECTOR_INPUTS.security_registry_set_raw],
    ["result-registry-envelope", VECTOR_INPUTS.result_registry_envelope_raw],
  ];
  for (const [kind, bytes] of artifacts) {
    const digest = hash(bytes);
    authority.r2.putImmutable(
      `tlsn/runtime-config/v2/artifacts/${kind}/${digest}`,
      bytes,
    );
  }
  const request = createRuntimeConfigFreshnessRequest({
    environment: "production",
    manifestUrl: MANIFEST_URL,
    requestNonce: randomBytes(32),
  });
  return {
    authority,
    rootSigner,
    rootPair,
    manifestSigner,
    releaseSigner,
    freshnessSigner,
    request,
    sharedClock,
    releaseClock,
    freshnessDelegationRaw,
  };
}

async function committedHarness(options) {
  const setup = makeHarness(options);
  const manifestRaw = freshManifest(setup.manifestSigner, "1");
  await setup.authority.commitRelease(manifestRaw);
  return { ...setup, manifestRaw };
}

function restartAuthority(setup, overrides = {}) {
  const snapshots = setup.authority.snapshots();
  return new InMemoryRuntimeConfigFreshnessAuthorityForTest({
    manifestUrl: MANIFEST_URL,
    rootSigner: setup.rootSigner,
    releaseSigner: setup.releaseSigner,
    freshnessSigner: setup.freshnessSigner,
    releaseClock: setup.releaseClock,
    journalClock: setup.authority.journal.clock,
    freshnessClock: setup.sharedClock,
    manifestVerifier: setup.authority.manifestVerifier,
    testOnlyGenesisApproval: "TEST_ONLY_APPROVED_GENESIS",
    r2Snapshot: overrides.r2Snapshot ?? snapshots.r2,
    journalSnapshot: overrides.journalSnapshot ?? snapshots.journal,
    coordinationSnapshot: overrides.coordinationSnapshot ?? snapshots.coordination,
  });
}

test("Manifest V2, Journal commit, DO state, R2 snapshot, and Freshness response agree", async () => {
  const setup = await committedHarness();
  const response = await setup.authority.issueFreshness(setup.request.raw);
  const verified = verifyRuntimeConfigFreshnessResponse(response, {
    bootstrapSigner: setup.rootSigner,
    manifestUrl: MANIFEST_URL,
    request: setup.request.request,
    nowMs: setup.sharedClock.now(),
  });
  const appResult = setup.authority.verifyAppResponse(
    response,
    setup.request.request,
    { nowMs: setup.sharedClock.now() },
  );

  assert.equal(verified.payload.freshness_semantics, "LATEST_AT_ISSUANCE");
  assert.equal(verified.payload.latest_epoch, VECTOR_PAYLOAD.epoch);
  assert.equal(verified.payload.manifest_sha256, hash(setup.manifestRaw));
  assert.equal(appResult.raw_manifest.equals(setup.manifestRaw), true);
  assert.equal(setup.authority.coordination.activeLeaseCount(), 0);
});

test("HSM authorization and Journal append do not independently make a release COMMITTED", async () => {
  const setup = makeHarness();
  const manifestRaw = freshManifest(setup.manifestSigner, "1");
  const attempt = await setup.authority.beginRelease(manifestRaw);
  setup.authority.writePointerCas(attempt.attempt_id);
  setup.authority.observePointerCommitted(attempt.attempt_id);
  const authorization = setup.authority.authorizeJournalAppend(attempt.attempt_id);
  const authEnvelope = JSON.parse(authorization.toString("utf8"));
  const authPayload = JSON.parse(
    Buffer.from(authEnvelope.payload_base64url, "base64url").toString("utf8"),
  );

  assert.equal(
    authPayload.authorized_at,
    new Date(setup.sharedClock.now()).toISOString(),
    "authorized_at comes from the signer clock, not the caller",
  );
  await assert.rejects(
    setup.authority.issueFreshness(setup.request.raw),
    /pending|stable committed release/,
  );

  setup.authority.appendJournal(attempt.attempt_id);
  await assert.rejects(
    setup.authority.issueFreshness(setup.request.raw),
    /pending|stable committed release/,
  );
  assert.equal(setup.authority.coordination.getCurrentCommitted(), null);
});

test("orphaned Release Authority signature is not stored or treated as committed", async () => {
  const setup = makeHarness();
  const attempt = await setup.authority.beginRelease(
    freshManifest(setup.manifestSigner, "1"),
  );
  setup.authority.writePointerCas(attempt.attempt_id);
  setup.authority.observePointerCommitted(attempt.attempt_id);
  let orphanedAuthorization;

  assert.throws(
    () => setup.authority.authorizeJournalAppend(attempt.attempt_id, {
      afterSign(raw) {
        orphanedAuthorization = raw;
        throw new Error("simulated crash before authorization persistence");
      },
    }),
    /simulated crash/,
  );
  assert.ok(orphanedAuthorization);
  assert.equal(
    setup.authority.coordination.getPending().authorization_base64url,
    null,
  );
  assert.equal(setup.authority.journal.getHead(), null);
  assert.throws(
    () => setup.authority.appendJournal(attempt.attempt_id),
    /persisted exact authorization bytes/,
  );

  setup.releaseClock.advance(1);
  const restarted = restartAuthority(setup);
  assert.equal(await restarted.recoverPendingRelease(), "COMMITTED");
  assert.notEqual(
    restarted.journal.getHead().record_base64url,
    orphanedAuthorization.toString("base64url"),
  );
});

test("Journal append followed by a crash is recovered without a second commit", async () => {
  const setup = makeHarness();
  const manifestRaw = freshManifest(setup.manifestSigner, "1");
  await setup.authority.commitRelease(manifestRaw, {
    crashAfter: "journal-append",
  });
  const restarted = restartAuthority(setup);

  await assert.rejects(
    restarted.issueFreshness(setup.request.raw),
    /pending|stable committed release/,
  );
  assert.equal(restarted.coordination.beginRecovery(), "ADMITTED");
  assert.throws(
    () => restarted.coordination.acquireIssueLease(),
    /pending/,
  );
  assert.equal(await restarted.recoverPendingRelease(), "COMMITTED");
  const response = await restarted.issueFreshness(setup.request.raw);
  const verified = verifyRuntimeConfigFreshnessResponse(response, {
    bootstrapSigner: setup.rootSigner,
    manifestUrl: MANIFEST_URL,
    request: setup.request.request,
    nowMs: setup.sharedClock.now(),
  });

  assert.equal(verified.payload.pointer_generation, "1");
  assert.equal(
    restarted.journal.getHead().record_base64url,
    restarted.coordination.getCurrentCommitted().record_base64url,
  );
});

test("recovery resumes each commit boundary and never accepts an orphan authorization", async () => {
  for (const crashAfter of [
    "prepared",
    "pointer-cas",
    "pointer-committed",
    "authorization-stored",
    "journal-append",
  ]) {
    const setup = makeHarness();
    const manifestRaw = freshManifest(setup.manifestSigner, "1");
    await setup.authority.commitRelease(manifestRaw, { crashAfter });
    const restarted = restartAuthority(setup);

    await assert.rejects(
      restarted.issueFreshness(setup.request.raw),
      /pending|stable committed release/,
      crashAfter,
    );
    assert.equal(await restarted.recoverPendingRelease(), "COMMITTED", crashAfter);
    const response = await restarted.issueFreshness(setup.request.raw);
    const verified = verifyRuntimeConfigFreshnessResponse(response, {
      bootstrapSigner: setup.rootSigner,
      manifestUrl: MANIFEST_URL,
      request: setup.request.request,
      nowMs: setup.sharedClock.now(),
    });
    assert.equal(verified.payload.pointer_generation, "1", crashAfter);
    assert.equal(restarted.journal.entries.length, 1, crashAfter);
  }

  const committed = makeHarness();
  await committed.authority.commitRelease(
    freshManifest(committed.manifestSigner, "1"),
    { crashAfter: "do-committed" },
  );
  const restartedCommitted = restartAuthority(committed);
  assert.equal(await restartedCommitted.recoverPendingRelease(), "NO_PENDING_RELEASE");
  const committedResponse = await restartedCommitted.issueFreshness(committed.request.raw);
  const committedVerified = verifyRuntimeConfigFreshnessResponse(committedResponse, {
    bootstrapSigner: committed.rootSigner,
    manifestUrl: MANIFEST_URL,
    request: committed.request.request,
    nowMs: committed.sharedClock.now(),
  });
  assert.equal(committedVerified.payload.pointer_generation, "1");
});

test("ambiguous R2 CAS outcome is reconciled from exact pointer and snapshot", async () => {
  const setup = makeHarness();
  const manifestRaw = freshManifest(setup.manifestSigner, "1");
  setup.authority.r2.failAfterNextCas = true;
  await assert.rejects(
    setup.authority.commitRelease(manifestRaw),
    /pointer CAS outcome is unknown/,
  );
  const restarted = restartAuthority(setup);
  assert.equal(await restarted.recoverPendingRelease(), "COMMITTED");
  assert.equal(restarted.coordination.getCurrentCommitted().manifest_sha256, hash(manifestRaw));
});

test("ambiguous R2 CAS with prior pointer readback stays blocked", async () => {
  const setup = makeHarness();
  setup.authority.r2.failBeforeNextCas = true;
  await assert.rejects(
    setup.authority.commitRelease(freshManifest(setup.manifestSigner, "1")),
    /pointer CAS outcome is unknown/,
  );
  const restarted = restartAuthority(setup);

  await assert.rejects(
    restarted.recoverPendingRelease(),
    /cannot resolve the R2 pointer CAS outcome/,
  );
  await assert.rejects(
    restarted.issueFreshness(setup.request.raw),
    /pending/,
  );
  assert.equal(restarted.journal.getHead(), null);
});

test("Journal restart validates signed chain and append metadata", async () => {
  const setup = await committedHarness();
  const snapshots = setup.authority.snapshots();
  snapshots.journal.entries[0].appended_at = "2100-01-01T00:00:00.000Z";

  assert.throws(
    () => restartAuthority(setup, { journalSnapshot: snapshots.journal }),
    /outside delegation/,
  );
});

test("recovery waits for an existing Freshness lease and blocks new leases", async () => {
  const setup = await committedHarness();
  const lease = setup.authority.coordination.acquireIssueLease();
  const attempt = await setup.authority.beginRelease(freshManifest(setup.manifestSigner, "2"));
  assert.equal(attempt.state, "WAITING_FOR_LEASES");

  const restarted = restartAuthority(setup);
  assert.equal(await restarted.recoverPendingRelease(), "WAITING_FOR_LEASES");
  assert.throws(
    () => restarted.coordination.acquireIssueLease(),
    /pending/,
  );
  restarted.coordination.releaseIssueLease(lease.lease_id);
  assert.equal(await restarted.recoverPendingRelease(), "COMMITTED");
});

test("Freshness lease wins release race; writer-pending blocks later leases and pointer CAS", async () => {
  const setup = await committedHarness();
  const lease = setup.authority.coordination.acquireIssueLease();
  const nextManifest = freshManifest(setup.manifestSigner, "2");
  const attempt = await setup.authority.beginRelease(nextManifest);

  assert.equal(attempt.state, "WAITING_FOR_LEASES");
  assert.throws(
    () => setup.authority.coordination.acquireIssueLease(),
    /pending/,
  );
  assert.throws(
    () => setup.authority.writePointerCas(attempt.attempt_id),
    /not admitted/,
  );
  setup.authority.coordination.releaseIssueLease(lease.lease_id);
  assert.equal(setup.authority.resumeRelease(attempt.attempt_id), "PREPARED");
  setup.authority.writePointerCas(attempt.attempt_id);
  setup.authority.observePointerCommitted(attempt.attempt_id);
});

test("multiple active issue leases finish before release resumes", async () => {
  const setup = await committedHarness();
  const bothSigned = deferred();
  const releaseSignatures = deferred();
  let entered = 0;
  const afterSign = () => {
    entered += 1;
    if (entered === 2) bothSigned.resolve();
    return releaseSignatures.promise;
  };
  const secondRequest = createRuntimeConfigFreshnessRequest({
    environment: "production",
    manifestUrl: MANIFEST_URL,
    requestNonce: randomBytes(32),
  });
  const firstIssue = setup.authority.issueFreshness(setup.request.raw, { afterSign });
  const secondIssue = setup.authority.issueFreshness(secondRequest.raw, { afterSign });
  await bothSigned.promise;
  assert.equal(setup.authority.coordination.activeLeaseCount(), 2);

  const attempt = await setup.authority.beginRelease(
    freshManifest(setup.manifestSigner, "2"),
  );
  assert.equal(attempt.state, "WAITING_FOR_LEASES");
  await assert.rejects(
    setup.authority.issueFreshness(createRuntimeConfigFreshnessRequest({
      environment: "production",
      manifestUrl: MANIFEST_URL,
      requestNonce: randomBytes(32),
    }).raw),
    /pending/,
  );

  releaseSignatures.resolve();
  await Promise.all([firstIssue, secondIssue]);
  assert.equal(setup.authority.coordination.activeLeaseCount(), 0);
  assert.equal(setup.authority.resumeRelease(attempt.attempt_id), "PREPARED");
});

test("Freshness signing that outlives the 8-second lease is discarded", async () => {
  const setup = await committedHarness();

  await assert.rejects(
    setup.authority.issueFreshness(setup.request.raw, {
      afterSign: () => setup.sharedClock.advance(C.maxIssueLeaseMs + 1),
    }),
    /lease is no longer active|expired while signing/,
  );
  assert.equal(setup.authority.coordination.activeLeaseCount(), 0);
});

test("fresh nonce, exact request schema, and response signatures prevent replay and mutation", async () => {
  const setup = await committedHarness();
  const response = await setup.authority.issueFreshness(setup.request.raw);
  const secondRequest = createRuntimeConfigFreshnessRequest({
    environment: "production",
    manifestUrl: MANIFEST_URL,
    requestNonce: randomBytes(32),
  });
  assert.throws(
    () => verifyRuntimeConfigFreshnessResponse(response, {
      bootstrapSigner: setup.rootSigner,
      manifestUrl: MANIFEST_URL,
      request: secondRequest.request,
      nowMs: setup.sharedClock.now(),
    }),
    /outstanding APP challenge/,
  );
  assert.throws(
    () => verifyRuntimeConfigFreshnessRequest(
      Buffer.concat([setup.request.raw, Buffer.from(" ")]),
      {
        expectedEnvironment: "production",
        expectedAudience: setup.request.request.audience_manifest_url_sha256,
      },
    ),
    /canonical JSON/,
  );

  const envelope = JSON.parse(response.toString("utf8"));
  envelope.release_commit_record_base64url = Buffer.from("tampered").toString("base64url");
  assert.throws(
    () => verifyRuntimeConfigFreshnessResponse(
      Buffer.from(canonicalJson(envelope)),
      {
        bootstrapSigner: setup.rootSigner,
        manifestUrl: MANIFEST_URL,
        request: setup.request.request,
        nowMs: setup.sharedClock.now(),
      },
    ),
    /signature verification failed|Release Commit Record|does not bind/,
  );
});

test("conservative delegation clock margin is checked independently of response skew", async () => {
  const setup = await committedHarness();
  const original = JSON.parse(
    (await setup.authority.issueFreshness(setup.request.raw)).toString("utf8"),
  );
  const payload = JSON.parse(
    Buffer.from(original.payload_base64url, "base64url").toString("utf8"),
  );
  const delegationEnvelope = JSON.parse(setup.freshnessDelegationRaw.toString("utf8"));
  const delegation = JSON.parse(
    Buffer.from(delegationEnvelope.payload_base64url, "base64url").toString("utf8"),
  );
  const notAfter = Date.parse(delegation.not_after);
  payload.issued_at = new Date(notAfter - 31_000).toISOString();
  payload.expires_at = new Date(notAfter - 1_000).toISOString();
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  original.payload_base64url = payloadBytes.toString("base64url");
  original.signature_base64url = sign(
    null,
    runtimeConfigFreshnessSigningBytes(
      C.freshnessDomain,
      setup.freshnessSigner.key_id,
      payloadBytes,
    ),
    setup.freshnessSigner.private_key,
  ).toString("base64url");
  const nearExpiryResponse = Buffer.from(canonicalJson(original), "utf8");

  assert.doesNotThrow(() => verifyRuntimeConfigFreshnessResponse(nearExpiryResponse, {
    bootstrapSigner: setup.rootSigner,
    manifestUrl: MANIFEST_URL,
    request: setup.request.request,
    nowMs: notAfter - 31_000,
  }));
  assert.throws(
    () => verifyRuntimeConfigFreshnessResponse(nearExpiryResponse, {
      bootstrapSigner: setup.rootSigner,
      manifestUrl: MANIFEST_URL,
      request: setup.request.request,
      nowMs: notAfter - 30_000,
    }),
    /conservative APP validity window/,
  );
});

test("same Manifest epoch cannot be recommitted with different bytes", async () => {
  const setup = await committedHarness();
  const changedPayload = {
    ...VECTOR_PAYLOAD,
    expires_at: "2026-10-13T07:19:07.010Z",
  };
  const sameEpochDifferentBytes = signManifest(changedPayload, setup.manifestSigner);

  await assert.rejects(
    setup.authority.beginRelease(sameEpochDifferentBytes),
    /Manifest epoch must strictly increase/,
  );
});

test("Journal rejects authorization from a signer clock later than append time", async () => {
  const sharedClock = new InMemoryFreshnessClockForTest(VECTOR.policy.now_ms);
  const journalClock = new InMemoryFreshnessClockForTest(VECTOR.policy.now_ms - 1);
  const setup = makeHarness({ sharedClock, journalClock });
  const manifestRaw = freshManifest(setup.manifestSigner, "1");
  const attempt = await setup.authority.beginRelease(manifestRaw);
  setup.authority.writePointerCas(attempt.attempt_id);
  setup.authority.observePointerCommitted(attempt.attempt_id);
  setup.authority.authorizeJournalAppend(attempt.attempt_id);

  assert.throws(
    () => setup.authority.appendJournal(attempt.attempt_id),
    /outside delegation|authorized_at/,
  );
  assert.equal(setup.authority.journal.getHead(), null);
  assert.equal(setup.authority.coordination.getPending().state, "POINTER_COMMITTED");
});

test("Release Authority clock before delegation not_before cannot authorize a Journal append", async () => {
  const sharedClock = new InMemoryFreshnessClockForTest(VECTOR.policy.now_ms);
  const releaseClock = new InMemoryFreshnessClockForTest(VECTOR.policy.now_ms - 61_000);
  const setup = makeHarness({ sharedClock, releaseClock });
  const attempt = await setup.authority.beginRelease(
    freshManifest(setup.manifestSigner, "1"),
  );
  setup.authority.writePointerCas(attempt.attempt_id);
  setup.authority.observePointerCommitted(attempt.attempt_id);

  assert.throws(
    () => setup.authority.authorizeJournalAppend(attempt.attempt_id),
    /delegation/,
  );
  assert.equal(
    setup.authority.coordination.getPending().authorization_base64url,
    null,
  );
  assert.equal(setup.authority.journal.getHead(), null);
});

test("Journal refuses a signed authorization replayed into another release attempt", async () => {
  const setup = await committedHarness();
  const firstRecord = setup.authority.journal.getHead().record_base64url;
  const secondAttempt = await setup.authority.beginRelease(
    freshManifest(setup.manifestSigner, "2"),
  );
  setup.authority.writePointerCas(secondAttempt.attempt_id);
  setup.authority.observePointerCommitted(secondAttempt.attempt_id);
  setup.authority.coordination.storeAuthorization(
    secondAttempt.attempt_id,
    Buffer.from(firstRecord, "base64url"),
  );

  assert.throws(
    () => setup.authority.appendJournal(secondAttempt.attempt_id),
    /does not match the pending attempt/,
  );
  assert.equal(setup.authority.journal.entries.length, 1);
  assert.equal(setup.authority.coordination.getCurrentCommitted().generation, "1");
});

test("Freshness verifier rejects missing, expired, wrong-root, and substituted signer delegations", async () => {
  const setup = await committedHarness();
  const response = await setup.authority.issueFreshness(setup.request.raw);
  const verify = (raw, request = setup.request.request, manifestUrl = MANIFEST_URL) =>
    verifyRuntimeConfigFreshnessResponse(raw, {
      bootstrapSigner: setup.rootSigner,
      manifestUrl,
      request,
      nowMs: setup.sharedClock.now(),
    });

  const missingDelegation = JSON.parse(response.toString("utf8"));
  missingDelegation.freshness_delegation_base64url = "";
  assert.throws(
    () => verify(Buffer.from(canonicalJson(missingDelegation))),
    /canonical unpadded base64url/,
  );

  const wrongSigner = JSON.parse(response.toString("utf8"));
  wrongSigner.signer_key_id = "other-freshness-key";
  assert.throws(
    () => verify(Buffer.from(canonicalJson(wrongSigner))),
    /key ID does not match its delegation/,
  );

  const wrongRoot = JSON.parse(response.toString("utf8"));
  const wrongRootDelegation = JSON.parse(
    Buffer.from(wrongRoot.freshness_delegation_base64url, "base64url").toString("utf8"),
  );
  wrongRootDelegation.root_key_id = "other-bootstrap-root";
  wrongRoot.freshness_delegation_base64url = Buffer.from(
    canonicalJson(wrongRootDelegation),
  ).toString("base64url");
  assert.throws(
    () => verify(Buffer.from(canonicalJson(wrongRoot))),
    /root key ID does not match/,
  );

  const issuedAt = new Date(
    setup.sharedClock.now() - C.maxFreshnessDelegationLifetimeSeconds * 1_000 - 1_000,
  ).toISOString();
  const expiredDelegation = createTestRuntimeConfigDelegation({
    rootPrivateKey: setup.rootPair.privateKey,
    rootKeyId: setup.rootSigner.key_id,
    payload: createTestDelegationPayload({
      delegationId: "00000000-0000-4000-8000-000000000103",
      purpose: "freshness-response-v1",
      keyId: setup.freshnessSigner.key_id,
      publicKeySpki: setup.freshnessSigner.public_key_spki,
      audience: hash(Buffer.from(MANIFEST_URL, "utf8")),
      issuedAt,
      notBefore: issuedAt,
    }),
  });
  const expiredResponse = JSON.parse(response.toString("utf8"));
  expiredResponse.freshness_delegation_base64url =
    expiredDelegation.toString("base64url");
  assert.throws(
    () => verify(Buffer.from(canonicalJson(expiredResponse))),
    /conservative APP validity window/,
  );

  assert.throws(
    () => verify(
      response,
      setup.request.request,
      "https://other.example.com/tlsn/runtime-config/v2/manifest.json",
    ),
    /outstanding APP challenge/,
  );
  const wrongEnvironmentRequest = Buffer.from(canonicalJson({
    ...setup.request.request,
    environment: "canary",
  }));
  assert.throws(
    () => verifyRuntimeConfigFreshnessRequest(wrongEnvironmentRequest, {
      expectedEnvironment: "production",
      expectedAudience: setup.request.request.audience_manifest_url_sha256,
    }),
    /scope, environment, or audience/,
  );
});

test("R2 pointer CAS conflict fails closed and identical Journal append retries are idempotent", async () => {
  const conflicted = makeHarness();
  const conflictedManifest = freshManifest(conflicted.manifestSigner, "1");
  const conflictedAttempt = await conflicted.authority.beginRelease(conflictedManifest);
  conflicted.authority.r2.compareAndSwapManifest(null, Buffer.from("unexpected pointer"));
  assert.throws(
    () => conflicted.authority.writePointerCas(conflictedAttempt.attempt_id),
    /compare-and-swap conflict/,
  );
  assert.throws(
    () => conflicted.authority.coordination.acquireIssueLease(),
    /pending/,
  );

  const setup = makeHarness();
  const manifestRaw = freshManifest(setup.manifestSigner, "1");
  const attempt = await setup.authority.beginRelease(manifestRaw);
  setup.authority.writePointerCas(attempt.attempt_id);
  setup.authority.observePointerCommitted(attempt.attempt_id);
  setup.authority.authorizeJournalAppend(attempt.attempt_id);
  const first = setup.authority.appendJournal(attempt.attempt_id);
  const retry = setup.authority.appendJournal(attempt.attempt_id);
  assert.deepEqual(retry, first);
  assert.equal(setup.authority.journal.entries.length, 1);
  setup.authority.completeRelease(attempt.attempt_id);
  assert.equal(setup.authority.coordination.getCurrentCommitted().generation, "1");
});

test("APP response expiry is checked against the signed expiry at verification time", async () => {
  const setup = await committedHarness();
  const response = await setup.authority.issueFreshness(setup.request.raw);
  const nowMs = setup.sharedClock.now();
  const expiredResponse = resignFreshnessPayload(response, setup, {
    issued_at: new Date(nowMs - 60_000).toISOString(),
    expires_at: new Date(nowMs - 31_000).toISOString(),
  });
  assert.throws(
    () => verifyRuntimeConfigFreshnessResponse(expiredResponse, {
      bootstrapSigner: setup.rootSigner,
      manifestUrl: MANIFEST_URL,
      request: setup.request.request,
      nowMs,
    }),
    /outside its permitted time window/,
  );
});
