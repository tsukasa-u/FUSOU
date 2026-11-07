#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, randomBytes, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./production-trust-contract.mjs";
import freshnessGateway, {
  FRESHNESS_GATEWAY_DEADLINE_MS,
  FRESHNESS_GATEWAY_MAX_IN_FLIGHT,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-GATEWAY/src/index.ts";
import {
  TLSN_RUNTIME_CONFIG_FRESHNESS as C,
  createRuntimeConfigFreshnessRequest,
  runtimeConfigFreshnessSigningBytes,
  verifyRuntimeConfigDelegation,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigReleaseCommitRecord,
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
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve,
    reject: (error) => reject(error),
  };
}

function makeGatewayTestContext() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) {
      pending.push(promise);
    },
  };
}

function fetchGateway(request, bindings, context = makeGatewayTestContext()) {
  return freshnessGateway.fetch(request, bindings, context);
}

function validGatewaySignerResponse() {
  return new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function assertGatewayAdmissionCapacity(setup, availableSlots) {
  const gates = Array.from({ length: availableSlots }, () => deferred());
  const started = deferred();
  const refused = deferred();
  let signerCalls = 0;
  const bindings = {
    TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
    TLSN_FRESHNESS_SIGNER: {
      fetch() {
        const index = signerCalls++;
        if (index < availableSlots) {
          if (signerCalls === availableSlots) started.resolve();
          return gates[index].promise;
        }
        return Promise.resolve(validGatewaySignerResponse());
      },
    },
  };
  const pending = Array.from(
    { length: availableSlots },
    () => fetchGateway(makeGatewayRequest(setup), bindings),
  );
  for (const request of pending) {
    void request.then(
      (response) => {
        if (response.status === 503) refused.resolve();
      },
      () => refused.resolve(),
    );
  }

  await Promise.race([started.promise, refused.promise]);
  const overLimit = await fetchGateway(makeGatewayRequest(setup), bindings);
  const callsAtLimit = signerCalls;
  for (const gate of gates) gate.resolve(validGatewaySignerResponse());
  const admitted = await Promise.all(pending);

  assert.deepEqual(
    admitted.map((response) => response.status),
    Array(availableSlots).fill(200),
  );
  assert.equal(overLimit.status, 503);
  assert.equal(callsAtLimit, availableSlots);
}

function makeGatewayRequest(setup, { body = setup.request.raw, signal } = {}) {
  const init = {
    method: "POST",
    headers: {
      accept: "application/json",
      "cache-control": "no-store",
      "content-type": "application/json",
    },
    body,
    ...(signal ? { signal } : {}),
  };
  if (body instanceof ReadableStream) init.duplex = "half";
  return new Request(new URL(C.requestPath, MANIFEST_URL), init);
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

function releaseRecordPayload(recordRaw) {
  const recordBytes = Buffer.isBuffer(recordRaw)
    ? Buffer.from(recordRaw)
    : Buffer.from(recordRaw, "base64url");
  const envelope = JSON.parse(recordBytes.toString("utf8"));
  return JSON.parse(
    Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"),
  );
}

function resignReleaseRecord(recordRaw, setup, changes) {
  const recordBytes = Buffer.isBuffer(recordRaw)
    ? Buffer.from(recordRaw)
    : Buffer.from(recordRaw, "base64url");
  const envelope = JSON.parse(recordBytes.toString("utf8"));
  const payload = releaseRecordPayload(recordRaw);
  Object.assign(payload, changes);
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  envelope.payload_base64url = payloadBytes.toString("base64url");
  envelope.signature_base64url = sign(
    null,
    runtimeConfigFreshnessSigningBytes(
      C.releaseDomain,
      envelope.signer_key_id,
      payloadBytes,
    ),
    setup.releaseSigner.private_key,
  ).toString("base64url");
  return Buffer.from(canonicalJson(envelope), "utf8");
}

function verifyJournalEntryRecord(entry, setup) {
  return verifyRuntimeConfigReleaseCommitRecord(
    Buffer.from(entry.record_base64url, "base64url"),
    {
      rootSigner: setup.rootSigner,
      environment: "production",
      releaseDelegationRaw: Buffer.from(
        entry.release_delegation_base64url,
        "base64url",
      ),
      appendedAt: entry.appended_at,
    },
  );
}

function replaceWithResignedRecord(entry, setup, changes) {
  const recordRaw = resignReleaseRecord(entry.record_base64url, setup, changes);
  const verified = verifyRuntimeConfigReleaseCommitRecord(recordRaw, {
    rootSigner: setup.rootSigner,
    environment: "production",
    releaseDelegationRaw: Buffer.from(
      entry.release_delegation_base64url,
      "base64url",
    ),
    appendedAt: entry.appended_at,
  });
  entry.record_base64url = recordRaw.toString("base64url");
  entry.record_sha256 = hash(recordRaw);
  return verified;
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

async function threeGenerationJournal() {
  const setup = makeHarness();
  for (const epoch of ["1", "2", "3"]) {
    await setup.authority.commitRelease(
      freshManifest(setup.manifestSigner, epoch),
    );
  }
  return {
    setup,
    snapshot: setup.authority.journal.snapshot(),
  };
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

test("three-generation Journal snapshot reload preserves the complete signed chain", async () => {
  const { setup, snapshot } = await threeGenerationJournal();
  assert.equal(snapshot.entries.length, 3);

  const restarted = restartAuthority(setup, { journalSnapshot: snapshot });
  assert.deepEqual(restarted.journal.getHead(), setup.authority.journal.getHead());
  assert.deepEqual(restarted.journal.entries, snapshot.entries);

  for (const [index, entry] of restarted.journal.entries.entries()) {
    const generation = BigInt(index + 1).toString();
    const previous = index === 0 ? null : restarted.journal.entries[index - 1];
    const verified = verifyJournalEntryRecord(entry, setup);
    assert.equal(entry.generation, generation);
    assert.equal(entry.manifest_epoch, generation);
    assert.equal(entry.record_sha256, hash(Buffer.from(entry.record_base64url, "base64url")));
    assert.equal(verified.payload.commit_generation, generation);
    assert.equal(verified.payload.manifest_epoch, generation);
    assert.equal(
      verified.payload.previous_commit_generation,
      previous?.generation ?? null,
    );
    assert.equal(
      verified.payload.previous_commit_record_sha256,
      previous?.record_sha256 ?? null,
    );
  }
});

test("three-generation Journal reload rejects independent generation-2 chain corruption", async (t) => {
  const { setup, snapshot: validSnapshot } = await threeGenerationJournal();
  const cloneSnapshot = () => JSON.parse(JSON.stringify(validSnapshot));
  const scenarios = [
    {
      name: "validly re-signed generation 2 with a different previous record digest",
      mutate(snapshot) {
        const entry = snapshot.entries[1];
        const verified = replaceWithResignedRecord(entry, setup, {
          previous_commit_record_sha256: hash(Buffer.from("alternate parent record")),
        });
        assert.equal(
          verified.payload.previous_commit_record_sha256,
          hash(Buffer.from("alternate parent record")),
        );
      },
      expected: /snapshot chain verification failed/,
    },
    {
      name: "signed generation 2 with an invalid previous generation fails record verification",
      mutate(snapshot) {
        const entry = snapshot.entries[1];
        const recordRaw = resignReleaseRecord(entry.record_base64url, setup, {
          previous_commit_generation: "9",
        });
        entry.record_base64url = recordRaw.toString("base64url");
        entry.record_sha256 = hash(recordRaw);
        assert.throws(
          () => verifyJournalEntryRecord(entry, setup),
          /generation is not contiguous/,
        );
      },
      expected: /generation is not contiguous/,
    },
    {
      name: "valid signed generation 3 substituted at generation-2 position is rejected",
      mutate(snapshot) {
        const entry = snapshot.entries[1];
        const verified = replaceWithResignedRecord(entry, setup, {
          commit_generation: "3",
          previous_commit_generation: "2",
        });
        entry.generation = verified.payload.commit_generation;
        assert.equal(verified.payload.commit_generation, "3");
      },
      expected: /snapshot chain verification failed/,
    },
    {
      name: "validly re-signed generation 2 with a Manifest epoch rollback",
      mutate(snapshot) {
        const entry = snapshot.entries[1];
        const verified = replaceWithResignedRecord(entry, setup, {
          manifest_epoch: "1",
        });
        entry.manifest_epoch = verified.payload.manifest_epoch;
        assert.equal(verified.payload.manifest_epoch, "1");
      },
      expected: /snapshot chain verification failed/,
    },
    {
      name: "record digest metadata differs from the verified signed record",
      mutate(snapshot) {
        const entry = snapshot.entries[1];
        assert.doesNotThrow(() => verifyJournalEntryRecord(entry, setup));
        entry.record_sha256 = hash(Buffer.from("incorrect journal record digest"));
      },
      expected: /snapshot chain verification failed/,
    },
    {
      name: "Manifest epoch metadata differs from the verified signed record",
      mutate(snapshot) {
        const entry = snapshot.entries[1];
        const verified = verifyJournalEntryRecord(entry, setup);
        assert.equal(verified.payload.manifest_epoch, "2");
        entry.manifest_epoch = "99";
      },
      expected: /snapshot chain verification failed/,
    },
    {
      name: "a different root-signed Release Delegation cannot verify generation 2",
      mutate(snapshot) {
        const entry = snapshot.entries[1];
        const alternatePair = createTestEd25519KeyPair();
        const issuedAt = new Date(setup.sharedClock.now() - 60_000).toISOString();
        const alternateDelegation = createTestRuntimeConfigDelegation({
          rootPrivateKey: setup.rootPair.privateKey,
          rootKeyId: setup.rootSigner.key_id,
          payload: createTestDelegationPayload({
            delegationId: "00000000-0000-4000-8000-000000000105",
            purpose: "release-commit-record-v1",
            keyId: setup.releaseSigner.key_id,
            publicKeySpki: alternatePair.publicKeySpki,
            audience: `${C.releaseAudiencePrefix}production`,
            issuedAt,
            notBefore: issuedAt,
          }),
        });
        assert.doesNotThrow(() => verifyRuntimeConfigDelegation(alternateDelegation, {
          rootSigner: setup.rootSigner,
          expectedPurpose: "release-commit-record-v1",
          expectedEnvironment: "production",
          expectedAudience: `${C.releaseAudiencePrefix}production`,
        }));
        entry.release_delegation_base64url = alternateDelegation.toString("base64url");
      },
      expected: /signature|delegation|fields/i,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const snapshot = cloneSnapshot();
      scenario.mutate(snapshot);
      assert.throws(
        () => restartAuthority(setup, { journalSnapshot: snapshot }),
        scenario.expected,
      );
    });
  }
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

test("Freshness Gateway routes a verified challenge and preserves the exact APP-verifiable response", async () => {
  const setup = await committedHarness();
  const forwardedResponses = [];
  const signerBinding = {
    async fetch(request) {
      assert.equal(request.method, "POST");
      assert.equal(
        new URL(request.url).pathname,
        C.requestPath,
      );
      const forwardedRequest = Buffer.from(await request.arrayBuffer());
      assert.deepEqual(forwardedRequest, Buffer.from(setup.request.raw));
      const response = await setup.authority.issueFreshness(forwardedRequest);
      forwardedResponses.push(Buffer.from(response));
      return new Response(response, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const bindings = {
    TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
    TLSN_FRESHNESS_SIGNER: signerBinding,
  };
  const freshnessUrl = new URL(C.requestPath, MANIFEST_URL);
  const makeRequest = ({ body = setup.request.raw, signal } = {}) => new Request(freshnessUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "cache-control": "no-store",
      "content-type": "application/json",
    },
    body,
    ...(signal ? { signal } : {}),
  });

  const response = await fetchGateway(makeRequest(), bindings);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "application/json");
  const responseRaw = Buffer.from(await response.arrayBuffer());
  assert.equal(forwardedResponses.length, 1);
  assert.deepEqual(responseRaw, forwardedResponses[0]);
  assert.equal(responseRaw.byteLength, forwardedResponses[0].byteLength);
  assert.equal(hash(responseRaw), hash(forwardedResponses[0]));

  const verified = verifyRuntimeConfigFreshnessResponse(responseRaw, {
    bootstrapSigner: setup.rootSigner,
    manifestUrl: MANIFEST_URL,
    request: setup.request.request,
    nowMs: setup.sharedClock.now(),
  });
  assert.equal(verified.payload.request_nonce, setup.request.request.request_nonce);
  const appProjection = setup.authority.verifyAppResponse(
    responseRaw,
    setup.request.request,
    { nowMs: setup.sharedClock.now() },
  );
  assert.deepEqual(appProjection.raw_manifest, setup.manifestRaw);

  const otherRequest = await createRuntimeConfigFreshnessRequest({
    environment: "production",
    manifestUrl: MANIFEST_URL,
    requestNonce: randomBytes(32),
  });
  assert.throws(
    () => verifyRuntimeConfigFreshnessResponse(responseRaw, {
      bootstrapSigner: setup.rootSigner,
      manifestUrl: MANIFEST_URL,
      request: otherRequest.request,
      nowMs: setup.sharedClock.now(),
    }),
    /does not bind the outstanding APP challenge/,
  );

  const missingBinding = await fetchGateway(makeRequest(), {
    TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
  });
  assert.equal(missingBinding.status, 503);
  const missingAllBindings = await fetchGateway(makeRequest(), {});
  assert.equal(missingAllBindings.status, 503);

  const wrongAudienceRaw = Buffer.from(canonicalJson({
    ...setup.request.request,
    audience_manifest_url_sha256: hash(Buffer.from(
      "https://other.example.com/tlsn/runtime-config/v2/manifest.json",
    )),
  }), "utf8");
  const wrongAudienceResponse = await fetchGateway(makeRequest({
    body: wrongAudienceRaw,
  }), bindings);
  assert.equal(wrongAudienceResponse.status, 400);

  const oversizedRequest = await fetchGateway(makeRequest({
    body: Buffer.alloc(C.maxRequestBytes + 1),
  }), bindings);
  assert.equal(oversizedRequest.status, 413);

  const redirectResponse = await fetchGateway(makeRequest(), {
    ...bindings,
    TLSN_FRESHNESS_SIGNER: {
      async fetch() {
        return new Response(null, {
          status: 302,
          headers: { location: "https://unapproved.example/" },
        });
      },
    },
  });
  assert.equal(redirectResponse.status, 502);

  const oversizedResponse = await fetchGateway(makeRequest(), {
    ...bindings,
    TLSN_FRESHNESS_SIGNER: {
      async fetch() {
        return new Response(new Uint8Array(C.maxResponseBytes + 1), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  assert.equal(oversizedResponse.status, 502);

  const mismatchedLengthResponse = await fetchGateway(makeRequest(), {
    ...bindings,
    TLSN_FRESHNESS_SIGNER: {
      async fetch() {
        return new Response("{}", {
          status: 200,
          headers: {
            "content-length": "1",
            "content-type": "application/json",
          },
        });
      },
    },
  });
  assert.equal(mismatchedLengthResponse.status, 502);

  const abortController = new AbortController();
  const signerStarted = deferred();
  const abortContext = makeGatewayTestContext();
  const pendingAbort = fetchGateway(
    makeRequest({ signal: abortController.signal }),
    {
      ...bindings,
      TLSN_FRESHNESS_SIGNER: {
        async fetch(request) {
          signerStarted.resolve();
          if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
          return new Promise((_, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        },
      },
    },
    abortContext,
  );
  await signerStarted.promise;
  abortController.abort();
  const abortedResponse = await pendingAbort;
  assert.equal(abortedResponse.status, 499);

  const fixtureDirectory = mkdtempSync(join(tmpdir(), "fusou-freshness-gateway-"));
  const fixturePath = join(fixtureDirectory, "route-fixture.json");
  const encode = (bytes) => Buffer.from(bytes).toString("base64url");
  const fixture = {
    test_only: true,
    manifest_url: MANIFEST_URL,
    now_ms: setup.sharedClock.now(),
    root_signer: setup.rootSigner,
    request_raw_base64url: encode(setup.request.raw),
    response_raw_base64url: encode(responseRaw),
    manifest_raw_base64url: encode(setup.manifestRaw),
    inputs_base64url: Object.fromEntries(
      Object.entries(VECTOR_INPUTS).map(([name, bytes]) => [name, encode(bytes)]),
    ),
  };
  writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  try {
    const rustOutput = execFileSync(
      "cargo",
      [
        "+1.98.1",
        "test",
        "--locked",
        "--offline",
        "--manifest-path",
        join(repositoryRoot, "packages/FUSOU-APP/src-tauri/Cargo.toml"),
        "--features",
        "tlsn-production,freshness-gateway-integration-test",
        "--lib",
        "tlsn_runtime_config_manifest::freshness::tests::gateway_route_output_is_accepted_by_app_verifier",
        "--",
        "--exact",
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          CARGO_NET_OFFLINE: "true",
          FUSOU_RUNTIME_CONFIG_FRESHNESS_ROUTE_FIXTURE: fixturePath,
          RUSTUP_AUTO_INSTALL: "0",
        },
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    assert.match(rustOutput, /test result: ok\. 1 passed; 0 failed;/);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

test("Freshness Gateway deadline cancels an incomplete request body before calling the signer", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const startedAt = performance.now();
  const pull = deferred();
  const cancelled = deferred();
  const body = new ReadableStream({
    pull() {
      return pull.promise;
    },
    cancel() {
      pull.resolve();
      cancelled.resolve();
    },
  });
  let signerCalls = 0;
  const context = makeGatewayTestContext();
  const response = await fetchGateway(
    makeGatewayRequest(setup, { body }),
    {
      TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
      TLSN_FRESHNESS_SIGNER: {
        async fetch() {
          signerCalls += 1;
          return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
    context,
  );

  assert.equal(response.status, 504);
  assert.ok(performance.now() - startedAt < FRESHNESS_GATEWAY_DEADLINE_MS + 2_000);
  assert.equal(signerCalls, 0);
  await cancelled.promise;
  await Promise.all(context.pending);
});

test("Freshness Gateway deadline cancels a stalled signer response body", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const startedAt = performance.now();
  const pull = deferred();
  const cancelled = deferred();
  let signerSignal;
  const responseBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x7b]));
    },
    pull() {
      return pull.promise;
    },
    cancel() {
      pull.resolve();
      cancelled.resolve();
    },
  });
  const context = makeGatewayTestContext();
  const response = await fetchGateway(
    makeGatewayRequest(setup),
    {
      TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
      TLSN_FRESHNESS_SIGNER: {
        async fetch(request) {
          signerSignal = request.signal;
          return new Response(responseBody, {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
    context,
  );

  assert.equal(response.status, 504);
  assert.ok(performance.now() - startedAt < FRESHNESS_GATEWAY_DEADLINE_MS + 2_000);
  assert.equal(signerSignal.aborted, true);
  await cancelled.promise;
  await Promise.all(context.pending);
});

test("Freshness Gateway cancels a late streaming response after client disconnect and holds admission until cleanup", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const signerStarted = deferred();
  const lateResponse = deferred();
  const cancelStarted = deferred();
  const cleanup = deferred();
  const abortController = new AbortController();
  const context = makeGatewayTestContext();
  let pullCalls = 0;
  const request = fetchGateway(
    makeGatewayRequest(setup, { signal: abortController.signal }),
    {
      TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
      TLSN_FRESHNESS_SIGNER: {
        fetch() {
          signerStarted.resolve();
          return lateResponse.promise;
        },
      },
    },
    context,
  );

  await signerStarted.promise;
  abortController.abort();
  const disconnected = await request;
  assert.equal(disconnected.status, 499);
  assert.equal(context.pending.length, 1);

  const body = new ReadableStream({
    pull() {
      pullCalls += 1;
      return new Promise(() => {});
    },
    cancel() {
      cancelStarted.resolve();
      return cleanup.promise;
    },
  }, { highWaterMark: 0 });
  lateResponse.resolve(new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  }));

  let cleanupSettled = false;
  const cleanupObserved = context.pending[0].then(() => {
    cleanupSettled = true;
  });
  try {
    await cancelStarted.promise;
    await Promise.resolve();
    assert.equal(pullCalls, 0);
    assert.equal(cleanupSettled, false);
    await assertGatewayAdmissionCapacity(
      setup,
      FRESHNESS_GATEWAY_MAX_IN_FLIGHT - 1,
    );
  } finally {
    cleanup.resolve();
    await cleanupObserved;
  }

  assert.equal(cleanupSettled, true);
  await assertGatewayAdmissionCapacity(setup, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);
});

test("Freshness Gateway cancels a late streaming response after deadline and holds admission until cleanup", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const signerStarted = deferred();
  const lateResponse = deferred();
  const cancelStarted = deferred();
  const cleanup = deferred();
  const context = makeGatewayTestContext();
  let pullCalls = 0;
  const startedAt = performance.now();
  const request = fetchGateway(
    makeGatewayRequest(setup),
    {
      TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
      TLSN_FRESHNESS_SIGNER: {
        fetch() {
          signerStarted.resolve();
          return lateResponse.promise;
        },
      },
    },
    context,
  );

  await signerStarted.promise;
  const timedOut = await request;
  assert.equal(timedOut.status, 504);
  assert.ok(performance.now() - startedAt < FRESHNESS_GATEWAY_DEADLINE_MS + 2_000);
  assert.equal(context.pending.length, 1);

  const body = new ReadableStream({
    pull() {
      pullCalls += 1;
      return new Promise(() => {});
    },
    cancel() {
      cancelStarted.resolve();
      return cleanup.promise;
    },
  }, { highWaterMark: 0 });
  lateResponse.resolve(new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  }));

  let cleanupSettled = false;
  const cleanupObserved = context.pending[0].then(() => {
    cleanupSettled = true;
  });
  try {
    await cancelStarted.promise;
    await Promise.resolve();
    assert.equal(pullCalls, 0);
    assert.equal(cleanupSettled, false);
    await assertGatewayAdmissionCapacity(
      setup,
      FRESHNESS_GATEWAY_MAX_IN_FLIGHT - 1,
    );
  } finally {
    cleanup.resolve();
    await cleanupObserved;
  }

  assert.equal(cleanupSettled, true);
  await assertGatewayAdmissionCapacity(setup, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);
});

test("Freshness Gateway cancels malformed and oversized Content-Length bodies before reading", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const invalidLengths = [
    "not-a-length",
    String(C.maxResponseBytes + 1),
  ];

  for (const contentLength of invalidLengths) {
    const cancelStarted = deferred();
    const cleanup = deferred();
    const context = makeGatewayTestContext();
    let pullCalls = 0;
    let cancelCalls = 0;
    const body = new ReadableStream({
      pull() {
        pullCalls += 1;
        return new Promise(() => {});
      },
      cancel() {
        cancelCalls += 1;
        cancelStarted.resolve();
        return cleanup.promise;
      },
    }, { highWaterMark: 0 });
    const responsePromise = fetchGateway(
      makeGatewayRequest(setup),
      {
        TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
        TLSN_FRESHNESS_SIGNER: {
          async fetch() {
            return new Response(body, {
              status: 200,
              headers: {
                "content-length": contentLength,
                "content-type": "application/json",
              },
            });
          },
        },
      },
      context,
    );

    await cancelStarted.promise;
    let capacityError;
    try {
      await assertGatewayAdmissionCapacity(
        setup,
        FRESHNESS_GATEWAY_MAX_IN_FLIGHT - 1,
      );
    } catch (error) {
      capacityError = error;
    } finally {
      cleanup.resolve();
    }

    const response = await responsePromise;
    assert.equal(response.status, 502);
    assert.equal(pullCalls, 0);
    assert.equal(cancelCalls, 1);
    if (capacityError) throw capacityError;
    await assertGatewayAdmissionCapacity(setup, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);
  }
});

test("Freshness Gateway cancels rejected status, redirect, and Content-Type bodies", async () => {
  const setup = await committedHarness();
  const rejectedResponses = [
    { status: 503, contentType: "application/json", redirected: false },
    { status: 302, contentType: "application/json", redirected: false },
    { status: 200, contentType: "text/plain", redirected: false },
    { status: 200, contentType: "application/json", redirected: true },
  ];

  for (const rejected of rejectedResponses) {
    const cancelStarted = deferred();
    const cleanup = deferred();
    let pullCalls = 0;
    let cancelCalls = 0;
    const body = new ReadableStream({
      pull() {
        pullCalls += 1;
        return new Promise(() => {});
      },
      cancel() {
        cancelCalls += 1;
        cancelStarted.resolve();
        return cleanup.promise;
      },
    }, { highWaterMark: 0 });
    const signerResponse = new Response(body, {
      status: rejected.status,
      headers: { "content-type": rejected.contentType },
    });
    if (rejected.redirected) {
      Object.defineProperty(signerResponse, "redirected", { value: true });
    }

    const responsePromise = fetchGateway(
      makeGatewayRequest(setup),
      {
        TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
        TLSN_FRESHNESS_SIGNER: {
          async fetch() {
            return signerResponse;
          },
        },
      },
    );
    await cancelStarted.promise;
    assert.equal(pullCalls, 0);
    assert.equal(cancelCalls, 1);
    cleanup.resolve();

    const response = await responsePromise;
    assert.equal(response.status, 502);
  }
});

test("Freshness Gateway returns its deadline response while signer body cleanup is unsettled", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const cancelStarted = deferred();
  const cleanup = deferred();
  const context = makeGatewayTestContext();
  let pullCalls = 0;
  const body = new ReadableStream({
    pull() {
      pullCalls += 1;
      return new Promise(() => {});
    },
    cancel() {
      cancelStarted.resolve();
      return cleanup.promise;
    },
  }, { highWaterMark: 0 });
  const startedAt = performance.now();
  const request = fetchGateway(
    makeGatewayRequest(setup),
    {
      TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
      TLSN_FRESHNESS_SIGNER: {
        async fetch() {
          return new Response(body, {
            status: 200,
            headers: {
              "content-length": "malformed",
              "content-type": "application/json",
            },
          });
        },
      },
    },
    context,
  );

  let response;
  try {
    response = await request;
    assert.equal(response.status, 504);
    assert.ok(performance.now() - startedAt < FRESHNESS_GATEWAY_DEADLINE_MS + 2_000);
    await cancelStarted.promise;
    assert.equal(pullCalls, 0);
    assert.equal(context.pending.length, 1);
    await assertGatewayAdmissionCapacity(
      setup,
      FRESHNESS_GATEWAY_MAX_IN_FLIGHT - 1,
    );
  } finally {
    cleanup.resolve();
    await Promise.all(context.pending);
  }

  assert.equal(response.status, 504);
  await assertGatewayAdmissionCapacity(setup, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);
});

test("Freshness Gateway uses one deadline across request, signer, and response body phases", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const bodyCancelled = deferred();
  const delayedBody = (bytes, delayMs, onCancel = () => {}) => {
    let timer;
    let delivered = false;
    let resolvePull = () => {};
    return new ReadableStream({
      pull(controller) {
        if (delivered) return;
        delivered = true;
        return new Promise((resolve) => {
          resolvePull = resolve;
          timer = setTimeout(() => {
            controller.enqueue(bytes);
            controller.close();
            resolvePull();
          }, delayMs);
        });
      },
      cancel() {
        clearTimeout(timer);
        resolvePull();
        onCancel();
      },
    });
  };
  const context = makeGatewayTestContext();
  const startedAt = performance.now();
  const response = await fetchGateway(
    makeGatewayRequest(setup, {
      body: delayedBody(new Uint8Array(setup.request.raw), 3_000),
    }),
    {
      TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
      TLSN_FRESHNESS_SIGNER: {
        async fetch(request) {
          await request.arrayBuffer();
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          return new Response(delayedBody(
            new TextEncoder().encode("{}"),
            3_000,
            () => bodyCancelled.resolve(),
          ), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
    context,
  );

  assert.equal(response.status, 504);
  assert.ok(performance.now() - startedAt < FRESHNESS_GATEWAY_DEADLINE_MS + 2_000);
  await bodyCancelled.promise;
  await Promise.all(context.pending);
});

test("Freshness Gateway caps in-flight work and retains slots until late signer work settles", {
  timeout: 20_000,
}, async () => {
  const setup = await committedHarness();
  const gates = Array.from(
    { length: FRESHNESS_GATEWAY_MAX_IN_FLIGHT },
    () => deferred(),
  );
  const started = deferred();
  const signerSignals = [];
  let signerCalls = 0;
  const context = makeGatewayTestContext();
  const signer = {
    fetch(request) {
      signerCalls += 1;
      signerSignals.push(request.signal);
      if (signerCalls <= FRESHNESS_GATEWAY_MAX_IN_FLIGHT) {
        if (signerCalls === FRESHNESS_GATEWAY_MAX_IN_FLIGHT) started.resolve();
        return gates[signerCalls - 1].promise;
      }
      return Promise.resolve(new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    },
  };
  const bindings = {
    TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
    TLSN_FRESHNESS_SIGNER: signer,
  };
  const pending = Array.from(
    { length: FRESHNESS_GATEWAY_MAX_IN_FLIGHT },
    () => fetchGateway(makeGatewayRequest(setup), bindings, context),
  );

  await started.promise;
  assert.equal(signerCalls, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);
  const overLimit = await fetchGateway(makeGatewayRequest(setup), bindings, context);
  assert.equal(overLimit.status, 503);
  assert.equal(signerCalls, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);

  const timedOut = await Promise.all(pending);
  assert.deepEqual(timedOut.map((response) => response.status), Array(
    FRESHNESS_GATEWAY_MAX_IN_FLIGHT,
  ).fill(504));
  assert.equal(signerSignals.every((signal) => signal.aborted), true);
  assert.equal(context.pending.length, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);

  const stillFull = await fetchGateway(makeGatewayRequest(setup), bindings, context);
  assert.equal(stillFull.status, 503);
  assert.equal(signerCalls, FRESHNESS_GATEWAY_MAX_IN_FLIGHT);

  gates[0].reject(new Error("late signer failure"));
  for (const gate of gates.slice(1)) {
    gate.resolve(new Response("late response", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  }
  await Promise.all(context.pending);

  const afterCleanup = await fetchGateway(makeGatewayRequest(setup), bindings, context);
  assert.equal(afterCleanup.status, 200);
  assert.equal(signerCalls, FRESHNESS_GATEWAY_MAX_IN_FLIGHT + 1);
});

test("Freshness Gateway propagates client disconnect and rejects already-aborted requests", async () => {
  const setup = await committedHarness();
  const started = deferred();
  const abortController = new AbortController();
  let signerSignal;
  let signerCalls = 0;
  const context = makeGatewayTestContext();
  const bindings = {
    TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
    TLSN_FRESHNESS_SIGNER: {
      fetch(request) {
        signerCalls += 1;
        signerSignal = request.signal;
        started.resolve();
        return new Promise((_, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    },
  };
  const pending = fetchGateway(
    makeGatewayRequest(setup, { signal: abortController.signal }),
    bindings,
    context,
  );
  await started.promise;
  abortController.abort();

  const disconnected = await pending;
  assert.equal(disconnected.status, 499);
  assert.equal(signerSignal.aborted, true);
  await Promise.all(context.pending);

  const alreadyAbortedController = new AbortController();
  alreadyAbortedController.abort();
  const alreadyAborted = await fetchGateway(
    makeGatewayRequest(setup, { signal: alreadyAbortedController.signal }),
    bindings,
    context,
  );
  assert.equal(alreadyAborted.status, 499);
  assert.equal(signerCalls, 1);
});

test("Freshness Gateway retains admission when signer body cleanup cannot be confirmed", async () => {
  const setup = await committedHarness();
  const cancelStarted = deferred();
  let pullCalls = 0;
  const body = new ReadableStream({
    pull() {
      pullCalls += 1;
      return new Promise(() => {});
    },
    cancel() {
      cancelStarted.resolve();
      return Promise.reject(new Error("body cleanup failed"));
    },
  }, { highWaterMark: 0 });
  const response = await fetchGateway(
    makeGatewayRequest(setup),
    {
      TLSN_RUNTIME_CONFIG_MANIFEST_URL: MANIFEST_URL,
      TLSN_FRESHNESS_SIGNER: {
        async fetch() {
          return new Response(body, {
            status: 200,
            headers: {
              "content-length": "malformed",
              "content-type": "application/json",
            },
          });
        },
      },
    },
  );

  assert.equal(response.status, 502);
  await cancelStarted.promise;
  assert.equal(pullCalls, 0);
  await assertGatewayAdmissionCapacity(
    setup,
    FRESHNESS_GATEWAY_MAX_IN_FLIGHT - 1,
  );
});
