import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import {
  canonicalJsonBytes,
  createFreshnessIssueCurrentStateBinding,
  createFreshnessCurrentStateReader,
  createFreshnessReleaseStateReader,
  verifyFreshnessManifestBinding,
  verifyRuntimeConfigManifestEpochPointer,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigReleaseCommitRecord,
  runtimeConfigFreshnessWire,
} from "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/index.ts";
import {
  createTlsnRuntimeConfigDelegatedEnvelopeRaw,
  tlsnRuntimeConfigApprovedConfigurationSha256,
  tlsnRuntimeConfigDelegatedSigningBytes,
} from "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs";
import {
  createR2RuntimeConfigFreshnessManifestStore,
} from "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-r2-store.mjs";

export const vector = JSON.parse(
  readFileSync(
    new URL(
      "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/test/fixtures/freshness-v1-golden.json",
      import.meta.url,
    ),
  ),
);
export const requestBytes = Buffer.from(
  vector.request_raw_base64url,
  "base64url",
);
export const responseBytes = Buffer.from(
  vector.response_raw_base64url,
  "base64url",
);
export const requestObject = JSON.parse(requestBytes.toString("utf8"));
export const rootSigner = Object.freeze({ ...vector.root_signer });
export const responsePayload = JSON.parse(
  Buffer.from(
    JSON.parse(responseBytes.toString("utf8")).payload_base64url,
    "base64url",
  ).toString("utf8"),
);
export const signedAtMs = Date.parse(responsePayload.issued_at);
export const clockId = "local-worker-runtime-test-clock";
export const clockEpoch = "local-worker-runtime-test-epoch-1";
const manifestVector = JSON.parse(
  readFileSync(
    new URL(
      "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-independent-v2-vector.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const TEST_KEY_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);
const TEST_ONLY_PROOF_DOMAIN = Buffer.from(
  "FUSOU-LOCAL-TEST-ONLY-FRESHNESS-PROOF-V1\0",
  "ascii",
);
const DELEGATION_DOMAIN = Buffer.from(
  "FUSOU-TLSN-RUNTIME-CONFIG-DELEGATION-V1\0",
  "ascii",
);
const RELEASE_COMMIT_DOMAIN = Buffer.from(
  "FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-COMMIT-V1\0",
  "ascii",
);
const MANIFEST_DOMAIN = Buffer.from(
  "FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0",
  "ascii",
);
const MANIFEST_DELEGATION_DOMAIN = Buffer.from(
  "FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-DELEGATION-V1\0",
  "ascii",
);
const FRESHNESS_RESPONSE_DOMAIN = Buffer.from(
  "FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0",
  "ascii",
);

const releaseRecordBytes = Buffer.from(
  vector.release_commit_record_raw_base64url,
  "base64url",
);
const releaseDelegationBytes = Buffer.from(
  vector.release_delegation_raw_base64url,
  "base64url",
);
const manifestBytes = Buffer.from(vector.manifest_raw_base64url, "base64url");
const nonceBytes = Buffer.alloc(32, 0xA5);

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

export function equalBytes(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}

export async function makeSignedCurrentStateFixture(options = {}) {
  const nowMs = options.nowMs ?? vector.now_ms;
  const rootKey = testKey(0x10, "local-test-root");
  const manifestRootKey = testKey(0xB0, "local-test-manifest-root");
  const manifestChildKey = testKey(0xD0, "local-test-manifest-child");
  const releaseKey = testKey(0x30, "local-test-release");
  const freshnessKey = testKey(0x50, "local-test-freshness");
  const journalKey = testKey(0x70, "local-test-journal");
  const witnessKey = testKey(0x90, "local-test-witness");
  const testRootSigner = Object.freeze({
    scope: "fusou-tlsn-runtime-config-signing-root-v2",
    key_id: rootKey.keyId,
    public_key_spki: rootKey.publicKeySpki,
  });
  const manifestRootSigner = Object.freeze({
    scope: "fusou-tlsn-runtime-config-signing-root-v2",
    key_id: manifestRootKey.keyId,
    public_key_spki: manifestRootKey.publicKeySpki,
  });
  const manifestTemplate = JSON.parse(manifestVector.manifest_envelope_utf8);
  const manifestPayload = JSON.parse(
    Buffer.from(manifestTemplate.payload_base64url, "base64url").toString("utf8"),
  );
  const manifestLifetimeMs =
    Date.parse(manifestPayload.expires_at) -
    Date.parse(manifestPayload.not_before);
  const manifestIssuedAt = iso(nowMs - 60_000);
  manifestPayload.issued_at = manifestIssuedAt;
  manifestPayload.not_before = manifestIssuedAt;
  manifestPayload.expires_at = iso(nowMs + manifestLifetimeMs);
  manifestPayload.source.observed_at = manifestIssuedAt;
  manifestPayload.epoch = options.manifestEpoch ?? "1";
  const manifestBytes = options.delegatedManifest === true
    ? signDelegatedManifestEnvelope({
        payload: manifestPayload,
        manifestUrl: vector.manifest_url,
        nowMs,
        root: manifestRootKey,
        child: manifestChildKey,
      })
    : signManifestEnvelope(manifestPayload, manifestRootKey);
  const manifest = await verifyRuntimeConfigManifestEpochPointer({
    raw: manifestBytes,
    trustedSigner: manifestRootSigner,
    manifestUrl: vector.manifest_url,
    nowMs,
  });
  const previousReleaseHead = options.previousReleaseHead ?? null;
  const commitGeneration =
    previousReleaseHead === null
      ? "1"
      : (BigInt(previousReleaseHead.generation) + 1n).toString(10);
  const releaseCommitId =
    previousReleaseHead === null
      ? "00000000-0000-4000-8000-000000000313"
      : randomUUID();
  const issuedAt = iso(nowMs - 60_000);
  const releaseDelegationPayload = {
    schema_version: 1,
    scope: runtimeConfigFreshnessWire.delegationPayloadScope,
    delegation_id: "00000000-0000-4000-8000-000000000311",
    delegation_generation: "1",
    environment: "production",
    purpose: "release-commit-record-v1",
    key_id: releaseKey.keyId,
    public_key_spki: releaseKey.publicKeySpki,
    signature_algorithm: "Ed25519",
    audience: `${runtimeConfigFreshnessWire.releaseAudiencePrefix}production`,
    issued_at: issuedAt,
    not_before: issuedAt,
    not_after: iso(
      options.releaseDelegationNotAfterMs ??
        Date.parse(issuedAt) +
          runtimeConfigFreshnessWire.maxReleaseDelegationLifetimeSeconds * 1_000,
    ),
    max_validity_seconds:
      runtimeConfigFreshnessWire.maxReleaseDelegationLifetimeSeconds,
    revocation_mode: "expiry-only-v1",
    previous_delegation_sha256: null,
  };
  const freshnessDelegationPayload = {
    schema_version: 1,
    scope: runtimeConfigFreshnessWire.delegationPayloadScope,
    delegation_id: "00000000-0000-4000-8000-000000000312",
    delegation_generation: "1",
    environment: "production",
    purpose: "freshness-response-v1",
    key_id: freshnessKey.keyId,
    public_key_spki: freshnessKey.publicKeySpki,
    signature_algorithm: "Ed25519",
    audience: requestObject.audience_manifest_url_sha256,
    issued_at: issuedAt,
    not_before: issuedAt,
    not_after: iso(
      options.freshnessDelegationNotAfterMs ??
        Date.parse(issuedAt) +
          runtimeConfigFreshnessWire.maxFreshnessDelegationLifetimeSeconds * 1_000,
    ),
    max_validity_seconds:
      runtimeConfigFreshnessWire.maxFreshnessDelegationLifetimeSeconds,
    revocation_mode: "expiry-only-v1",
    previous_delegation_sha256: null,
  };
  const releaseDelegationBytes = signDomainEnvelope({
    scope: runtimeConfigFreshnessWire.delegationEnvelopeScope,
    keyField: "root_key_id",
    keyId: rootKey.keyId,
    domain: DELEGATION_DOMAIN,
    payload: releaseDelegationPayload,
    signer: rootKey,
  });
  const freshnessDelegationBytes = signDomainEnvelope({
    scope: runtimeConfigFreshnessWire.delegationEnvelopeScope,
    keyField: "root_key_id",
    keyId: rootKey.keyId,
    domain: DELEGATION_DOMAIN,
    payload: freshnessDelegationPayload,
    signer: rootKey,
  });
  const manifestRef =
    `${runtimeConfigFreshnessWire.immutableManifestPrefix}${manifest.manifestSha256}`;
  const pointerEtag = options.pointerEtag ?? "r2-test-manifest-etag";
  const appendedAt = iso(nowMs - 5_000);
  const releasePayload = {
    schema_version: 1,
    scope: runtimeConfigFreshnessWire.releasePayloadScope,
    environment: "production",
    commit_authorization: "AUTHORIZE_JOURNAL_APPEND",
    commit_generation: commitGeneration,
    release_commit_id: releaseCommitId,
    manifest_schema_version: 2,
    manifest_epoch: manifest.epoch,
    manifest_sha256: manifest.manifestSha256,
    manifest_ref: manifestRef,
    pointer_etag: pointerEtag,
    previous_commit_generation: previousReleaseHead?.generation ?? null,
    previous_commit_record_sha256:
      previousReleaseHead?.recordSha256 ?? null,
    authorized_at: iso(nowMs - 10_000),
    release_authority_delegation_id:
      releaseDelegationPayload.delegation_id,
    release_authority_delegation_sha256: digest(releaseDelegationBytes),
  };
  const releaseRecordBytes = signDomainEnvelope({
    scope: runtimeConfigFreshnessWire.releaseEnvelopeScope,
    keyField: "signer_key_id",
    keyId: releaseKey.keyId,
    domain: RELEASE_COMMIT_DOMAIN,
    payload: releasePayload,
    signer: releaseKey,
  });
  const verifiedRelease = await verifyRuntimeConfigReleaseCommitRecord({
    raw: releaseRecordBytes,
    rootSigner: testRootSigner,
    environment: "production",
    releaseDelegationRaw: releaseDelegationBytes,
    appendedAt,
  });
  const responsePayload = {
    schema_version: 1,
    scope: runtimeConfigFreshnessWire.responsePayloadScope,
    freshness_semantics: "LATEST_AT_ISSUANCE",
    environment: "production",
    audience_manifest_url_sha256: requestObject.audience_manifest_url_sha256,
    request_nonce: requestObject.request_nonce,
    issued_at: iso(nowMs),
    expires_at: iso(nowMs + runtimeConfigFreshnessWire.maxResponseLifetimeMs),
    latest_epoch: manifest.epoch,
    manifest_schema_version: 2,
    manifest_sha256: manifest.manifestSha256,
    manifest_ref: manifestRef,
    pointer_generation: releasePayload.commit_generation,
    release_commit_id: releasePayload.release_commit_id,
    release_commit_record_sha256: verifiedRelease.digest,
    release_commit_record_appended_at: appendedAt,
    freshness_signer_key_id: freshnessKey.keyId,
    freshness_delegation_id: freshnessDelegationPayload.delegation_id,
    freshness_delegation_sha256: digest(freshnessDelegationBytes),
    release_authority_key_id: releaseKey.keyId,
    release_authority_delegation_id:
      releaseDelegationPayload.delegation_id,
    release_authority_delegation_sha256: digest(releaseDelegationBytes),
  };
  const responsePayloadBytes = Buffer.from(canonicalJsonBytes(responsePayload));
  const responseSignature = sign(
    null,
    runtimeConfigSigningBytes(
      FRESHNESS_RESPONSE_DOMAIN,
      freshnessKey.keyId,
      responsePayloadBytes,
    ),
    freshnessKey.privateKey,
  );
  const responseBytes = Buffer.from(
    canonicalJsonBytes({
      schema_version: 1,
      scope: runtimeConfigFreshnessWire.responseEnvelopeScope,
      signature_algorithm: "Ed25519",
      signer_key_id: freshnessKey.keyId,
      freshness_delegation_base64url:
        freshnessDelegationBytes.toString("base64url"),
      release_authority_delegation_base64url:
        releaseDelegationBytes.toString("base64url"),
      release_commit_record_base64url:
        releaseRecordBytes.toString("base64url"),
      payload_base64url: responsePayloadBytes.toString("base64url"),
      signature_base64url: responseSignature.toString("base64url"),
    }),
  );
  const journalEvidence = {
    recordBytes: Uint8Array.from(releaseRecordBytes),
    releaseDelegationBytes: Uint8Array.from(releaseDelegationBytes),
    appendedAt,
    appendReceiptBytes: new Uint8Array(),
    currentHeadProofBytes: new Uint8Array(),
  };
  const journalReceiptBytes = makeTestOnlyProof(
    "test-only-journal-append-receipt",
    {
      chainId: "test-release-chain-v1",
      environment: "production",
      headPosition: commitGeneration,
      generation: releasePayload.commit_generation,
      recordSha256: verifiedRelease.digest,
      releaseDelegationSha256: digest(releaseDelegationBytes),
      previousRecordSha256: releasePayload.previous_commit_record_sha256,
      appendTimeSourceId: "test-only-journal-clock",
      appendTimeUncertaintyMs: 0,
      manifestEpoch: manifest.epoch,
      manifestSha256: manifest.manifestSha256,
      manifestRef,
      pointerEtag,
      appendedAt,
    },
    journalKey,
  );
  journalEvidence.appendReceiptBytes = journalReceiptBytes;
  journalEvidence.currentHeadProofBytes = new Uint8Array();
  const journalVerifier = {
    async verifyCurrentHead(observed, readContext) {
      const receipt = verifyTestOnlyProof(
        observed.appendReceiptBytes,
        "test-only-journal-append-receipt",
        journalKey,
      );
      const head = verifyTestOnlyProof(
        observed.currentHeadProofBytes,
        "test-only-journal-current-head",
        journalKey,
      );
      const rawClaims = {
        chainId: "test-release-chain-v1",
        environment: "production",
        headPosition: commitGeneration,
        generation: releasePayload.commit_generation,
        recordSha256: digest(observed.recordBytes),
        releaseDelegationSha256: digest(observed.releaseDelegationBytes),
        previousRecordSha256: releasePayload.previous_commit_record_sha256,
        appendTimeSourceId: "test-only-journal-clock",
        appendTimeUncertaintyMs: receipt.appendTimeUncertaintyMs,
        manifestEpoch: manifest.epoch,
        manifestSha256: manifest.manifestSha256,
        manifestRef,
        pointerEtag,
        appendedAt: observed.appendedAt,
      };
      assert.deepEqual(receipt, rawClaims);
      assert.equal(head.headRole, "latest");
      assert.equal(head.headPosition, commitGeneration);
      assert.equal(head.readContextSha256, readContext.readContextSha256);
      assert.equal(head.appendReceiptSha256, digest(observed.appendReceiptBytes));
      assert.equal(
        head.observedAtMs,
        readContext.clock.nowMs + source.journalObservedAtOffsetMs,
      );
      assert.equal(head.clockId, readContext.clock.clockId);
      assert.equal(head.clockEpoch, readContext.clock.clockEpoch);
      assert.equal(
        head.clockUncertaintyMs,
        readContext.clock.uncertaintyMs,
      );
      for (const [name, value] of Object.entries(rawClaims)) {
        assert.equal(head[name], value);
      }
      return {
        providerId: "test-only-journal",
        chainId: head.chainId,
        environment: head.environment,
        readContextSha256: head.readContextSha256,
        headPosition: head.headPosition,
        previousRecordSha256: head.previousRecordSha256,
        observedAtMs: head.observedAtMs,
        clockId: head.clockId,
        clockEpoch: head.clockEpoch,
        clockUncertaintyMs: head.clockUncertaintyMs,
        appendTimeSourceId: head.appendTimeSourceId,
        appendTimeUncertaintyMs: head.appendTimeUncertaintyMs,
        generation: head.generation,
        recordSha256: head.recordSha256,
        releaseDelegationSha256: head.releaseDelegationSha256,
        manifestEpoch: head.manifestEpoch,
        manifestSha256: head.manifestSha256,
        manifestRef: head.manifestRef,
        pointerEtag: head.pointerEtag,
        appendedAt: head.appendedAt,
        appendReceiptSha256: digest(observed.appendReceiptBytes),
        currentHeadProofSha256: digest(observed.currentHeadProofBytes),
      };
    },
  };
  const witnessValue = {
    sourceId: "test-only-independent-witness",
    restoreEpoch: clockEpoch,
    generation: releasePayload.commit_generation,
    recordSha256: verifiedRelease.digest,
  };
  const witnessEvidence = {
    ...witnessValue,
    signedBytes: makeTestOnlyProof(
      "test-only-rollback-witness",
      witnessValue,
      witnessKey,
    ),
  };
  const witnessVerifier = {
    async verifyExternalWitness(signedBytes, readContext) {
      const payload = verifyTestOnlyProof(
        signedBytes,
        "test-only-rollback-witness",
        witnessKey,
      );
      assert.deepEqual(payload, {
        ...witnessValue,
        chainId: readContext.chainId,
        environment: readContext.environment,
        checkpointSequence: commitGeneration,
        readContextSha256: readContext.readContextSha256,
        observedAtMs:
          readContext.clock.nowMs + source.witnessObservedAtOffsetMs,
        clockId: readContext.clock.clockId,
        clockEpoch: readContext.clock.clockEpoch,
        clockUncertaintyMs: readContext.clock.uncertaintyMs,
      });
      return {
        ...payload,
        proofSha256: digest(signedBytes),
      };
    },
  };
  const antiRollbackWitness = {
    readCurrentWitness: async (readContext) => {
      const observed = copyWitnessEvidence(source.witnessEvidence);
      const signedBytes = makeTestOnlyProof(
        "test-only-rollback-witness",
        {
          sourceId: observed.sourceId,
          restoreEpoch: observed.restoreEpoch,
          generation: observed.generation,
          recordSha256: observed.recordSha256,
          chainId: readContext.chainId,
          environment: readContext.environment,
          checkpointSequence: commitGeneration,
          readContextSha256: readContext.readContextSha256,
          observedAtMs:
            readContext.clock.nowMs + source.witnessObservedAtOffsetMs,
          clockId: readContext.clock.clockId,
          clockEpoch: readContext.clock.clockEpoch,
          clockUncertaintyMs: readContext.clock.uncertaintyMs,
        },
        witnessKey,
      );
      if (source.corruptRollbackWitness) {
        signedBytes[0] ^= 1;
      }
      return { ...observed, signedBytes };
    },
    verifier: witnessVerifier,
  };
  const manifests = createR2RuntimeConfigFreshnessManifestStore({
    getManifestState: async () => ({
      etag: source.pointerEtag,
      body: Uint8Array.from(source.pointerBytes),
    }),
    getObject: async (reference) =>
      reference === source.immutableReference
        ? Uint8Array.from(source.immutableSnapshotBytes)
        : null,
  });
  const source = {
    journalEvidence: copyJournalEvidence(journalEvidence),
    pointerEtag,
    pointerBytes: Uint8Array.from(manifestBytes),
    immutableSnapshotBytes: Uint8Array.from(manifestBytes),
    immutableReference: manifestRef,
    witnessEvidence: copyWitnessEvidence(witnessEvidence),
    corruptCurrentHeadProof: false,
    corruptRollbackWitness: false,
    journalObservedAtOffsetMs: 0,
    journalAppendTimeUncertaintyMs: 0,
    witnessObservedAtOffsetMs: 0,
  };
  const verifiedWitness = {
    ...witnessValue,
    proofSha256: digest(witnessEvidence.signedBytes),
  };
  const verifiedState = Object.freeze({
    source: "verified-journal-do-r2-snapshot",
    freshnessSemantics: "LATEST_AT_ISSUANCE",
    environment: "production",
    journalHead: Object.freeze({
      generation: releasePayload.commit_generation,
      record_sha256: verifiedRelease.digest,
      manifest_epoch: manifest.epoch,
    }),
    releaseCommitRecord: verifiedRelease.envelope,
    verifiedReleaseCommitRecord: verifiedRelease,
    releaseCommitRecordSha256: verifiedRelease.digest,
    journalAppendedAt: appendedAt,
    manifestBytes: Uint8Array.from(manifestBytes),
    manifestSha256: manifest.manifestSha256,
    manifestRef,
    pointerEtag,
    pointerGeneration: releasePayload.commit_generation,
    manifestEpoch: manifest.epoch,
    antiRollbackWitness: {
      sourceId: verifiedWitness.sourceId,
      restoreEpoch: verifiedWitness.restoreEpoch,
      generation: verifiedWitness.generation,
      recordSha256: verifiedWitness.recordSha256,
    },
  });
  const currentState = await createFreshnessIssueCurrentStateBinding(verifiedState);
  const releaseHead = {
    environment: "production",
    chainId: "test-release-chain-v1",
    position: commitGeneration,
    generation: releasePayload.commit_generation,
    recordSha256: verifiedRelease.digest,
    recordBytes: Uint8Array.from(releaseRecordBytes),
    releaseDelegationBytes: Uint8Array.from(releaseDelegationBytes),
    previousRecordSha256: releasePayload.previous_commit_record_sha256,
    releaseCommitId: releasePayload.release_commit_id,
    localAppendObservedAt: appendedAt,
    manifestEpoch: manifest.epoch,
    manifestSha256: manifest.manifestSha256,
    manifestRef,
    pointerEtag,
    manifestBytes: Uint8Array.from(manifestBytes),
  };
  return {
    rootSigner: testRootSigner,
    manifestRootSigner,
    manifestUrl: vector.manifest_url,
    freshnessKeyId: freshnessKey.keyId,
    freshnessPrivateKeyPkcs8Bytes: Uint8Array.from(
      freshnessKey.privateKey.export({ format: "der", type: "pkcs8" }),
    ),
    freshnessDelegationBytes: Uint8Array.from(freshnessDelegationBytes),
    nowMs,
    currentState,
    witness: { ...witnessValue },
    responseBytes,
    manifestBytes: Uint8Array.from(manifestBytes),
    manifestEpoch: manifest.epoch,
    manifestSha256: manifest.manifestSha256,
    manifestRef,
    pointerEtag,
    recordBytes: Uint8Array.from(releaseRecordBytes),
    releaseDelegationBytes: Uint8Array.from(releaseDelegationBytes),
    recordAppendedAt: appendedAt,
    releaseHead,
    journalVerifier,
    antiRollbackWitness,
    manifests,
    source,
    journal: {
      readCurrentHead: async (readContext) => {
        const observed = copyJournalEvidence(source.journalEvidence);
        if (source.journalAppendTimeUncertaintyMs !== 0) {
          const receipt = verifyTestOnlyProof(
            observed.appendReceiptBytes,
            "test-only-journal-append-receipt",
            journalKey,
          );
          observed.appendReceiptBytes = makeTestOnlyProof(
            "test-only-journal-append-receipt",
            {
              ...receipt,
              appendTimeUncertaintyMs:
                source.journalAppendTimeUncertaintyMs,
            },
            journalKey,
          );
        }
        const receipt = verifyTestOnlyProof(
          observed.appendReceiptBytes,
          "test-only-journal-append-receipt",
          journalKey,
        );
        const currentHeadProofBytes = makeTestOnlyProof(
          "test-only-journal-current-head",
          {
            ...receipt,
            headRole: "latest",
            headPosition: commitGeneration,
            appendReceiptSha256: digest(observed.appendReceiptBytes),
            readContextSha256: readContext.readContextSha256,
            observedAtMs:
              readContext.clock.nowMs + source.journalObservedAtOffsetMs,
            clockId: readContext.clock.clockId,
            clockEpoch: readContext.clock.clockEpoch,
            clockUncertaintyMs: readContext.clock.uncertaintyMs,
          },
          journalKey,
        );
        if (source.corruptCurrentHeadProof) {
          currentHeadProofBytes[0] ^= 1;
        }
        return { ...observed, currentHeadProofBytes };
      },
      verifier: journalVerifier,
    },
  };
}

export async function makeSignedNextReleaseRecord(
  previousFixture,
  nextFixture,
  pointerEtag,
) {
  const releaseKey = testKey(0x30, "local-test-release");
  const releaseDelegationBytes = Uint8Array.from(
    nextFixture.releaseDelegationBytes,
  );
  const delegationEnvelope = JSON.parse(
    Buffer.from(releaseDelegationBytes).toString("utf8"),
  );
  const delegationPayload = JSON.parse(
    Buffer.from(delegationEnvelope.payload_base64url, "base64url").toString(
      "utf8",
    ),
  );
  const previous = previousFixture.releaseHead;
  const generation = (BigInt(previous.generation) + 1n).toString(10);
  const releaseCommitId = randomUUID();
  const payload = {
    schema_version: 1,
    scope: runtimeConfigFreshnessWire.releasePayloadScope,
    environment: "production",
    commit_authorization: "AUTHORIZE_JOURNAL_APPEND",
    commit_generation: generation,
    release_commit_id: releaseCommitId,
    manifest_schema_version: 2,
    manifest_epoch: nextFixture.manifestEpoch,
    manifest_sha256: nextFixture.manifestSha256,
    manifest_ref: nextFixture.manifestRef,
    pointer_etag: pointerEtag,
    previous_commit_generation: previous.generation,
    previous_commit_record_sha256: previous.recordSha256,
    authorized_at: iso(vector.now_ms - 5_000),
    release_authority_delegation_id: delegationPayload.delegation_id,
    release_authority_delegation_sha256: digest(releaseDelegationBytes),
  };
  const recordBytes = signDomainEnvelope({
    scope: runtimeConfigFreshnessWire.releaseEnvelopeScope,
    keyField: "signer_key_id",
    keyId: releaseKey.keyId,
    domain: RELEASE_COMMIT_DOMAIN,
    payload,
    signer: releaseKey,
  });
  const verified = await verifyRuntimeConfigReleaseCommitRecord({
    raw: recordBytes,
    rootSigner: nextFixture.rootSigner,
    environment: "production",
    releaseDelegationRaw: releaseDelegationBytes,
    appendedAt: iso(vector.now_ms),
  });
  return {
    recordBytes: Uint8Array.from(recordBytes),
    releaseDelegationBytes,
    recordSha256: verified.digest,
    generation,
    releaseCommitId,
  };
}

export function makeSignedCurrentStateReader(
  fixture,
  coordinator,
  overrides = {},
) {
  return createFreshnessCurrentStateReader({
    coordinator,
    journal: {
      expectedProviderId:
        overrides.expectedProviderId ?? "test-only-journal",
      expectedChainId:
        overrides.expectedChainId ?? "test-release-chain-v1",
      expectedAppendTimeSourceId:
        overrides.expectedAppendTimeSourceId ?? "test-only-journal-clock",
      readCurrentHead:
        overrides.readCurrentHead ??
        ((readContext) => fixture.journal.readCurrentHead(readContext)),
      verifier: overrides.journalVerifier ?? fixture.journalVerifier,
    },
    manifests: {
      readCurrentManifestPointer:
        overrides.readCurrentManifestPointer ??
        (() => fixture.manifests.readCurrentManifestPointer()),
      readImmutableManifestSnapshot:
        overrides.readImmutableManifestSnapshot ??
        ((reference) =>
          fixture.manifests.readImmutableManifestSnapshot(reference)),
    },
    antiRollbackWitness: {
      expectedSourceId:
        overrides.expectedSourceId ?? "test-only-independent-witness",
      readCurrentWitness:
        overrides.readCurrentWitness ??
        ((readContext) =>
          fixture.antiRollbackWitness.readCurrentWitness(readContext)),
      verifier:
        overrides.antiRollbackWitnessVerifier ??
        fixture.antiRollbackWitness.verifier,
    },
    releaseRootSigner:
      overrides.releaseRootSigner ?? fixture.rootSigner,
    manifestRootSigner:
      overrides.manifestRootSigner ?? fixture.manifestRootSigner,
    manifestUrl: overrides.manifestUrl ?? fixture.manifestUrl,
  });
}

export function makeSignedReleaseStateReader(
  fixture,
  manifests = fixture.manifests,
  overrides = {},
) {
  return createFreshnessReleaseStateReader({
    journal: {
      expectedProviderId: overrides.expectedProviderId ?? "test-only-journal",
      expectedChainId: overrides.expectedChainId ?? "test-release-chain-v1",
      expectedAppendTimeSourceId:
        overrides.expectedAppendTimeSourceId ?? "test-only-journal-clock",
      readCurrentHead:
        overrides.readCurrentHead ??
        ((readContext) => fixture.journal.readCurrentHead(readContext)),
      verifier: overrides.journalVerifier ?? fixture.journalVerifier,
    },
    manifests,
    antiRollbackWitness: {
      expectedSourceId:
        overrides.expectedSourceId ?? "test-only-independent-witness",
      readCurrentWitness:
        overrides.readCurrentWitness ??
        ((readContext) =>
          fixture.antiRollbackWitness.readCurrentWitness(readContext)),
      verifier:
        overrides.antiRollbackWitnessVerifier ??
        fixture.antiRollbackWitness.verifier,
    },
    releaseRootSigner: fixture.rootSigner,
    manifestRootSigner: fixture.manifestRootSigner,
    manifestUrl: fixture.manifestUrl,
  });
}

function testKey(seedStart, keyId) {
  const seed = Buffer.from(
    Array.from({ length: 32 }, (_, index) => (seedStart + index) & 0xff),
  );
  const privateKey = createPrivateKey({
    key: Buffer.concat([TEST_KEY_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return {
    keyId,
    privateKey,
    publicKey: createPublicKey(privateKey),
    publicKeySpki: createPublicKey(privateKey)
      .export({ format: "der", type: "spki" })
      .toString("base64url"),
  };
}

function signDomainEnvelope({ scope, keyField, keyId, domain, payload, signer }) {
  const payloadBytes = Buffer.from(canonicalJsonBytes(payload));
  const signature = sign(
    null,
    runtimeConfigSigningBytes(domain, keyId, payloadBytes),
    signer.privateKey,
  );
  return Buffer.from(
    canonicalJsonBytes({
      schema_version: 1,
      scope,
      signature_algorithm: "Ed25519",
      [keyField]: keyId,
      payload_base64url: payloadBytes.toString("base64url"),
      signature_base64url: signature.toString("base64url"),
    }),
  );
}

function signManifestEnvelope(payload, signer) {
  const payloadBytes = Buffer.from(canonicalJsonBytes(payload));
  const signature = sign(
    null,
    runtimeConfigSigningBytes(MANIFEST_DOMAIN, signer.keyId, payloadBytes),
    signer.privateKey,
  );
  return Buffer.from(
    canonicalJsonBytes({
      schema_version: 2,
      scope: "fusou-tlsn-runtime-config-envelope-v2",
      signature_algorithm: "Ed25519",
      signer_key_id: signer.keyId,
      payload_base64url: payloadBytes.toString("base64url"),
      signature_base64url: signature.toString("base64url"),
    }),
  );
}

function signDelegatedManifestEnvelope({
  payload,
  manifestUrl,
  nowMs,
  root,
  child,
}) {
  const issuedAt = payload.issued_at;
  const delegationPayload = {
    schema_version: 1,
    scope: "fusou-tlsn-runtime-config-manifest-delegation-v1",
    purpose: "runtime-config-manifest-v1",
    environment: payload.environment,
    key_id: child.keyId,
    public_key_spki: child.publicKeySpki,
    signature_algorithm: "Ed25519",
    audience_manifest_url_sha256: digest(
      new TextEncoder().encode(manifestUrl),
    ),
    manifest_envelope_schema_version: 3,
    manifest_payload_schema_version: payload.schema_version,
    approved_config_sha256: tlsnRuntimeConfigApprovedConfigurationSha256(
      payload,
      manifestUrl,
    ),
    delegation_generation: "1",
    issued_at: issuedAt,
    not_before: issuedAt,
    not_after: iso(Date.parse(issuedAt) + 86_400_000),
    max_validity_seconds: 86_400,
    revocation_mode: "expiry-and-client-high-water-v1",
  };
  const delegationRaw = signDomainEnvelope({
    scope: "fusou-tlsn-runtime-config-manifest-delegation-v1",
    keyField: "root_key_id",
    keyId: root.keyId,
    domain: MANIFEST_DELEGATION_DOMAIN,
    payload: delegationPayload,
    signer: root,
  });
  const payloadBytes = Buffer.from(canonicalJsonBytes(payload));
  const signature = sign(
    null,
    tlsnRuntimeConfigDelegatedSigningBytes(
      child.keyId,
      payload,
      new Date(nowMs),
    ),
    child.privateKey,
  );
  return Buffer.from(
    createTlsnRuntimeConfigDelegatedEnvelopeRaw({
      signerKeyId: child.keyId,
      payloadBase64Url: payloadBytes.toString("base64url"),
      signatureBase64Url: signature.toString("base64url"),
      manifestAuthorityDelegationRaw: delegationRaw,
    }),
    "utf8",
  );
}

function makeTestOnlyProof(scope, payload, signer) {
  const payloadBytes = Buffer.from(canonicalJsonBytes(payload));
  const signature = sign(
    null,
    runtimeConfigSigningBytes(TEST_ONLY_PROOF_DOMAIN, signer.keyId, payloadBytes),
    signer.privateKey,
  );
  return Buffer.from(
    canonicalJsonBytes({
      schema_version: 1,
      scope,
      key_id: signer.keyId,
      payload_base64url: payloadBytes.toString("base64url"),
      signature_base64url: signature.toString("base64url"),
    }),
  );
}

function verifyTestOnlyProof(raw, expectedScope, signer) {
  const envelopeBytes = Buffer.from(raw);
  const envelope = JSON.parse(envelopeBytes.toString("utf8"));
  assert.ok(equalBytes(envelopeBytes, canonicalJsonBytes(envelope)));
  assert.deepEqual(
    Object.keys(envelope).sort(),
    [
      "key_id",
      "payload_base64url",
      "schema_version",
      "scope",
      "signature_base64url",
    ],
  );
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.scope, expectedScope);
  assert.equal(envelope.key_id, signer.keyId);
  const payloadBytes = Buffer.from(envelope.payload_base64url, "base64url");
  assert.equal(payloadBytes.toString("base64url"), envelope.payload_base64url);
  assert.ok(
    verify(
      null,
      runtimeConfigSigningBytes(
        TEST_ONLY_PROOF_DOMAIN,
        signer.keyId,
        payloadBytes,
      ),
      signer.publicKey,
      Buffer.from(envelope.signature_base64url, "base64url"),
    ),
  );
  const payload = JSON.parse(payloadBytes.toString("utf8"));
  assert.ok(equalBytes(payloadBytes, canonicalJsonBytes(payload)));
  return payload;
}

function runtimeConfigSigningBytes(domain, keyId, payloadBytes) {
  const keyIdBytes = Buffer.from(keyId, "ascii");
  const keyIdLength = Buffer.alloc(2);
  keyIdLength.writeUInt16BE(keyIdBytes.byteLength);
  return Buffer.concat([domain, keyIdLength, keyIdBytes, payloadBytes]);
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function copyJournalEvidence(evidence) {
  return {
    recordBytes: Uint8Array.from(evidence.recordBytes),
    releaseDelegationBytes: Uint8Array.from(evidence.releaseDelegationBytes),
    appendedAt: evidence.appendedAt,
    appendReceiptBytes: Uint8Array.from(evidence.appendReceiptBytes),
    currentHeadProofBytes: Uint8Array.from(evidence.currentHeadProofBytes),
  };
}

function copyWitnessEvidence(witness) {
  return {
    sourceId: witness.sourceId,
    restoreEpoch: witness.restoreEpoch,
    generation: witness.generation,
    recordSha256: witness.recordSha256,
    signedBytes: Uint8Array.from(witness.signedBytes),
  };
}

export async function makeVerifiedCurrentState() {
  const witness = {
    sourceId: "test-only-independent-witness",
    restoreEpoch: clockEpoch,
    generation: vector.pending_attempt.commit_generation,
    recordSha256: digest(releaseRecordBytes),
    signedBytes: Buffer.alloc(0),
  };
  witness.signedBytes = Buffer.from(
    [
      witness.sourceId,
      witness.restoreEpoch,
      witness.generation,
      witness.recordSha256,
    ].join("|"),
  );
  const evidence = {
    journalHead: {
      recordBytes: Uint8Array.from(releaseRecordBytes),
      releaseDelegationBytes: Uint8Array.from(releaseDelegationBytes),
      appendedAt: vector.release_commit_record_appended_at,
      appendReceiptBytes: Buffer.from("test-only-exact-append-receipt"),
      currentHeadProofBytes: Buffer.from("test-only-current-head-proof"),
    },
    coordinatorHead: {
      environment: "production",
      generation: vector.pending_attempt.commit_generation,
      recordSha256: witness.recordSha256,
      manifestEpoch: vector.pending_attempt.manifest_epoch,
      writerPending: false,
      restoreEpoch: clockEpoch,
    },
    pointer: {
      environment: "production",
      etag: vector.pending_attempt.pointer_etag,
      generation: vector.pending_attempt.commit_generation,
      bytes: Uint8Array.from(manifestBytes),
    },
    immutableSnapshot: {
      reference: vector.pending_attempt.manifest_ref,
      bytes: Uint8Array.from(manifestBytes),
    },
    manifestBytes: Uint8Array.from(manifestBytes),
    antiRollbackWitness: witness,
  };

  const releaseCommit = await verifyRuntimeConfigReleaseCommitRecord({
    raw: evidence.journalHead.recordBytes,
    rootSigner,
    environment: "production",
    releaseDelegationRaw: evidence.journalHead.releaseDelegationBytes,
    appendedAt: evidence.journalHead.appendedAt,
  });
  assert.equal(evidence.coordinatorHead.writerPending, false);
  assert.equal(evidence.coordinatorHead.environment, "production");
  assert.equal(
    evidence.coordinatorHead.generation,
    releaseCommit.payload.commit_generation,
  );
  assert.equal(evidence.coordinatorHead.recordSha256, releaseCommit.digest);
  assert.equal(
    evidence.coordinatorHead.manifestEpoch,
    releaseCommit.payload.manifest_epoch,
  );
  assert.equal(evidence.coordinatorHead.restoreEpoch, witness.restoreEpoch);
  assert.equal(witness.generation, releaseCommit.payload.commit_generation);
  assert.equal(witness.recordSha256, releaseCommit.digest);
  assert.deepEqual(
    Buffer.from(witness.signedBytes),
    Buffer.from(
      [
        witness.sourceId,
        witness.restoreEpoch,
        witness.generation,
        witness.recordSha256,
      ].join("|"),
    ),
  );
  assert.ok(evidence.journalHead.appendReceiptBytes.byteLength > 0);
  assert.ok(witness.signedBytes.byteLength > 0);
  assert.equal(evidence.pointer.environment, "production");
  assert.equal(
    evidence.pointer.generation,
    releaseCommit.payload.commit_generation,
  );
  assert.equal(evidence.pointer.etag, releaseCommit.payload.pointer_etag);
  assert.equal(
    evidence.immutableSnapshot.reference,
    releaseCommit.payload.manifest_ref,
  );
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.immutableSnapshot.bytes));
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.manifestBytes));
  assert.equal(digest(evidence.pointer.bytes), releaseCommit.payload.manifest_sha256);

  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256: requestObject.audience_manifest_url_sha256,
  });
  const verifiedResponse = await verifyRuntimeConfigFreshnessResponse({
    raw: responseBytes,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request: challenge,
    nowMs: vector.now_ms,
  });
  await verifyFreshnessManifestBinding(verifiedResponse, evidence.manifestBytes);

  const verifiedState = Object.freeze({
    source: "verified-journal-do-r2-snapshot",
    freshnessSemantics: "LATEST_AT_ISSUANCE",
    environment: "production",
    journalHead: Object.freeze({
      generation: releaseCommit.payload.commit_generation,
      record_sha256: releaseCommit.digest,
      manifest_epoch: releaseCommit.payload.manifest_epoch,
    }),
    releaseCommitRecord: releaseCommit.envelope,
    verifiedReleaseCommitRecord: releaseCommit,
    releaseCommitRecordSha256: releaseCommit.digest,
    journalAppendedAt: evidence.journalHead.appendedAt,
    manifestBytes: Uint8Array.from(evidence.manifestBytes),
    manifestSha256: releaseCommit.payload.manifest_sha256,
    manifestRef: releaseCommit.payload.manifest_ref,
    pointerEtag: releaseCommit.payload.pointer_etag,
    pointerGeneration: releaseCommit.payload.commit_generation,
    manifestEpoch: releaseCommit.payload.manifest_epoch,
    antiRollbackWitness: Object.freeze({
      sourceId: witness.sourceId,
      restoreEpoch: witness.restoreEpoch,
      generation: witness.generation,
      recordSha256: witness.recordSha256,
    }),
  });
  const currentState = await createFreshnessIssueCurrentStateBinding(verifiedState);
  return {
    evidence,
    currentState,
    witness: currentState.antiRollbackWitness,
  };
}

export function makeDifferentRequestBytes() {
  return canonicalJsonBytes({
    ...requestObject,
    request_nonce: nonceBytes.toString("base64url"),
  });
}

export async function makeRequestIdentity(operationId, raw = requestBytes) {
  const audienceManifestUrlSha256 = digest(
    new TextEncoder().encode(vector.manifest_url),
  );
  const challenge = await verifyRuntimeConfigFreshnessRequest(raw, {
    environment: "production",
    audienceManifestUrlSha256,
  });
  return {
    challenge,
    identity: {
      operationId,
      requestSha256: digest(raw),
      requestNonce: challenge.request_nonce,
      environment: challenge.environment,
      audienceManifestUrlSha256: challenge.audience_manifest_url_sha256,
    },
  };
}

export async function verifyFixtureResponse(raw, evidence) {
  const audienceManifestUrlSha256 = digest(
    new TextEncoder().encode(vector.manifest_url),
  );
  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256,
  });
  const verified = await verifyRuntimeConfigFreshnessResponse({
    raw,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request: challenge,
    nowMs: vector.now_ms,
  });
  await verifyFreshnessManifestBinding(verified, evidence.manifestBytes);
  return verified;
}

export async function verifySignedFixtureResponse(
  fixture,
  raw = fixture.responseBytes,
) {
  const audienceManifestUrlSha256 = digest(
    new TextEncoder().encode(vector.manifest_url),
  );
  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256,
  });
  return verifyRuntimeConfigFreshnessResponse({
    raw,
    bootstrapSigner: fixture.rootSigner,
    manifestUrl: vector.manifest_url,
    request: challenge,
    nowMs: vector.now_ms,
  });
}

export function makeCurrentStateReader(evidence) {
  return {
    async readCurrentState(input) {
      const observed = copyEvidence(evidence);
      observed.coordinatorSnapshot = {
        operation: { ...input.operation },
        lease: {
          ...input.lease,
          operation: { ...input.lease.operation },
          currentState: { ...input.lease.currentState },
        },
        operationStatus: "IN_PROGRESS",
        blocker: "RETAINED",
        environment: "production",
        currentState: { ...input.lease.currentState },
        witness: {
          sourceId: observed.antiRollbackWitness.sourceId,
          restoreEpoch: observed.antiRollbackWitness.restoreEpoch,
          generation: observed.antiRollbackWitness.generation,
          recordSha256: observed.antiRollbackWitness.recordSha256,
        },
        restoreEpoch: observed.antiRollbackWitness.restoreEpoch,
        writerPending: false,
      };
      return observed;
    },
    async verifyCurrentState(observed) {
      assert.equal(observed.coordinatorHead.writerPending, false);
      assert.equal(
        observed.coordinatorHead.restoreEpoch,
        observed.antiRollbackWitness.restoreEpoch,
      );
      assert.ok(equalBytes(observed.pointer.bytes, observed.manifestBytes));
      return makeVerifiedStateFromEvidence(observed);
    },
  };
}

async function makeVerifiedStateFromEvidence(evidence) {
  const releaseCommit = await verifyRuntimeConfigReleaseCommitRecord({
    raw: evidence.journalHead.recordBytes,
    rootSigner,
    environment: "production",
    releaseDelegationRaw: evidence.journalHead.releaseDelegationBytes,
    appendedAt: evidence.journalHead.appendedAt,
  });
  assert.equal(evidence.coordinatorHead.generation, releaseCommit.payload.commit_generation);
  assert.equal(evidence.coordinatorHead.recordSha256, releaseCommit.digest);
  assert.equal(evidence.antiRollbackWitness.generation, releaseCommit.payload.commit_generation);
  assert.equal(evidence.antiRollbackWitness.recordSha256, releaseCommit.digest);
  assert.equal(evidence.pointer.generation, releaseCommit.payload.commit_generation);
  assert.equal(evidence.pointer.etag, releaseCommit.payload.pointer_etag);
  assert.equal(evidence.immutableSnapshot.reference, releaseCommit.payload.manifest_ref);
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.immutableSnapshot.bytes));
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.manifestBytes));
  assert.equal(digest(evidence.pointer.bytes), releaseCommit.payload.manifest_sha256);
  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256: requestObject.audience_manifest_url_sha256,
  });
  const verifiedResponse = await verifyRuntimeConfigFreshnessResponse({
    raw: responseBytes,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request: challenge,
    nowMs: vector.now_ms,
  });
  await verifyFreshnessManifestBinding(verifiedResponse, evidence.manifestBytes);
  return Object.freeze({
    source: "verified-journal-do-r2-snapshot",
    freshnessSemantics: "LATEST_AT_ISSUANCE",
    environment: "production",
    journalHead: Object.freeze({
      generation: releaseCommit.payload.commit_generation,
      record_sha256: releaseCommit.digest,
      manifest_epoch: releaseCommit.payload.manifest_epoch,
    }),
    releaseCommitRecord: releaseCommit.envelope,
    verifiedReleaseCommitRecord: releaseCommit,
    releaseCommitRecordSha256: releaseCommit.digest,
    journalAppendedAt: evidence.journalHead.appendedAt,
    manifestBytes: Uint8Array.from(evidence.manifestBytes),
    manifestSha256: releaseCommit.payload.manifest_sha256,
    manifestRef: releaseCommit.payload.manifest_ref,
    pointerEtag: releaseCommit.payload.pointer_etag,
    pointerGeneration: releaseCommit.payload.commit_generation,
    manifestEpoch: releaseCommit.payload.manifest_epoch,
    antiRollbackWitness: Object.freeze({
      sourceId: evidence.antiRollbackWitness.sourceId,
      restoreEpoch: evidence.antiRollbackWitness.restoreEpoch,
      generation: evidence.antiRollbackWitness.generation,
      recordSha256: evidence.antiRollbackWitness.recordSha256,
    }),
  });
}

export function makeTestSigner({
  onIssue,
  responseBytes: signedResponseBytes = responseBytes,
} = {}) {
  return {
    mode: "test-only",
    purpose: "freshness-response-v1",
    calls: 0,
    lastRequest: undefined,
    async issueLatestAtIssuance(request, context) {
      this.calls += 1;
      this.lastRequest = request;
      if (onIssue) return onIssue(request, context);
      return this.completedResult(request);
    },
    async completedResult(request, bytes = signedResponseBytes) {
      return {
        outcome: "COMPLETED",
        issueOperationId: request.issue.operationId,
        signerOperationId: request.issue.signerOperationId,
        requestSha256: request.issue.requestSha256,
        responseBytes: Uint8Array.from(bytes),
        responseSha256: digest(bytes),
        signedAtMs,
        clockId: request.lease.clockId,
        clockEpoch: request.lease.clockEpoch,
        clockUncertaintyMs: request.lease.clockUncertaintyMs,
      };
    },
  };
}

function copyEvidence(evidence) {
  return {
    ...evidence,
    journalHead: {
      ...evidence.journalHead,
      recordBytes: Uint8Array.from(evidence.journalHead.recordBytes),
      releaseDelegationBytes: Uint8Array.from(
        evidence.journalHead.releaseDelegationBytes,
      ),
      appendReceiptBytes: Uint8Array.from(
        evidence.journalHead.appendReceiptBytes,
      ),
      currentHeadProofBytes: Uint8Array.from(
        evidence.journalHead.currentHeadProofBytes,
      ),
    },
    coordinatorHead: { ...evidence.coordinatorHead },
    pointer: {
      ...evidence.pointer,
      bytes: Uint8Array.from(evidence.pointer.bytes),
    },
    immutableSnapshot: {
      ...evidence.immutableSnapshot,
      bytes: Uint8Array.from(evidence.immutableSnapshot.bytes),
    },
    manifestBytes: Uint8Array.from(evidence.manifestBytes),
    antiRollbackWitness: {
      ...evidence.antiRollbackWitness,
      signedBytes: Uint8Array.from(evidence.antiRollbackWitness.signedBytes),
    },
  };
}
