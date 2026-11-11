import {
  canonicalJsonBytes,
  encodeBase64Url,
  runtimeConfigFreshnessWire,
  signRuntimeConfigFreshnessResponseEnvelope,
  verifyRuntimeConfigDelegation,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigManifestEpochPointer,
  verifyRuntimeConfigReleaseCommitRecord,
} from "./domain.ts";
import type {
  FreshnessResponsePayload,
  RuntimeConfigRootSigner,
  VerifiedRuntimeConfigManifestEpochPointer,
} from "./domain.ts";
import type {
  CloudflareOperatorCurrentStateBinding,
  CloudflareOperatorFreshnessSigner,
  CloudflareOperatorIssueAdmission,
  CloudflareOperatorIssueOperationBinding,
  CloudflareOperatorIssueSigningAuthorization,
  CloudflareOperatorIssueSigningClaim,
  CloudflareOperatorReleaseLedgerSnapshot,
  CloudflareOperatorFreshnessSigningRequest,
  VerifiedCloudflareOperatorReleaseState,
} from "./signers.ts";
import { CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID } from "./signers.ts";

export interface CloudflareOperatorManifestStore {
  readCurrentManifestPointer(): Promise<{
    readonly etag: string;
    readonly bytes: Uint8Array;
  } | null>;
  readImmutableManifestSnapshot(reference: string): Promise<{
    readonly reference: string;
    readonly bytes: Uint8Array;
  } | null>;
}

export interface CloudflareOperatorReleaseSnapshotReader {
  readCloudflareOperatorReleaseSnapshot(): Promise<CloudflareOperatorReleaseLedgerSnapshot>;
  readCloudflareOperatorIssueReleaseSnapshot(
    input: CloudflareOperatorIssueSigningAuthorization,
  ): Promise<CloudflareOperatorReleaseLedgerSnapshot>;
}

export interface CloudflareOperatorReleaseStateReader {
  readCurrentState(input?: {
    readonly issueAuthorization?: CloudflareOperatorIssueSigningAuthorization;
  }): Promise<VerifiedCloudflareOperatorReleaseState>;
}

export interface CloudflareOperatorIssueCoordinator {
  beginCloudflareOperatorIssue(input: {
    readonly operationId: string;
    readonly requestBytes: Uint8Array;
    readonly requestSha256: string;
    readonly challengeNonce: string;
    readonly audienceManifestUrlSha256: string;
    readonly chainId: string;
  }): Promise<CloudflareOperatorIssueAdmission>;
  claimCloudflareOperatorIssueSigning(
    input: CloudflareOperatorIssueSigningAuthorization,
  ): Promise<CloudflareOperatorIssueSigningClaim>;
  getCloudflareOperatorIssue(input: {
    readonly operationId: string;
    readonly requestBytes: Uint8Array;
    readonly chainId: string;
  }): Promise<CloudflareOperatorIssueAdmission>;
  markCloudflareOperatorIssueUnknown(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
  }): Promise<CloudflareOperatorIssueAdmission>;
  rejectCloudflareOperatorIssue(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
    readonly reason: string;
  }): Promise<CloudflareOperatorIssueAdmission>;
  finalizeCloudflareOperatorIssue(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
    readonly currentStateSha256: string;
    readonly responseBytes: Uint8Array;
  }): Promise<CloudflareOperatorIssueAdmission>;
}

export interface CloudflareOperatorIssueDependencies {
  readonly manifestUrl: string;
  readonly chainId: string;
  readonly bootstrapSigner: RuntimeConfigRootSigner;
  readonly coordinator: CloudflareOperatorIssueCoordinator;
  readonly currentState: CloudflareOperatorReleaseStateReader;
  readonly signer: CloudflareOperatorFreshnessSigner;
}

export interface CloudflareOperatorIssueInput {
  readonly operationId: string;
  readonly requestBytes: Uint8Array;
}

export type CloudflareOperatorIssueResult =
  | {
      readonly status: "ISSUED" | "ALREADY_FINALIZED";
      readonly operationId: string;
      readonly responseBytes: Uint8Array;
      readonly responseLength: number;
      readonly responseSha256: string;
    }
  | {
      readonly status: "IN_PROGRESS" | "RESULT_UNKNOWN";
      readonly operationId: string;
    }
  | {
      readonly status: "REJECTED" | "CONFLICT";
      readonly operationId: string;
      readonly reason?: string;
    };

export interface CloudflareOperatorReleaseStateReaderDependencies {
  readonly coordinator: CloudflareOperatorReleaseSnapshotReader;
  readonly manifests: CloudflareOperatorManifestStore;
  readonly releaseRootSigner: RuntimeConfigRootSigner;
  readonly manifestRootSigner: RuntimeConfigRootSigner;
}

export class CloudflareOperatorProfileError extends Error {
  readonly code:
    | "PROFILE_MISMATCH"
    | "UNAVAILABLE"
    | "INVALID_EVIDENCE"
    | "INVALID_TIME"
    | "EXPIRED";

  constructor(
    code: CloudflareOperatorProfileError["code"],
    message: string,
  ) {
    super(message);
    this.name = "CloudflareOperatorProfileError";
    this.code = code;
  }
}

export function createCloudflareOperatorReleaseStateReader(
  dependencies: CloudflareOperatorReleaseStateReaderDependencies,
): CloudflareOperatorReleaseStateReader {
  if (
    dependencies.coordinator === null ||
    dependencies.manifests === null ||
    dependencies.releaseRootSigner === null ||
    dependencies.manifestRootSigner === null
  ) {
    throw new CloudflareOperatorProfileError(
      "UNAVAILABLE",
      "Cloudflare/operator profile requires DO, R2, Release root, and Manifest root adapters",
    );
  }

  return Object.freeze({
    async readCurrentState(input?: {
      readonly issueAuthorization?: CloudflareOperatorIssueSigningAuthorization;
    }) {
      const snapshot = await (input?.issueAuthorization === undefined
        ? dependencies.coordinator.readCloudflareOperatorReleaseSnapshot()
        : dependencies.coordinator.readCloudflareOperatorIssueReleaseSnapshot(
            input.issueAuthorization,
          ));
      const observedAtMs = runtimeUtcNow();
      if (
        snapshot.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
        snapshot.environment !== "production" ||
        snapshot.chainId.length === 0
      ) {
        throw new CloudflareOperatorProfileError(
          "PROFILE_MISMATCH",
          "Coordinator snapshot is not bound to the selected Cloudflare/operator profile",
        );
      }
      if (
        !Number.isSafeInteger(snapshot.observedAtMs) ||
        !Number.isSafeInteger(snapshot.lastObservedUtcMs) ||
        observedAtMs < snapshot.observedAtMs ||
        observedAtMs < snapshot.lastObservedUtcMs
      ) {
        throw new CloudflareOperatorProfileError(
          "INVALID_TIME",
          "Runtime UTC observation moved behind the persisted profile observation",
        );
      }
      if (
        snapshot.writerPending ||
        snapshot.issueBlocker ||
        snapshot.currentState === null ||
        snapshot.head === null ||
        snapshot.releaseOperation === null ||
        snapshot.releaseOperation.status !== "AVAILABLE" ||
        snapshot.releaseOperation.fencingToken === null
      ) {
        throw new CloudflareOperatorProfileError(
          "UNAVAILABLE",
          "A current AVAILABLE Release binding without writer or issue blockers is required",
        );
      }

      const { head, releaseOperation } = snapshot;
      if (
        releaseOperation.operationId !== head.operationId ||
        releaseOperation.fencingToken !== snapshot.currentState.releaseFencingToken ||
        releaseOperation.recordBytes === null ||
        releaseOperation.releaseDelegationBytes === null ||
        releaseOperation.localAppendObservedAt === null ||
        !bytesEqual(releaseOperation.recordBytes, head.recordBytes) ||
        !bytesEqual(releaseOperation.releaseDelegationBytes, head.releaseDelegationBytes) ||
        releaseOperation.localAppendObservedAt !== head.appendedAt ||
        !metadataMatchesHead(releaseOperation, head)
      ) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "AVAILABLE Release operation does not exactly match the persisted DO head",
        );
      }

      let pointer: Awaited<
        ReturnType<CloudflareOperatorManifestStore["readCurrentManifestPointer"]>
      >;
      let snapshotObject: Awaited<
        ReturnType<CloudflareOperatorManifestStore["readImmutableManifestSnapshot"]>
      >;
      try {
        [pointer, snapshotObject] = await Promise.all([
          dependencies.manifests.readCurrentManifestPointer(),
          dependencies.manifests.readImmutableManifestSnapshot(head.manifestRef),
        ]);
      } catch {
        throw new CloudflareOperatorProfileError(
          "UNAVAILABLE",
          "R2 Manifest pointer or immutable snapshot read failed",
        );
      }
      if (
        pointer === null ||
        snapshotObject === null ||
        pointer.etag !== head.pointerEtag ||
        snapshotObject.reference !== head.manifestRef ||
        !bytesEqual(pointer.bytes, releaseOperation.manifestBytes) ||
        !bytesEqual(snapshotObject.bytes, releaseOperation.manifestBytes) ||
        !bytesEqual(head.recordBytes, releaseOperation.recordBytes) ||
        !bytesEqual(head.releaseDelegationBytes, releaseOperation.releaseDelegationBytes)
      ) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "R2 pointer, ETag, snapshot, or Release bytes differ from the committed DO record",
        );
      }

      const releaseCommit = await verifyRuntimeConfigReleaseCommitRecord({
        raw: head.recordBytes,
        rootSigner: dependencies.releaseRootSigner,
        environment: "production",
        releaseDelegationRaw: head.releaseDelegationBytes,
        appendedAt: head.appendedAt,
      });
      if (
        releaseCommit.digest !== head.recordSha256 ||
        releaseCommit.payload.release_commit_id !== head.releaseCommitId ||
        releaseCommit.payload.commit_generation !== head.generation ||
        releaseCommit.payload.commit_generation !== head.position ||
        releaseCommit.payload.previous_commit_record_sha256 !==
          head.previousRecordSha256 ||
        releaseCommit.payload.manifest_epoch !== head.manifestEpoch ||
        releaseCommit.payload.manifest_sha256 !== head.manifestSha256 ||
        releaseCommit.payload.manifest_ref !== head.manifestRef ||
        releaseCommit.payload.pointer_etag !== head.pointerEtag ||
        releaseOperation.manifestSha256 !== head.manifestSha256 ||
        releaseOperation.manifestEpoch !== head.manifestEpoch ||
        releaseOperation.manifestRef !== head.manifestRef ||
        releaseOperation.pointerEtag !== head.pointerEtag
      ) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "Signed Release record does not match the DO head and R2 reference",
        );
      }

      const manifest: VerifiedRuntimeConfigManifestEpochPointer =
        await verifyRuntimeConfigManifestEpochPointer({
          raw: releaseOperation.manifestBytes,
          trustedSigner: dependencies.manifestRootSigner,
        });
      if (
        manifest.epoch !== head.manifestEpoch ||
        manifest.manifestSha256 !== head.manifestSha256
      ) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "Signed Manifest bytes do not match the Release record",
        );
      }
      assertManifestActive(manifest, observedAtMs);
      const finalObservedAtMs = runtimeUtcNow();
      if (
        finalObservedAtMs < observedAtMs ||
        finalObservedAtMs < snapshot.lastObservedUtcMs
      ) {
        throw new CloudflareOperatorProfileError(
          "INVALID_TIME",
          "Runtime UTC observation moved backwards during Release verification",
        );
      }
      assertManifestActive(manifest, finalObservedAtMs);

      const expectedState = await createCloudflareOperatorCurrentStateBinding({
        chainId: snapshot.chainId,
        releaseOperationId: releaseOperation.operationId,
        releaseFencingToken: releaseOperation.fencingToken,
        position: head.position,
        generation: head.generation,
        recordSha256: releaseCommit.digest,
        releaseCommitId: releaseCommit.payload.release_commit_id,
        appendedAt: head.appendedAt,
        manifestEpoch: manifest.epoch,
        manifestSha256: manifest.manifestSha256,
        manifestRef: head.manifestRef,
        pointerEtag: head.pointerEtag,
        manifestNotBeforeMs: manifest.notBeforeMs,
        manifestExpiresAtMs: manifest.expiresAtMs,
        localRestoreEpoch: snapshot.localRestoreEpoch,
      });
      if (!sameBinding(snapshot.currentState, expectedState)) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "Installed current-state binding does not match the verified Release and Manifest bytes",
        );
      }

      return Object.freeze({
        profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
        environment: "production",
        chainId: snapshot.chainId,
        observedAtMs: finalObservedAtMs,
        state: expectedState,
        releaseCommit,
        manifest,
        recordBytes: Uint8Array.from(head.recordBytes),
        releaseDelegationBytes: Uint8Array.from(head.releaseDelegationBytes),
        manifestBytes: Uint8Array.from(releaseOperation.manifestBytes),
        pointerBytes: Uint8Array.from(pointer.bytes),
        snapshotBytes: Uint8Array.from(snapshotObject.bytes),
        pointerEtag: pointer.etag,
      });
    },
  });
}

export async function createCloudflareOperatorCurrentStateBinding(input: {
  readonly chainId: string;
  readonly releaseOperationId: string;
  readonly releaseFencingToken: string;
  readonly position: string;
  readonly generation: string;
  readonly recordSha256: string;
  readonly releaseCommitId: string;
  readonly appendedAt: string;
  readonly manifestEpoch: string;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly manifestNotBeforeMs: number;
  readonly manifestExpiresAtMs: number;
  readonly localRestoreEpoch: string;
}): Promise<CloudflareOperatorCurrentStateBinding> {
  const bindingWithoutDigest = {
    profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
    environment: "production" as const,
    chainId: input.chainId,
    releaseOperationId: input.releaseOperationId,
    releaseFencingToken: input.releaseFencingToken,
    position: input.position,
    generation: input.generation,
    recordSha256: input.recordSha256,
    releaseCommitId: input.releaseCommitId,
    appendedAt: input.appendedAt,
    manifestEpoch: input.manifestEpoch,
    manifestSha256: input.manifestSha256,
    manifestRef: input.manifestRef,
    pointerEtag: input.pointerEtag,
    manifestNotBeforeMs: input.manifestNotBeforeMs,
    manifestExpiresAtMs: input.manifestExpiresAtMs,
    localRestoreEpoch: input.localRestoreEpoch,
  };
  return Object.freeze({
    ...bindingWithoutDigest,
    stateSha256: await digest(canonicalJsonBytes(bindingWithoutDigest)),
  });
}

export interface WorkerReadableFreshnessKey {
  readonly keyId: string;
  readonly privateKey: CryptoKey;
  readonly freshnessDelegationBytes: Uint8Array;
}

export interface CloudflareOperatorFreshnessSignerDependencies {
  readonly manifestUrl: string;
  readonly environment: "production";
  readonly chainId: string;
  readonly bootstrapSigner: RuntimeConfigRootSigner;
  readonly coordinator: CloudflareOperatorIssueCoordinator;
  readonly key: WorkerReadableFreshnessKey;
  readonly stateReader: CloudflareOperatorReleaseStateReader;
}

export async function createWorkerReadableCloudflareOperatorFreshnessSigner(
  dependencies: CloudflareOperatorFreshnessSignerDependencies,
): Promise<CloudflareOperatorFreshnessSigner> {
  const audience = await digest(new TextEncoder().encode(dependencies.manifestUrl));
  const initialDelegation = await verifyRuntimeConfigDelegation({
    raw: dependencies.key.freshnessDelegationBytes,
    rootSigner: dependencies.bootstrapSigner,
    expectedPurpose: "freshness-response-v1",
    expectedEnvironment: dependencies.environment,
    expectedAudience: audience,
    signerNowMs: runtimeUtcNow(),
  });
  if (
    initialDelegation.payload.key_id !== dependencies.key.keyId ||
    dependencies.key.privateKey.type !== "private" ||
    dependencies.key.privateKey.algorithm.name !== "Ed25519" ||
    !dependencies.key.privateKey.usages.includes("sign")
  ) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Worker-readable key does not match its Freshness delegation",
    );
  }
  const delegatedPublicKey = await importDelegatedPublicKey(
    initialDelegation.payload.public_key_spki,
  );
  await assertPrivateKeyMatchesPublicKey(
    dependencies.key.privateKey,
    delegatedPublicKey,
  );

  return Object.freeze({
    async issue(request: CloudflareOperatorFreshnessSigningRequest) {
      assertSigningBinding(request, audience, dependencies.chainId);
      const requestBytes = Uint8Array.from(request.requestBytes);
      const challenge = await verifyRuntimeConfigFreshnessRequest(
        requestBytes,
        {
          environment: dependencies.environment,
          audienceManifestUrlSha256: audience,
        },
      );
      if (
        await digest(requestBytes) !== request.issue.requestSha256 ||
        !bytesEqual(canonicalJsonBytes(challenge), canonicalJsonBytes(request.challenge))
      ) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "Signing challenge does not match the persisted exact request bytes",
        );
      }
      const authorization: CloudflareOperatorIssueSigningAuthorization = {
        operation: request.issue,
        fencingToken: request.fencingToken,
        requestBytes,
        currentState: request.currentState,
      };
      const claim = await dependencies.coordinator
        .claimCloudflareOperatorIssueSigning(authorization);
      if (claim.status !== "CLAIMED") {
        throw new CloudflareOperatorProfileError(
          "UNAVAILABLE",
          claim.reason ??
            `Freshness issue cannot begin signing from ${claim.status}`,
        );
      }
      const state = await dependencies.stateReader.readCurrentState({
        issueAuthorization: authorization,
      });
      if (!sameBinding(state.state, request.currentState)) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "Private signer observed a different current Release binding",
        );
      }
      const nowMs = runtimeUtcNow();
      assertManifestActive(state.manifest, nowMs);
      const delegation = await verifyRuntimeConfigDelegation({
        raw: dependencies.key.freshnessDelegationBytes,
        rootSigner: dependencies.bootstrapSigner,
        expectedPurpose: "freshness-response-v1",
        expectedEnvironment: dependencies.environment,
        expectedAudience: audience,
        signerNowMs: nowMs,
      });
      if (delegation.payload.key_id !== dependencies.key.keyId) {
        throw new CloudflareOperatorProfileError(
          "INVALID_EVIDENCE",
          "Freshness delegation key changed after signer initialization",
        );
      }
      const expiresAtMs = Math.min(
        nowMs + runtimeConfigFreshnessWire.maxResponseLifetimeMs,
        delegation.notAfterMs,
        state.manifest.expiresAtMs,
      );
      if (expiresAtMs <= nowMs) {
        throw new CloudflareOperatorProfileError(
          "EXPIRED",
          "Manifest or Freshness delegation expires before a response can be issued",
        );
      }
      const release = state.releaseCommit;
      const payload: FreshnessResponsePayload = {
        schema_version: 1,
        scope: runtimeConfigFreshnessWire.responsePayloadScope,
        freshness_semantics: "LATEST_AT_ISSUANCE",
        environment: "production",
        audience_manifest_url_sha256: audience,
        request_nonce: challenge.request_nonce,
        issued_at: new Date(nowMs).toISOString(),
        expires_at: new Date(expiresAtMs).toISOString(),
        latest_epoch: release.payload.manifest_epoch,
        manifest_schema_version: release.payload.manifest_schema_version,
        manifest_sha256: release.payload.manifest_sha256,
        manifest_ref: release.payload.manifest_ref,
        pointer_generation: release.payload.commit_generation,
        release_commit_id: release.payload.release_commit_id,
        release_commit_record_sha256: release.digest,
        release_commit_record_appended_at: state.state.appendedAt,
        freshness_signer_key_id: delegation.payload.key_id,
        freshness_delegation_id: delegation.payload.delegation_id,
        freshness_delegation_sha256: delegation.digest,
        release_authority_key_id: release.delegation.payload.key_id,
        release_authority_delegation_id:
          release.delegation.payload.delegation_id,
        release_authority_delegation_sha256: release.delegation.digest,
      };
      const responseBytes = await signRuntimeConfigFreshnessResponseEnvelope({
        payload,
        signerKeyId: dependencies.key.keyId,
        privateKey: dependencies.key.privateKey,
        freshnessDelegationBytes: dependencies.key.freshnessDelegationBytes,
        releaseDelegationBytes: state.releaseDelegationBytes,
        releaseRecordBytes: state.recordBytes,
      });
      return { outcome: "COMPLETED" as const, responseBytes };
    },
  });
}

export async function verifyCloudflareOperatorFreshnessResponse(options: {
  readonly raw: Uint8Array;
  readonly bootstrapSigner: RuntimeConfigRootSigner;
  readonly manifestUrl: string;
  readonly requestBytes: Uint8Array;
  readonly nowMs: number;
  readonly expectedState: CloudflareOperatorCurrentStateBinding;
}): Promise<Awaited<ReturnType<typeof verifyRuntimeConfigFreshnessResponse>>> {
  const audience = await digest(new TextEncoder().encode(options.manifestUrl));
  const challenge = await verifyRuntimeConfigFreshnessRequest(
    options.requestBytes,
    {
      environment: "production",
      audienceManifestUrlSha256: audience,
    },
  );
  const response = await verifyRuntimeConfigFreshnessResponse({
    raw: options.raw,
    bootstrapSigner: options.bootstrapSigner,
    manifestUrl: options.manifestUrl,
    request: challenge,
    nowMs: options.nowMs,
  });
  if (
    response.releaseCommit.digest !== options.expectedState.recordSha256 ||
    response.releaseCommit.payload.commit_generation !==
      options.expectedState.generation ||
    response.releaseCommit.payload.manifest_epoch !==
      options.expectedState.manifestEpoch ||
    response.releaseCommit.payload.manifest_sha256 !==
      options.expectedState.manifestSha256 ||
    response.releaseCommit.payload.manifest_ref !==
      options.expectedState.manifestRef ||
    response.releaseCommit.payload.pointer_etag !==
      options.expectedState.pointerEtag ||
    response.payload.release_commit_record_appended_at !==
      options.expectedState.appendedAt
  ) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Signed Freshness response is not bound to the installed Release state",
    );
  }
  return response;
}

export async function issueCloudflareOperatorFreshness(
  input: CloudflareOperatorIssueInput,
  dependencies: CloudflareOperatorIssueDependencies,
): Promise<CloudflareOperatorIssueResult> {
  assertIssueOperationId(input.operationId);
  if (
    !(input.requestBytes instanceof Uint8Array) ||
    input.requestBytes.byteLength === 0 ||
    input.requestBytes.byteLength > 1_024
  ) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Freshness request bytes are empty or exceed the wire limit",
    );
  }
  const audience = await digest(new TextEncoder().encode(dependencies.manifestUrl));
  const challenge = await verifyRuntimeConfigFreshnessRequest(
    input.requestBytes,
    {
      environment: "production",
      audienceManifestUrlSha256: audience,
    },
  );
  const requestSha256 = await digest(input.requestBytes);
  const admission = await dependencies.coordinator.beginCloudflareOperatorIssue({
    operationId: input.operationId,
    requestBytes: Uint8Array.from(input.requestBytes),
    requestSha256,
    challengeNonce: challenge.request_nonce,
    audienceManifestUrlSha256: audience,
    chainId: dependencies.chainId,
  });
  if (admission.status !== "ACQUIRED") {
    return issueAdmissionResult(
      input.operationId,
      admission,
      "ALREADY_FINALIZED",
    );
  }
  const issue = requireOperation(admission);
  const fencingToken = requireFence(admission);
  const stateAtAdmission = requireCurrentState(admission);

  let signerResult: Awaited<
    ReturnType<CloudflareOperatorFreshnessSigner["issue"]>
  >;
  try {
    signerResult = await dependencies.signer.issue({
      operation: "ISSUE_LATEST_AT_ISSUANCE",
      profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
      issue,
      fencingToken,
      requestBytes: Uint8Array.from(input.requestBytes),
      challenge,
      currentState: stateAtAdmission,
    });
  } catch {
    return issueAdmissionResult(
      input.operationId,
      await dependencies.coordinator.markCloudflareOperatorIssueUnknown({
        operation: issue,
        fencingToken,
      }),
    );
  }
  if (signerResult.outcome !== "COMPLETED") {
    return issueAdmissionResult(
      input.operationId,
      await dependencies.coordinator.markCloudflareOperatorIssueUnknown({
        operation: issue,
        fencingToken,
      }),
    );
  }
  if (!(signerResult.responseBytes instanceof Uint8Array)) {
    return issueAdmissionResult(
      input.operationId,
      await dependencies.coordinator.markCloudflareOperatorIssueUnknown({
        operation: issue,
        fencingToken,
      }),
    );
  }

  try {
    await verifyCloudflareOperatorFreshnessResponse({
      raw: signerResult.responseBytes,
      bootstrapSigner: dependencies.bootstrapSigner,
      manifestUrl: dependencies.manifestUrl,
      requestBytes: input.requestBytes,
      nowMs: runtimeUtcNow(),
      expectedState: stateAtAdmission,
    });
  } catch {
    return issueAdmissionResult(
      input.operationId,
      await dependencies.coordinator.rejectCloudflareOperatorIssue({
        operation: issue,
        fencingToken,
        reason: "Signer returned a response that failed independent verification",
      }),
    );
  }

  let stateAfterSigning: VerifiedCloudflareOperatorReleaseState;
  try {
    stateAfterSigning = await dependencies.currentState.readCurrentState({
      issueAuthorization: {
        operation: issue,
        fencingToken,
        requestBytes: Uint8Array.from(input.requestBytes),
        currentState: stateAtAdmission,
      },
    });
  } catch {
    return issueAdmissionResult(
      input.operationId,
      await dependencies.coordinator.markCloudflareOperatorIssueUnknown({
        operation: issue,
        fencingToken,
      }),
    );
  }
  if (!sameBinding(stateAtAdmission, stateAfterSigning.state)) {
    return issueAdmissionResult(
      input.operationId,
      await dependencies.coordinator.rejectCloudflareOperatorIssue({
        operation: issue,
        fencingToken,
        reason: "Release binding changed while the signer was active",
      }),
    );
  }

  let finalized: CloudflareOperatorIssueAdmission;
  try {
    finalized = await dependencies.coordinator.finalizeCloudflareOperatorIssue({
      operation: issue,
      fencingToken,
      currentStateSha256: stateAfterSigning.state.stateSha256,
      responseBytes: Uint8Array.from(signerResult.responseBytes),
    });
  } catch {
    await dependencies.coordinator.markCloudflareOperatorIssueUnknown({
      operation: issue,
      fencingToken,
    });
    finalized = await dependencies.coordinator.getCloudflareOperatorIssue({
      operationId: input.operationId,
      requestBytes: input.requestBytes,
      chainId: dependencies.chainId,
    });
  }
  return issueAdmissionResult(input.operationId, finalized);
}

function issueAdmissionResult(
  operationId: string,
  admission: CloudflareOperatorIssueAdmission,
  finalizedStatus: "ISSUED" | "ALREADY_FINALIZED" = "ISSUED",
): CloudflareOperatorIssueResult {
  if (
    admission.status === "FINALIZED" &&
    admission.responseBytes !== undefined &&
    admission.responseSha256 !== undefined
  ) {
    return {
      status: finalizedStatus,
      operationId,
      responseBytes: Uint8Array.from(admission.responseBytes),
      responseLength: admission.responseBytes.byteLength,
      responseSha256: admission.responseSha256,
    };
  }
  if (admission.status === "EXPIRED") {
    return {
      status: "REJECTED",
      operationId,
      reason: admission.reason ?? "Finalized response expired",
    };
  }
  if (admission.status === "RESULT_UNKNOWN") {
    return { status: "RESULT_UNKNOWN", operationId };
  }
  if (admission.status === "IN_PROGRESS") {
    return { status: "IN_PROGRESS", operationId };
  }
  if (admission.status === "REJECTED") {
    return {
      status: "REJECTED",
      operationId,
      reason: admission.reason ?? "Freshness issue was rejected",
    };
  }
  if (admission.status === "CONFLICT") {
    return { status: "CONFLICT", operationId };
  }
  return {
    status: "REJECTED",
    operationId,
    reason: admission.reason ?? "Freshness issue admission failed",
  };
}

function requireOperation(
  admission: CloudflareOperatorIssueAdmission,
): CloudflareOperatorIssueOperationBinding {
  if (admission.operation === undefined) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Acquired issue operation is missing its persisted binding",
    );
  }
  return admission.operation;
}

function requireFence(admission: CloudflareOperatorIssueAdmission): string {
  if (admission.fencingToken === undefined) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Acquired issue operation is missing its fencing token",
    );
  }
  return admission.fencingToken;
}

function requireCurrentState(
  admission: CloudflareOperatorIssueAdmission,
): CloudflareOperatorCurrentStateBinding {
  if (admission.currentState === undefined) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Acquired issue operation is missing its installed Release binding",
    );
  }
  return admission.currentState;
}

function assertIssueOperationId(operationId: string): void {
  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(operationId)
  ) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Freshness issue operation ID must be a UUIDv4",
    );
  }
}

function assertSigningBinding(
  request: CloudflareOperatorFreshnessSigningRequest,
  audience: string,
  chainId: string,
): void {
  if (
    request.operation !== "ISSUE_LATEST_AT_ISSUANCE" ||
    request.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
    request.issue.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
    request.issue.environment !== "production" ||
    request.issue.chainId !== chainId ||
    request.issue.audienceManifestUrlSha256 !== audience ||
    request.challenge.environment !== "production" ||
    request.challenge.audience_manifest_url_sha256 !== audience ||
    request.challenge.request_nonce !== request.issue.requestNonce ||
    request.currentState.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
    request.currentState.environment !== request.issue.environment ||
    request.currentState.chainId !== chainId
  ) {
    throw new CloudflareOperatorProfileError(
      "PROFILE_MISMATCH",
      "Freshness signing request does not match the fixed profile, environment, chain, or audience",
    );
  }
}

function metadataMatchesHead(
  operation: NonNullable<CloudflareOperatorReleaseLedgerSnapshot["releaseOperation"]>,
  head: NonNullable<CloudflareOperatorReleaseLedgerSnapshot["head"]>,
): boolean {
  return operation.manifestBytes.byteLength > 0 &&
    operation.manifestSha256 === head.manifestSha256 &&
    operation.manifestEpoch === head.manifestEpoch &&
    operation.manifestRef === head.manifestRef &&
    operation.pointerEtag === head.pointerEtag;
}

function assertManifestActive(
  manifest: VerifiedRuntimeConfigManifestEpochPointer,
  nowMs: number,
): void {
  if (!Number.isSafeInteger(nowMs)) {
    throw new CloudflareOperatorProfileError(
      "INVALID_TIME",
      "Runtime UTC is not a safe integer",
    );
  }
  if (nowMs < manifest.notBeforeMs || nowMs >= manifest.expiresAtMs) {
    throw new CloudflareOperatorProfileError(
      "EXPIRED",
      "Runtime Config Manifest is outside its signed validity interval",
    );
  }
}

function sameBinding(
  left: CloudflareOperatorCurrentStateBinding,
  right: CloudflareOperatorCurrentStateBinding,
): boolean {
  return bytesEqual(canonicalJsonBytes(left), canonicalJsonBytes(right));
}

async function assertPrivateKeyMatchesPublicKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<void> {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    toArrayBuffer(challenge),
  );
  const matches = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    signature,
    toArrayBuffer(challenge),
  );
  if (!matches) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Worker-readable Freshness private key does not match its delegated public key",
    );
  }
}

async function importDelegatedPublicKey(publicKeySpki: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(decodeBase64Url(publicKeySpki)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch (error) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      `Delegated Freshness public key cannot be imported: ${errorMessage(error)}`,
    );
  }
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Delegated public key is not canonical base64url",
    );
  }
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  const result = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(result) !== value) {
    throw new CloudflareOperatorProfileError(
      "INVALID_EVIDENCE",
      "Delegated public key is not canonical base64url",
    );
  }
  return result;
}

async function digest(bytes: Uint8Array): Promise<string> {
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes))),
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new Uint8Array(bytes.byteLength);
  result.set(bytes);
  return result.buffer;
}

function runtimeUtcNow(): number {
  const nowMs = Date.now();
  if (!Number.isSafeInteger(nowMs)) {
    throw new CloudflareOperatorProfileError(
      "INVALID_TIME",
      "Runtime host UTC is not a safe integer",
    );
  }
  return nowMs;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
