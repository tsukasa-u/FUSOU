import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertFreshnessDelegationActive,
  assertReleaseCommitRecordMatchesAttempt,
  createRuntimeConfigFreshnessRequest,
  parseCanonicalUnsignedDecimal,
  verifyFreshnessManifestBinding,
  verifyRuntimeConfigDelegation,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigReleaseCommitRecord,
} from "../src/index.ts";
import {
  TLSN_RUNTIME_CONFIG_FRESHNESS as WORKER_FRESHNESS,
  createRuntimeConfigFreshnessRequest as createWorkerRequest,
  verifyFreshnessManifestBinding as verifyWorkerManifestBinding,
  verifyRuntimeConfigDelegation as verifyWorkerDelegation,
  verifyRuntimeConfigFreshnessRequest as verifyWorkerRequest,
  verifyRuntimeConfigFreshnessResponse as verifyWorkerResponse,
  verifyRuntimeConfigReleaseCommitRecord as verifyWorkerReleaseRecord,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-freshness.mjs";

const vector = JSON.parse(
  readFileSync(new URL("./fixtures/freshness-v1-golden.json", import.meta.url)),
);
const decode = (value) => Buffer.from(value, "base64url");
const raw = (value) => decode(vector[value]);
const requestRaw = raw("request_raw_base64url");
const responseRaw = raw("response_raw_base64url");
const freshnessDelegationRaw = raw("freshness_delegation_raw_base64url");
const releaseDelegationRaw = raw("release_delegation_raw_base64url");
const releaseRecordRaw = raw("release_commit_record_raw_base64url");
const expectedAudience = JSON.parse(requestRaw.toString("utf8"))
  .audience_manifest_url_sha256;
const workerRootSigner = {
  scope: vector.root_signer.scope,
  key_id: vector.root_signer.key_id,
  public_key_spki: vector.root_signer.public_key_spki,
};
const testRootSigner = {
  scope: vector.root_signer.scope,
  key_id: vector.root_signer.key_id,
  public_key_spki: vector.root_signer.public_key_spki,
};
const responseTimeOptions = {
  bootstrapSigner: workerRootSigner,
  manifestUrl: vector.manifest_url,
  nowMs: vector.now_ms,
};
const domainResponseTimeOptions = {
  bootstrapSigner: testRootSigner,
  manifestUrl: vector.manifest_url,
  nowMs: vector.now_ms,
};
const workerRequestOptions = {
  expectedEnvironment: "production",
  expectedAudience,
};
const mjsDelegation = (bytes, purpose, audience, signerNowMs) =>
  verifyWorkerDelegation(bytes, {
    rootSigner: workerRootSigner,
    expectedPurpose: purpose,
    expectedEnvironment: "production",
    expectedAudience: audience,
    signerNowMs,
  });
const domainDelegation = (bytes, purpose, audience, signerNowMs) =>
  verifyRuntimeConfigDelegation({
    raw: bytes,
    rootSigner: testRootSigner,
    expectedPurpose: purpose,
    expectedEnvironment: "production",
    expectedAudience: audience,
    signerNowMs,
  });
const workerReleaseOptions = (bytes) => ({
  rootSigner: workerRootSigner,
  environment: "production",
  releaseDelegationRaw,
  appendedAt: vector.release_commit_record_appended_at,
});
const domainReleaseOptions = (bytes) => ({
  raw: bytes,
  rootSigner: testRootSigner,
  environment: "production",
  releaseDelegationRaw,
  appendedAt: vector.release_commit_record_appended_at,
});

test("shared valid request, delegation, release record, response, and Manifest bind", async () => {
  const workerRequest = verifyWorkerRequest(requestRaw, workerRequestOptions);
  const domainRequest = await verifyRuntimeConfigFreshnessRequest(requestRaw, {
    environment: "production",
    audienceManifestUrlSha256: expectedAudience,
  });
  assert.deepEqual(domainRequest, workerRequest);

  const nonce = Uint8Array.from({ length: 32 }, (_, index) => index);
  const [workerCreated, domainCreated] = await Promise.all([
    createWorkerRequest({
      environment: "production",
      manifestUrl: vector.manifest_url,
      requestNonce: nonce,
    }),
    createRuntimeConfigFreshnessRequest({
      manifestUrl: vector.manifest_url,
      requestNonce: nonce,
    }),
  ]);
  assert.deepEqual(Buffer.from(workerCreated.raw), Buffer.from(requestRaw));
  assert.deepEqual(Buffer.from(domainCreated.raw), Buffer.from(requestRaw));

  const releaseAudience =
    `${WORKER_FRESHNESS.releaseAudiencePrefix}production`;
  const [workerFreshnessDelegation, domainFreshnessDelegation] =
    await Promise.all([
      mjsDelegation(
        freshnessDelegationRaw,
        "freshness-response-v1",
        expectedAudience,
      ),
      domainDelegation(
        freshnessDelegationRaw,
        "freshness-response-v1",
        expectedAudience,
      ),
    ]);
  const [workerReleaseDelegation, domainReleaseDelegation] =
    await Promise.all([
      mjsDelegation(
        releaseDelegationRaw,
        "release-commit-record-v1",
        releaseAudience,
      ),
      domainDelegation(
        releaseDelegationRaw,
        "release-commit-record-v1",
        releaseAudience,
      ),
    ]);
  assert.equal(
    workerFreshnessDelegation.digest,
    domainFreshnessDelegation.digest,
  );
  assert.equal(workerReleaseDelegation.digest, domainReleaseDelegation.digest);
  assert.equal(
    Date.parse(workerFreshnessDelegation.payload.not_after) -
      Date.parse(workerFreshnessDelegation.payload.issued_at),
    86_400_000,
  );
  assert.equal(
    Date.parse(workerReleaseDelegation.payload.not_after) -
      Date.parse(workerReleaseDelegation.payload.issued_at),
    2_592_000_000,
  );

  const [workerRecord, domainRecord] = await Promise.all([
    verifyWorkerReleaseRecord(
      releaseRecordRaw,
      workerReleaseOptions(releaseRecordRaw),
    ),
    verifyRuntimeConfigReleaseCommitRecord(
      domainReleaseOptions(releaseRecordRaw),
    ),
  ]);
  assert.equal(workerRecord.digest, domainRecord.digest);
  assert.equal(workerRecord.payload.pointer_etag, "etag-é-🌱");
  assertReleaseCommitRecordMatchesAttempt(
    domainRecord,
    vector.pending_attempt,
  );

  const [workerResponse, domainResponse] = await Promise.all([
    verifyWorkerResponse(responseRaw, {
      ...responseTimeOptions,
      request: workerRequest,
    }),
    verifyRuntimeConfigFreshnessResponse({
      ...domainResponseTimeOptions,
      request: domainRequest,
      raw: responseRaw,
    }),
  ]);
  assert.equal(
    workerResponse.payload.freshness_semantics,
    "LATEST_AT_ISSUANCE",
  );
  assert.equal(workerResponse.payload.latest_epoch, "43");
  assert.equal(domainResponse.payload.latest_epoch, "43");
  assert.equal(workerResponse.releaseRecord.digest, domainResponse.releaseCommit.digest);

  const manifestRaw = raw("manifest_raw_base64url");
  assert.deepEqual(
    Buffer.from(verifyWorkerManifestBinding(workerResponse, manifestRaw)),
    Buffer.from(manifestRaw),
  );
  assert.deepEqual(
    Buffer.from(
      await verifyFreshnessManifestBinding(domainResponse, manifestRaw),
    ),
    Buffer.from(manifestRaw),
  );
  assert.throws(() =>
    verifyWorkerManifestBinding(workerResponse, Buffer.from("wrong manifest")),
  );
  await assert.rejects(() =>
    verifyFreshnessManifestBinding(domainResponse, Buffer.from("wrong manifest")),
  );
});

test("request vectors reject noncanonical, unknown, and malformed bytes in both validators", async () => {
  const invalidCases = Object.entries(vector.cases.request);
  assert.equal(invalidCases.length, 6);
  for (const [name, encoded] of invalidCases) {
    const bytes = decode(encoded);
    assert.throws(
      () => verifyWorkerRequest(bytes, workerRequestOptions),
      undefined,
      `Worker accepted ${name}`,
    );
    await assert.rejects(
      () =>
        verifyRuntimeConfigFreshnessRequest(bytes, {
          environment: "production",
          audienceManifestUrlSha256: expectedAudience,
        }),
      undefined,
      `domain validator accepted ${name}`,
    );
  }
});

test("signed response negative vectors reject in both validators", async () => {
  const request = await verifyRuntimeConfigFreshnessRequest(requestRaw, {
    environment: "production",
    audienceManifestUrlSha256: expectedAudience,
  });
  const invalidCases = Object.entries(vector.cases.response);
  assert.equal(invalidCases.length, 11);
  for (const [name, encoded] of invalidCases) {
    const bytes = decode(encoded);
    assert.throws(
      () =>
        verifyWorkerResponse(bytes, {
          ...responseTimeOptions,
          request,
        }),
      undefined,
      `Worker accepted ${name}`,
    );
    await assert.rejects(
      () =>
        verifyRuntimeConfigFreshnessResponse({
          ...domainResponseTimeOptions,
          request,
          raw: bytes,
        }),
      undefined,
      `domain validator accepted ${name}`,
    );
  }
});

test("delegation lifetime and validity boundary vectors match", async () => {
  for (const [name, encoded] of Object.entries(vector.cases.delegation)) {
    const bytes = decode(encoded);
    const purpose = name.startsWith("freshness_")
      ? "freshness-response-v1"
      : "release-commit-record-v1";
    const audience =
      purpose === "freshness-response-v1"
        ? expectedAudience
        : `${WORKER_FRESHNESS.releaseAudiencePrefix}production`;
    assert.throws(() => mjsDelegation(bytes, purpose, audience));
    await assert.rejects(() => domainDelegation(bytes, purpose, audience));
  }

  const workerDelegation = mjsDelegation(
    freshnessDelegationRaw,
    "freshness-response-v1",
    expectedAudience,
  );
  const domainDelegationValue = await domainDelegation(
    freshnessDelegationRaw,
    "freshness-response-v1",
    expectedAudience,
  );
  const notBeforeMs = Date.parse(workerDelegation.payload.not_before);
  const notAfterMs = Date.parse(workerDelegation.payload.not_after);
  assert.doesNotThrow(() =>
    mjsDelegation(
      freshnessDelegationRaw,
      "freshness-response-v1",
      expectedAudience,
      notBeforeMs,
    ),
  );
  await domainDelegation(
    freshnessDelegationRaw,
    "freshness-response-v1",
    expectedAudience,
    notBeforeMs,
  );
  assert.throws(() =>
    mjsDelegation(
      freshnessDelegationRaw,
      "freshness-response-v1",
      expectedAudience,
      notAfterMs,
    ),
  );
  await assert.rejects(() =>
    domainDelegation(
      freshnessDelegationRaw,
      "freshness-response-v1",
      expectedAudience,
      notAfterMs,
    ),
  );

  assert.doesNotThrow(() =>
    assertFreshnessDelegationActive(
      domainDelegationValue,
      notBeforeMs + WORKER_FRESHNESS.maxClockSkewMs,
    ),
  );
  assert.throws(() =>
    assertFreshnessDelegationActive(
      domainDelegationValue,
      notAfterMs - WORKER_FRESHNESS.maxClockSkewMs,
    ),
  );
});

test("Release Commit Record boundary vectors distinguish structure from head binding", async () => {
  for (const name of [
    "generation_overflow_raw_base64url",
    "epoch_overflow_raw_base64url",
    "previous_generation_mismatch_raw_base64url",
    "unpaired_surrogate_raw_base64url",
  ]) {
    const bytes = decode(vector.cases.release_record[name]);
    assert.throws(
      () => verifyWorkerReleaseRecord(bytes, workerReleaseOptions(bytes)),
      undefined,
      `Worker accepted ${name}`,
    );
    await assert.rejects(
      () => verifyRuntimeConfigReleaseCommitRecord(domainReleaseOptions(bytes)),
      undefined,
      `domain validator accepted ${name}`,
    );
  }

  const mismatchBytes = decode(
    vector.cases.release_record.previous_digest_mismatch_raw_base64url,
  );
  const [workerMismatch, domainMismatch] = await Promise.all([
    verifyWorkerReleaseRecord(mismatchBytes, workerReleaseOptions(mismatchBytes)),
    verifyRuntimeConfigReleaseCommitRecord(
      domainReleaseOptions(mismatchBytes),
    ),
  ]);
  assert.notEqual(
    workerMismatch.payload.previous_commit_record_sha256,
    vector.previous_head.record_sha256,
  );
  assert.notEqual(
    domainMismatch.payload.previous_commit_record_sha256,
    vector.previous_head.record_sha256,
  );
  assert.throws(() =>
    assertReleaseCommitRecordMatchesAttempt(
      domainMismatch,
      vector.pending_attempt,
    ),
  );
});

test("UInt64 overflow and signature domains fail closed", async () => {
  assert.throws(() =>
    parseCanonicalUnsignedDecimal(vector.cases.uint64_overflow, "golden UInt64"),
  );
  assert.equal(
    vector.cases.uint64_overflow,
    "18446744073709551616",
  );
});
