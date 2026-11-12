import {
  canonicalJsonBytes,
  encodeBase64Url,
  verifyRuntimeConfigManifestEpochPointer,
  verifyRuntimeConfigReleaseCommitRecord,
} from "./domain.ts";
import type { RuntimeConfigRootSigner } from "./domain.ts";
import type {
  FreshnessCurrentStateReadInput,
  FreshnessCurrentStateReader,
  FreshnessIssueCoordinatorSnapshotReader,
} from "./freshness-issue.ts";
import type {
  FreshnessAntiRollbackWitnessBinding,
  FreshnessCurrentStateEvidence,
  FreshnessIssueCoordinatorSnapshot,
  FreshnessIssueCurrentStateBinding,
  FreshnessIssueLeaseBinding,
  FreshnessIssueOperationBinding,
  FreshnessCurrentStateProofContext,
  FreshnessCurrentStateInstallProofContext,
  FreshnessCurrentStateReadProofContext,
  FreshnessReleaseStateEvidence,
  VerifiedCurrentFreshnessState,
  VerifiedFreshnessReleaseState,
} from "./signers.ts";
import {
  createFreshnessIssueCurrentStateBinding,
  createFreshnessIssueCurrentStateBindingFromReleaseState,
} from "./freshness-issue.ts";

const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const READ_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CANONICAL_POSITION_PATTERN = /^(0|[1-9][0-9]*)$/u;
const CURRENT_STATE_READ_CONTEXT_SCOPE =
  "fusou-runtime-config-current-state-read-context-v1";
const CURRENT_STATE_INSTALL_CONTEXT_SCOPE =
  "fusou-runtime-config-current-state-install-context-v1";
const INSTALL_OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const FENCING_TOKEN_PATTERN = /^(0|[1-9][0-9]*)$/u;

export interface FreshnessJournalCurrentHeadEvidence {
  readonly recordBytes: Uint8Array;
  readonly releaseDelegationBytes: Uint8Array;
  readonly appendedAt: string;
  readonly appendReceiptBytes: Uint8Array;
  readonly currentHeadProofBytes: Uint8Array;
}

export interface VerifiedFreshnessJournalCurrentHead {
  readonly providerId: string;
  readonly chainId: string;
  readonly environment: "production";
  readonly readContextSha256: string;
  readonly headPosition: string;
  readonly previousRecordSha256: string | null;
  readonly observedAtMs: number;
  readonly clockId: string;
  readonly clockEpoch: string;
  readonly clockUncertaintyMs: number;
  readonly appendTimeSourceId: string;
  readonly appendTimeUncertaintyMs: number;
  readonly generation: string;
  readonly recordSha256: string;
  readonly releaseDelegationSha256: string;
  readonly manifestEpoch: string;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly appendedAt: string;
  readonly appendReceiptSha256: string;
  readonly currentHeadProofSha256: string;
}

export interface FreshnessJournalCurrentHeadVerifier {
  verifyCurrentHead(
    evidence: FreshnessJournalCurrentHeadEvidence,
    context: FreshnessCurrentStateReadProofContext,
  ): Promise<VerifiedFreshnessJournalCurrentHead>;
}

export interface FreshnessAntiRollbackWitnessEvidence
  extends FreshnessAntiRollbackWitnessBinding {
  readonly signedBytes: Uint8Array;
}

export interface VerifiedFreshnessAntiRollbackWitness
  extends FreshnessAntiRollbackWitnessBinding {
  readonly chainId: string;
  readonly environment: "production";
  readonly checkpointSequence: string;
  readonly readContextSha256: string;
  readonly observedAtMs: number;
  readonly clockId: string;
  readonly clockEpoch: string;
  readonly clockUncertaintyMs: number;
  readonly proofSha256: string;
}

export interface FreshnessAntiRollbackWitnessVerifier {
  verifyExternalWitness(
    signedBytes: Uint8Array,
    context: FreshnessCurrentStateReadProofContext,
  ): Promise<VerifiedFreshnessAntiRollbackWitness>;
}

export interface FreshnessCurrentManifestPointer {
  readonly etag: string;
  readonly bytes: Uint8Array;
}

export interface FreshnessImmutableManifestSnapshot {
  readonly reference: string;
  readonly bytes: Uint8Array;
}

export interface FreshnessCurrentManifestStore {
  readCurrentManifestPointer(): Promise<FreshnessCurrentManifestPointer | null>;
  readImmutableManifestSnapshot(
    reference: string,
  ): Promise<FreshnessImmutableManifestSnapshot | null>;
}

export interface FreshnessCurrentStateVerifierDependencies {
  readonly journal: {
    readonly expectedProviderId: string;
    readonly expectedChainId: string;
    readonly expectedAppendTimeSourceId: string;
    readonly verifier: FreshnessJournalCurrentHeadVerifier;
  };
  readonly antiRollbackWitness: {
    readonly expectedSourceId: string;
    readonly verifier: FreshnessAntiRollbackWitnessVerifier;
  };
  readonly releaseRootSigner: RuntimeConfigRootSigner;
  readonly manifestRootSigner: RuntimeConfigRootSigner;
  readonly manifestUrl: string;
}

export interface FreshnessReleaseStateReaderDependencies
  extends FreshnessCurrentStateVerifierDependencies
{
  readonly journal: FreshnessCurrentStateVerifierDependencies["journal"] & {
    readCurrentHead(
      context: FreshnessCurrentStateReadProofContext,
    ): Promise<FreshnessJournalCurrentHeadEvidence>;
  };
  readonly manifests: FreshnessCurrentManifestStore;
  readonly antiRollbackWitness:
    FreshnessCurrentStateVerifierDependencies["antiRollbackWitness"] & {
      readCurrentWitness(
        context: FreshnessCurrentStateReadProofContext,
      ): Promise<FreshnessAntiRollbackWitnessEvidence>;
    };
}

export interface FreshnessCurrentStateReaderDependencies
  extends FreshnessReleaseStateReaderDependencies
{
  readonly coordinator: FreshnessIssueCoordinatorSnapshotReader;
}

export interface FreshnessReleaseStateReader {
  readReleaseState(
    context: FreshnessCurrentStateReadProofContext,
  ): Promise<FreshnessReleaseStateEvidence>;
  verifyReleaseState(
    evidence: FreshnessReleaseStateEvidence,
    context: FreshnessCurrentStateReadProofContext,
  ): Promise<VerifiedFreshnessReleaseState>;
}

export type FreshnessCurrentStateInstallProofContextInput = Omit<
  FreshnessCurrentStateInstallProofContext,
  "readNonce" | "readContextSha256"
>;

export async function createFreshnessCurrentStateInstallProofContext(
  input: FreshnessCurrentStateInstallProofContextInput,
): Promise<FreshnessCurrentStateInstallProofContext> {
  assertInstallContextInput(input);
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const context: Omit<
    FreshnessCurrentStateInstallProofContext,
    "readContextSha256"
  > = {
    ...input,
    clock: { ...input.clock },
    readNonce: encodeBase64Url(nonceBytes),
  };
  return {
    ...context,
    readContextSha256: await proofContextSha256(context),
  };
}

export class FreshnessCurrentStateReaderError extends Error {
  readonly code:
    | "MISSING_ADAPTER"
    | "UNAVAILABLE"
    | "INVALID_EVIDENCE";

  constructor(
    code: FreshnessCurrentStateReaderError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FreshnessCurrentStateReaderError";
    this.code = code;
  }
}

export function createFreshnessCurrentStateReader(
  dependencies: FreshnessCurrentStateReaderDependencies,
): FreshnessCurrentStateReader {
  assertDependencies(dependencies);
  const releaseReader = createFreshnessReleaseStateReader(dependencies);
  return Object.freeze({
    async readCurrentState(input: FreshnessCurrentStateReadInput) {
      const proofContext = await createProofContext(
        input,
        dependencies.journal.expectedChainId,
      );
      const releaseEvidence = await releaseReader.readReleaseState(proofContext);
      const snapshot = await dependencies.coordinator.readCurrentStateSnapshot({
        operation: input.operation,
        lease: input.lease,
      });
      return {
        ...releaseEvidence,
        proofContext: copyProofContext(proofContext),
        pointer: {
          ...releaseEvidence.pointer,
          generation: snapshot.currentState.pointerGeneration,
        },
        coordinatorSnapshot: copyCoordinatorSnapshot(snapshot),
        coordinatorHead: {
          environment: snapshot.environment,
          generation: snapshot.currentState.pointerGeneration,
          recordSha256: snapshot.currentState.journalHeadSha256,
          manifestEpoch: snapshot.currentState.manifestEpoch,
          writerPending: snapshot.writerPending,
          restoreEpoch: snapshot.restoreEpoch,
        },
      };
    },

    async verifyCurrentState(
      evidence: FreshnessCurrentStateEvidence,
      input: FreshnessCurrentStateReadInput,
    ): Promise<VerifiedCurrentFreshnessState> {
      const proofContext = copyProofContext(evidence.proofContext);
      await assertProofContextMatchesInput(
        proofContext,
        input,
        dependencies.journal.expectedChainId,
      );
      const releaseState = await releaseReader.verifyReleaseState(
        evidence,
        proofContext,
      );
      assertCoordinatorBindings(
        evidence,
        input,
        releaseState,
      );

      const verified: VerifiedCurrentFreshnessState = Object.freeze({
        source: "verified-journal-do-r2-snapshot",
        freshnessSemantics: "LATEST_AT_ISSUANCE",
        environment: releaseState.environment,
        journalHead: {
          generation: releaseState.journalHead.generation,
          record_sha256: releaseState.journalHead.record_sha256,
          manifest_epoch: releaseState.journalHead.manifest_epoch,
        },
        releaseCommitRecord: releaseState.releaseCommitRecord,
        verifiedReleaseCommitRecord: releaseState.verifiedReleaseCommitRecord,
        releaseCommitRecordSha256: releaseState.releaseCommitRecordSha256,
        journalAppendedAt: releaseState.journalAppendedAt,
        manifestBytes: copyBytes(releaseState.manifestBytes),
        manifestSha256: releaseState.manifestSha256,
        manifestRef: releaseState.manifestRef,
        pointerEtag: releaseState.pointerEtag,
        pointerGeneration: releaseState.pointerGeneration,
        manifestEpoch: releaseState.manifestEpoch,
        antiRollbackWitness: releaseState.antiRollbackWitness,
      });
      const binding = await createFreshnessIssueCurrentStateBinding(verified);
      if (
        !sameCurrentStateBinding(binding, input.lease.currentState) ||
        !sameCurrentStateBinding(
          binding,
          evidence.coordinatorSnapshot.currentState,
        )
      ) {
        invalidEvidence("Verified Release does not match the issued lease snapshot");
      }
      return verified;
    },
  });
}

export function createFreshnessReleaseStateReader(
  dependencies: FreshnessReleaseStateReaderDependencies,
): FreshnessReleaseStateReader {
  assertReleaseStateReaderDependencies(dependencies);
  return Object.freeze({
    async readReleaseState(context: FreshnessCurrentStateReadProofContext) {
      const proofContext = copyReadProofContext(context);
      await assertReadProofContext(
        proofContext,
        dependencies.journal.expectedChainId,
      );
      const journalHead = copyJournalEvidence(
        await dependencies.journal.readCurrentHead(
          copyReadProofContext(proofContext),
        ),
      );
      const { releaseCommit } = await verifyJournalAndRelease(
        journalHead,
        proofContext,
        dependencies,
      );
      const [
        pointer,
        immutableSnapshot,
        witness,
      ] = await Promise.all([
        dependencies.manifests.readCurrentManifestPointer(),
        dependencies.manifests.readImmutableManifestSnapshot(
          releaseCommit.payload.manifest_ref,
        ),
        dependencies.antiRollbackWitness.readCurrentWitness(
          copyReadProofContext(proofContext),
        ),
      ]);
      if (pointer === null) {
        unavailable("Runtime Config R2 mutable Manifest pointer is unavailable");
      }
      if (immutableSnapshot === null) {
        unavailable("Immutable Runtime Config Manifest snapshot is unavailable");
      }
      const copiedPointer = {
        etag: pointer.etag,
        bytes: copyBytes(pointer.bytes),
      };
      return Object.freeze({
        proofContext,
        journalHead,
        pointer: Object.freeze({
          environment: "production" as const,
          etag: copiedPointer.etag,
          bytes: copiedPointer.bytes,
        }),
        immutableSnapshot: Object.freeze({
          reference: immutableSnapshot.reference,
          bytes: copyBytes(immutableSnapshot.bytes),
        }),
        manifestBytes: copyBytes(copiedPointer.bytes),
        antiRollbackWitness: copyWitnessEvidence(witness),
      });
    },

    async verifyReleaseState(
      evidence: FreshnessReleaseStateEvidence,
      context: FreshnessCurrentStateReadProofContext,
    ): Promise<VerifiedFreshnessReleaseState> {
      const proofContext = copyReadProofContext(evidence.proofContext);
      await assertReadProofContext(
        proofContext,
        dependencies.journal.expectedChainId,
      );
      assertMatchingReadProofContexts(
        proofContext,
        copyReadProofContext(context),
      );
      const journalHead = copyJournalEvidence(evidence.journalHead);
      const { releaseCommit, journalClaims } =
        await verifyJournalAndRelease(
          journalHead,
          proofContext,
          dependencies,
        );
      const witnessClaims = await verifyWitness(
        evidence.antiRollbackWitness,
        proofContext,
        dependencies,
      );
      const manifest = await verifyRuntimeConfigManifestEpochPointer({
        raw: evidence.manifestBytes,
        trustedSigner: dependencies.manifestRootSigner,
        manifestUrl: dependencies.manifestUrl,
        nowMs: journalClaims.observedAtMs,
      });
      assertReleaseStateBindings(
        evidence,
        releaseCommit,
        journalClaims,
        witnessClaims,
        manifest,
      );

      const verified: VerifiedFreshnessReleaseState = Object.freeze({
        source: "verified-release-journal-r2-witness",
        environment: "production",
        chainId: proofContext.chainId,
        journalHead: Object.freeze({
          position: journalClaims.headPosition,
          generation: releaseCommit.payload.commit_generation,
          record_sha256: releaseCommit.digest,
          manifest_epoch: releaseCommit.payload.manifest_epoch,
        }),
        releaseCommitRecord: releaseCommit.envelope,
        verifiedReleaseCommitRecord: releaseCommit,
        recordBytes: copyBytes(evidence.journalHead.recordBytes),
        releaseCommitRecordSha256: releaseCommit.digest,
        releaseDelegationBytes: copyBytes(
          evidence.journalHead.releaseDelegationBytes,
        ),
        journalAppendedAt: journalClaims.appendedAt,
        manifestBytes: copyBytes(evidence.manifestBytes),
        manifestSha256: manifest.manifestSha256,
        manifestRef: releaseCommit.payload.manifest_ref,
        pointerEtag: evidence.pointer.etag,
        pointerGeneration: releaseCommit.payload.commit_generation,
        manifestEpoch: manifest.epoch,
        antiRollbackWitness: Object.freeze({
          sourceId: witnessClaims.sourceId,
          restoreEpoch: witnessClaims.restoreEpoch,
          generation: witnessClaims.generation,
          recordSha256: witnessClaims.recordSha256,
        }),
        proofContextSha256: proofContext.readContextSha256,
      });
      await createFreshnessIssueCurrentStateBindingFromReleaseState(verified);
      assertInstallProofContextTarget(proofContext, verified);
      return verified;
    },
  });
}

async function verifyJournalAndRelease(
  evidence: FreshnessJournalCurrentHeadEvidence,
  context: FreshnessCurrentStateReadProofContext,
  dependencies: FreshnessCurrentStateVerifierDependencies,
) {
  assertNonEmptyBytes(evidence.recordBytes, "Journal Release Commit Record");
  assertNonEmptyBytes(evidence.releaseDelegationBytes, "Release delegation");
  assertNonEmptyBytes(evidence.appendReceiptBytes, "Journal append receipt");
  assertNonEmptyBytes(evidence.currentHeadProofBytes, "Journal current-head proof");

  const claims = await dependencies.journal.verifier.verifyCurrentHead(
    copyJournalEvidence(evidence),
    copyReadProofContext(context),
  );
  const readContextSha256 = await proofContextSha256(context);
  if (
    readContextSha256 !== context.readContextSha256 ||
    claims.readContextSha256 !== context.readContextSha256
  ) {
    invalidEvidence("Current-state proof context digest is invalid");
  }
  const [recordSha256, releaseDelegationSha256, appendReceiptSha256,
    currentHeadProofSha256] = await Promise.all([
    sha256Base64Url(evidence.recordBytes),
    sha256Base64Url(evidence.releaseDelegationBytes),
    sha256Base64Url(evidence.appendReceiptBytes),
    sha256Base64Url(evidence.currentHeadProofBytes),
  ]);
  assertDigest(claims.recordSha256, "Journal Record digest");
  assertDigest(claims.releaseDelegationSha256, "Journal Release delegation digest");
  assertDigest(claims.appendReceiptSha256, "Journal append receipt digest");
  assertDigest(claims.currentHeadProofSha256, "Journal current-head proof digest");
  assertDigest(claims.readContextSha256, "Journal read-context digest");
  assertPosition(claims.headPosition, "Journal head position");
  if (claims.previousRecordSha256 !== null) {
    assertDigest(
      claims.previousRecordSha256,
      "Journal previous Record digest",
    );
  }
  if (
    claims.providerId !== dependencies.journal.expectedProviderId ||
    claims.chainId !== dependencies.journal.expectedChainId ||
    claims.environment !== context.environment ||
    claims.readContextSha256 !== readContextSha256 ||
    claims.recordSha256 !== recordSha256 ||
    claims.releaseDelegationSha256 !== releaseDelegationSha256 ||
    claims.appendReceiptSha256 !== appendReceiptSha256 ||
    claims.currentHeadProofSha256 !== currentHeadProofSha256 ||
    claims.appendedAt !== evidence.appendedAt
  ) {
    invalidEvidence("Journal verifier claims do not bind the exact raw evidence");
  }
  assertAuthenticatedReadTime(
    claims.observedAtMs,
    claims.clockId,
    claims.clockEpoch,
    claims.clockUncertaintyMs,
    context,
    "Journal current-head observation",
  );
  if (
    claims.appendTimeSourceId !==
      dependencies.journal.expectedAppendTimeSourceId ||
    !Number.isSafeInteger(claims.appendTimeUncertaintyMs) ||
    claims.appendTimeUncertaintyMs < 0
  ) {
    invalidEvidence("Journal append-time source or uncertainty is invalid");
  }
  const releaseCommit = await verifyRuntimeConfigReleaseCommitRecord({
    raw: evidence.recordBytes,
    rootSigner: dependencies.releaseRootSigner,
    environment: "production",
    releaseDelegationRaw: evidence.releaseDelegationBytes,
    appendedAt: claims.appendedAt,
  });
  if (
    claims.generation !== releaseCommit.payload.commit_generation ||
    claims.previousRecordSha256 !==
      releaseCommit.payload.previous_commit_record_sha256 ||
    claims.recordSha256 !== releaseCommit.digest ||
    claims.manifestEpoch !== releaseCommit.payload.manifest_epoch ||
    claims.manifestSha256 !== releaseCommit.payload.manifest_sha256 ||
    claims.manifestRef !== releaseCommit.payload.manifest_ref ||
    claims.pointerEtag !== releaseCommit.payload.pointer_etag
  ) {
    invalidEvidence("Authenticated Journal head differs from its signed Release record");
  }
  const authorizedAtMs = Date.parse(releaseCommit.payload.authorized_at);
  if (
    releaseCommit.appendedAtMs - claims.appendTimeUncertaintyMs <
      Math.max(releaseCommit.delegation.notBeforeMs, authorizedAtMs) ||
    releaseCommit.appendedAtMs + claims.appendTimeUncertaintyMs >=
      releaseCommit.delegation.notAfterMs
  ) {
    invalidEvidence(
      "Authenticated Journal append-time uncertainty crosses the Release delegation boundary",
    );
  }
  return { releaseCommit, journalClaims: claims };
}

async function verifyWitness(
  evidence: FreshnessAntiRollbackWitnessEvidence,
  context: FreshnessCurrentStateReadProofContext,
  dependencies: FreshnessCurrentStateVerifierDependencies,
): Promise<VerifiedFreshnessAntiRollbackWitness> {
  assertNonEmptyBytes(evidence.signedBytes, "Independent rollback witness");
  const verified = await dependencies.antiRollbackWitness.verifier
    .verifyExternalWitness(
      copyBytes(evidence.signedBytes),
      copyReadProofContext(context),
    );
  const proofSha256 = await sha256Base64Url(evidence.signedBytes);
  const readContextSha256 = await proofContextSha256(context);
  assertDigest(verified.readContextSha256, "Witness read-context digest");
  assertPosition(verified.checkpointSequence, "Witness checkpoint sequence");
  if (
    readContextSha256 !== context.readContextSha256 ||
    verified.sourceId !== dependencies.antiRollbackWitness.expectedSourceId ||
    verified.chainId !== context.chainId ||
    verified.environment !== context.environment ||
    verified.readContextSha256 !== readContextSha256 ||
    verified.proofSha256 !== proofSha256 ||
    verified.sourceId !== evidence.sourceId ||
    verified.restoreEpoch !== evidence.restoreEpoch ||
    verified.generation !== evidence.generation ||
    verified.recordSha256 !== evidence.recordSha256
  ) {
    invalidEvidence("External rollback witness does not bind its exact signed bytes");
  }
  assertAuthenticatedReadTime(
    verified.observedAtMs,
    verified.clockId,
    verified.clockEpoch,
    verified.clockUncertaintyMs,
    context,
    "External rollback witness observation",
  );
  return verified;
}

function assertReleaseStateBindings(
  evidence: FreshnessReleaseStateEvidence,
  releaseCommit: Awaited<ReturnType<typeof verifyRuntimeConfigReleaseCommitRecord>>,
  journalClaims: VerifiedFreshnessJournalCurrentHead,
  verifiedWitness: VerifiedFreshnessAntiRollbackWitness,
  manifest: Awaited<ReturnType<typeof verifyRuntimeConfigManifestEpochPointer>>,
): void {
  const payload = releaseCommit.payload;
  const witness = evidence.antiRollbackWitness;
  if (
    evidence.journalHead.appendedAt !== journalClaims.appendedAt ||
    evidence.pointer.environment !== "production" ||
    evidence.pointer.etag !== payload.pointer_etag ||
    evidence.immutableSnapshot.reference !== payload.manifest_ref ||
    payload.manifest_sha256 !== manifest.manifestSha256 ||
    payload.manifest_epoch !== manifest.epoch ||
    journalClaims.manifestEpoch !== manifest.epoch ||
    journalClaims.manifestSha256 !== manifest.manifestSha256 ||
    verifiedWitness.generation !== payload.commit_generation ||
    verifiedWitness.recordSha256 !== releaseCommit.digest ||
    witness.sourceId !== verifiedWitness.sourceId ||
    witness.restoreEpoch !== verifiedWitness.restoreEpoch ||
    witness.generation !== verifiedWitness.generation ||
    witness.recordSha256 !== verifiedWitness.recordSha256 ||
    !bytesEqual(
      evidence.journalHead.recordBytes,
      canonicalJsonBytes(releaseCommit.envelope),
    ) ||
    !bytesEqual(
      evidence.journalHead.releaseDelegationBytes,
      releaseCommit.delegation.raw,
    ) ||
    !bytesEqual(evidence.pointer.bytes, evidence.immutableSnapshot.bytes) ||
    !bytesEqual(evidence.pointer.bytes, evidence.manifestBytes)
  ) {
    invalidEvidence("Journal, R2, Manifest, and witness bindings differ");
  }
}

function assertCoordinatorBindings(
  evidence: FreshnessCurrentStateEvidence,
  input: FreshnessCurrentStateReadInput,
  verifiedRelease: VerifiedFreshnessReleaseState,
): void {
  const snapshot = evidence.coordinatorSnapshot;
  const state = snapshot.currentState;
  const releaseCommit = verifiedRelease.verifiedReleaseCommitRecord;
  const witness = verifiedRelease.antiRollbackWitness;
  if (
    snapshot.environment !== "production" ||
    snapshot.writerPending ||
    snapshot.operationStatus !== "IN_PROGRESS" ||
    snapshot.blocker !== "RETAINED" ||
    !sameOperation(snapshot.operation, input.operation) ||
    !sameLease(snapshot.lease, input.lease) ||
    !sameCurrentStateBinding(snapshot.lease.currentState, state) ||
    state.environment !== "production" ||
    state.generation !== verifiedRelease.journalHead.generation ||
    state.journalHeadSha256 !== releaseCommit.digest ||
    state.releaseCommitRecordSha256 !== releaseCommit.digest ||
    state.releaseCommitId !== releaseCommit.payload.release_commit_id ||
    state.journalAppendedAt !== verifiedRelease.journalAppendedAt ||
    state.manifestEpoch !== releaseCommit.payload.manifest_epoch ||
    state.manifestSha256 !== releaseCommit.payload.manifest_sha256 ||
    state.manifestRef !== releaseCommit.payload.manifest_ref ||
    state.pointerEtag !== releaseCommit.payload.pointer_etag ||
    state.pointerGeneration !== releaseCommit.payload.commit_generation ||
    snapshot.restoreEpoch !== witness.restoreEpoch ||
    snapshot.restoreEpoch !== state.antiRollbackWitness.restoreEpoch ||
    evidence.pointer.generation !== releaseCommit.payload.commit_generation ||
    evidence.coordinatorHead.environment !== "production" ||
    evidence.coordinatorHead.generation !== releaseCommit.payload.commit_generation ||
    evidence.coordinatorHead.recordSha256 !== releaseCommit.digest ||
    evidence.coordinatorHead.manifestEpoch !== releaseCommit.payload.manifest_epoch ||
    evidence.coordinatorHead.writerPending ||
    evidence.coordinatorHead.restoreEpoch !== witness.restoreEpoch ||
    !sameWitness(snapshot.witness, witness) ||
    !sameWitness(state.antiRollbackWitness, witness)
  ) {
    invalidEvidence("SQLite Coordinator snapshot is stale or mismatched");
  }
}

function copyJournalEvidence(
  evidence: FreshnessJournalCurrentHeadEvidence,
): FreshnessJournalCurrentHeadEvidence {
  return {
    recordBytes: copyBytes(evidence.recordBytes),
    releaseDelegationBytes: copyBytes(evidence.releaseDelegationBytes),
    appendedAt: evidence.appendedAt,
    appendReceiptBytes: copyBytes(evidence.appendReceiptBytes),
    currentHeadProofBytes: copyBytes(evidence.currentHeadProofBytes),
  };
}

async function createProofContext(
  input: FreshnessCurrentStateReadInput,
  chainId: string,
): Promise<FreshnessCurrentStateProofContext> {
  if (!isNonEmptyString(chainId)) {
    invalidEvidence("Pinned Release Journal chain identity is missing");
  }
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const context: Omit<FreshnessCurrentStateProofContext, "readContextSha256"> = {
    environment: "production",
    chainId,
    operation: { ...input.operation },
    lease: {
      ...input.lease,
      operation: { ...input.lease.operation },
      currentState: copyCurrentStateBinding(input.lease.currentState),
    },
    clock: { ...input.clock },
    readNonce: encodeBase64Url(nonceBytes),
  };
  return {
    ...context,
    readContextSha256: await proofContextSha256(context),
  };
}

function copyProofContext(
  context: FreshnessCurrentStateProofContext,
): FreshnessCurrentStateProofContext {
  return {
    environment: context.environment,
    chainId: context.chainId,
    operation: { ...context.operation },
    lease: {
      ...context.lease,
      operation: { ...context.lease.operation },
      currentState: copyCurrentStateBinding(context.lease.currentState),
    },
    clock: { ...context.clock },
    readNonce: context.readNonce,
    readContextSha256: context.readContextSha256,
  };
}

function copyReadProofContext(
  context: FreshnessCurrentStateReadProofContext,
): FreshnessCurrentStateReadProofContext {
  if ("mode" in context) {
    return {
      ...context,
      clock: { ...context.clock },
    };
  }
  return copyProofContext(context);
}

async function assertProofContextMatchesInput(
  context: FreshnessCurrentStateProofContext,
  input: FreshnessCurrentStateReadInput,
  expectedChainId: string,
): Promise<void> {
  await assertReadProofContext(context, expectedChainId);
  if (
    !sameOperation(context.operation, input.operation) ||
    !sameLease(context.lease, input.lease) ||
    context.clock.clockId !== input.clock.clockId ||
    context.clock.clockEpoch !== input.clock.clockEpoch ||
    context.clock.nowMs !== input.clock.nowMs ||
    context.clock.uncertaintyMs !== input.clock.uncertaintyMs
  ) {
    invalidEvidence("Current-state proof context differs from the issue operation");
  }
}

async function assertReadProofContext(
  context: FreshnessCurrentStateReadProofContext,
  expectedChainId: string,
): Promise<void> {
  if (
    context.environment !== "production" ||
    context.chainId !== expectedChainId ||
    !isNonEmptyString(context.clock.clockId) ||
    !isNonEmptyString(context.clock.clockEpoch) ||
    !Number.isSafeInteger(context.clock.nowMs) ||
    !Number.isSafeInteger(context.clock.uncertaintyMs) ||
    context.clock.uncertaintyMs < 0 ||
    !READ_NONCE_PATTERN.test(context.readNonce) ||
    !SHA256_BASE64URL_PATTERN.test(context.readContextSha256)
  ) {
    invalidEvidence("Current-state read proof context is invalid");
  }
  if ("mode" in context) {
    assertInstallContextInput({
      mode: context.mode,
      environment: context.environment,
      chainId: context.chainId,
      installOperationId: context.installOperationId,
      installFencingToken: context.installFencingToken,
      releaseOperationId: context.releaseOperationId,
      releaseFencingToken: context.releaseFencingToken,
      targetPosition: context.targetPosition,
      targetGeneration: context.targetGeneration,
      targetRecordSha256: context.targetRecordSha256,
      expectedRestoreEpoch: context.expectedRestoreEpoch,
      expectedCurrentStateSha256: context.expectedCurrentStateSha256,
      clock: context.clock,
    });
  }
  const expectedDigest = await proofContextSha256(
    "mode" in context
      ? {
          mode: context.mode,
          environment: context.environment,
          chainId: context.chainId,
          installOperationId: context.installOperationId,
          installFencingToken: context.installFencingToken,
          releaseOperationId: context.releaseOperationId,
          releaseFencingToken: context.releaseFencingToken,
          targetPosition: context.targetPosition,
          targetGeneration: context.targetGeneration,
          targetRecordSha256: context.targetRecordSha256,
          expectedRestoreEpoch: context.expectedRestoreEpoch,
          expectedCurrentStateSha256: context.expectedCurrentStateSha256,
          clock: context.clock,
          readNonce: context.readNonce,
        }
      : {
          environment: context.environment,
          chainId: context.chainId,
          operation: context.operation,
          lease: context.lease,
          clock: context.clock,
          readNonce: context.readNonce,
        },
  );
  if (context.readContextSha256 !== expectedDigest) {
    invalidEvidence("Current-state read proof context digest is invalid");
  }
}

function assertMatchingReadProofContexts(
  left: FreshnessCurrentStateReadProofContext,
  right: FreshnessCurrentStateReadProofContext,
): void {
  if (!bytesEqual(canonicalJsonBytes(left), canonicalJsonBytes(right))) {
    invalidEvidence("Release evidence is bound to a different proof context");
  }
}

async function proofContextSha256(
  context:
    | Omit<FreshnessCurrentStateProofContext, "readContextSha256">
    | FreshnessCurrentStateProofContext
    | Omit<FreshnessCurrentStateInstallProofContext, "readContextSha256">
    | FreshnessCurrentStateInstallProofContext,
): Promise<string> {
  if ("mode" in context) {
    const contextBody = {
      mode: context.mode,
      environment: context.environment,
      chainId: context.chainId,
      installOperationId: context.installOperationId,
      installFencingToken: context.installFencingToken,
      releaseOperationId: context.releaseOperationId,
      releaseFencingToken: context.releaseFencingToken,
      targetPosition: context.targetPosition,
      targetGeneration: context.targetGeneration,
      targetRecordSha256: context.targetRecordSha256,
      expectedRestoreEpoch: context.expectedRestoreEpoch,
      expectedCurrentStateSha256: context.expectedCurrentStateSha256,
      clock: context.clock,
      readNonce: context.readNonce,
    };
    return sha256Base64Url(
      canonicalJsonBytes({
        scope: CURRENT_STATE_INSTALL_CONTEXT_SCOPE,
        schema_version: 1,
        context: contextBody,
      }),
    );
  }
  const contextBody = {
    environment: context.environment,
    chainId: context.chainId,
    operation: context.operation,
    lease: context.lease,
    clock: context.clock,
    readNonce: context.readNonce,
  };
  return sha256Base64Url(
    canonicalJsonBytes({
      scope: CURRENT_STATE_READ_CONTEXT_SCOPE,
      schema_version: 1,
      context: contextBody,
    }),
  );
}

function assertInstallContextInput(
  input: FreshnessCurrentStateInstallProofContextInput,
): void {
  if (
    (input.mode !== "BOOTSTRAP" && input.mode !== "ADVANCE") ||
    input.environment !== "production" ||
    !isNonEmptyString(input.chainId) ||
    !INSTALL_OPERATION_ID_PATTERN.test(input.installOperationId) ||
    !FENCING_TOKEN_PATTERN.test(input.installFencingToken) ||
    !INSTALL_OPERATION_ID_PATTERN.test(input.releaseOperationId) ||
    !FENCING_TOKEN_PATTERN.test(input.releaseFencingToken) ||
    !CANONICAL_POSITION_PATTERN.test(input.targetPosition) ||
    BigInt(input.targetPosition) < 1n ||
    !CANONICAL_POSITION_PATTERN.test(input.targetGeneration) ||
    BigInt(input.targetGeneration) < 1n ||
    !SHA256_BASE64URL_PATTERN.test(input.targetRecordSha256) ||
    !isNonEmptyString(input.expectedRestoreEpoch) ||
    (input.expectedCurrentStateSha256 !== null &&
      !SHA256_BASE64URL_PATTERN.test(input.expectedCurrentStateSha256)) ||
    (input.mode === "BOOTSTRAP" && input.expectedCurrentStateSha256 !== null) ||
    (input.mode === "ADVANCE" && input.expectedCurrentStateSha256 === null) ||
    !isNonEmptyString(input.clock.clockId) ||
    !isNonEmptyString(input.clock.clockEpoch) ||
    !Number.isSafeInteger(input.clock.nowMs) ||
    !Number.isSafeInteger(input.clock.uncertaintyMs) ||
    input.clock.uncertaintyMs < 0
  ) {
    throw new FreshnessCurrentStateReaderError(
      "INVALID_EVIDENCE",
      "Current-state install proof context input is invalid",
    );
  }
}

function assertInstallProofContextTarget(
  context: FreshnessCurrentStateReadProofContext,
  state: VerifiedFreshnessReleaseState,
): void {
  if (
    "mode" in context &&
    (context.environment !== state.environment ||
      context.chainId !== state.chainId ||
      context.targetPosition !== state.journalHead.position ||
      context.targetGeneration !== state.journalHead.generation ||
      context.targetRecordSha256 !== state.journalHead.record_sha256 ||
      context.expectedRestoreEpoch !== state.antiRollbackWitness.restoreEpoch)
  ) {
    invalidEvidence("Install proof context does not bind the verified Release head");
  }
}

function assertAuthenticatedReadTime(
  observedAtMs: number,
  clockId: string,
  clockEpoch: string,
  clockUncertaintyMs: number,
  context: FreshnessCurrentStateReadProofContext,
  label: string,
): void {
  const lowerBound = observedAtMs - clockUncertaintyMs;
  const upperBound = observedAtMs + clockUncertaintyMs;
  if (
    !Number.isSafeInteger(observedAtMs) ||
    !Number.isSafeInteger(clockUncertaintyMs) ||
    clockUncertaintyMs < 0 ||
    !Number.isSafeInteger(lowerBound) ||
    !Number.isSafeInteger(upperBound) ||
    clockId !== context.clock.clockId ||
    clockEpoch !== context.clock.clockEpoch
  ) {
    invalidEvidence(`${label} is outside the authenticated read-clock epoch`);
  }
  if ("mode" in context) {
    if (
      clockUncertaintyMs > context.clock.uncertaintyMs ||
      lowerBound > context.clock.nowMs + context.clock.uncertaintyMs
    ) {
      invalidEvidence(`${label} exceeds the authenticated install-read clock bound`);
    }
    return;
  }
  if (
    clockUncertaintyMs > context.lease.clockUncertaintyMs ||
    lowerBound < context.lease.acquiredAtMs ||
    upperBound >= context.lease.expiresAtMs
  ) {
    invalidEvidence(`${label} is outside the authenticated issue-lease clock window`);
  }
}

function copyWitnessEvidence(
  evidence: FreshnessAntiRollbackWitnessEvidence,
): FreshnessAntiRollbackWitnessEvidence {
  return {
    sourceId: evidence.sourceId,
    restoreEpoch: evidence.restoreEpoch,
    generation: evidence.generation,
    recordSha256: evidence.recordSha256,
    signedBytes: copyBytes(evidence.signedBytes),
  };
}

function copyCoordinatorSnapshot(
  snapshot: FreshnessIssueCoordinatorSnapshot,
): FreshnessIssueCoordinatorSnapshot {
  return {
    operation: { ...snapshot.operation },
    lease: {
      ...snapshot.lease,
      operation: { ...snapshot.lease.operation },
      currentState: copyCurrentStateBinding(snapshot.lease.currentState),
    },
    operationStatus: snapshot.operationStatus,
    blocker: snapshot.blocker,
    environment: snapshot.environment,
    currentState: copyCurrentStateBinding(snapshot.currentState),
    witness: { ...snapshot.witness },
    restoreEpoch: snapshot.restoreEpoch,
    writerPending: snapshot.writerPending,
  };
}

function assertDependencies(
  dependencies: FreshnessCurrentStateReaderDependencies,
): void {
  if (
    typeof dependencies?.coordinator?.readCurrentStateSnapshot !== "function"
  ) {
    throw new FreshnessCurrentStateReaderError(
      "MISSING_ADAPTER",
      "Current-state issue verification requires an explicit Coordinator snapshot adapter",
    );
  }
  assertReleaseStateReaderDependencies(dependencies);
}

function assertReleaseStateReaderDependencies(
  dependencies: FreshnessReleaseStateReaderDependencies,
): void {
  if (
    !dependencies ||
    !isNonEmptyString(dependencies.journal?.expectedProviderId) ||
    !isNonEmptyString(dependencies.journal?.expectedChainId) ||
    !isNonEmptyString(dependencies.journal?.expectedAppendTimeSourceId) ||
    typeof dependencies.journal?.readCurrentHead !== "function" ||
    typeof dependencies.journal.verifier?.verifyCurrentHead !== "function" ||
    typeof dependencies.manifests?.readCurrentManifestPointer !== "function" ||
    typeof dependencies.manifests?.readImmutableManifestSnapshot !== "function" ||
    typeof dependencies.antiRollbackWitness?.readCurrentWitness !== "function" ||
    !isNonEmptyString(dependencies.antiRollbackWitness?.expectedSourceId) ||
    typeof dependencies.antiRollbackWitness.verifier?.verifyExternalWitness !==
      "function" ||
    dependencies.releaseRootSigner === undefined ||
    dependencies.manifestRootSigner === undefined ||
    typeof dependencies.manifestUrl !== "string" ||
    dependencies.manifestUrl.length === 0
  ) {
    throw new FreshnessCurrentStateReaderError(
      "MISSING_ADAPTER",
      "Release verification requires explicit Journal, R2, Manifest, and independent-witness trust adapters",
    );
  }
}

function sameOperation(
  left: FreshnessIssueOperationBinding,
  right: FreshnessIssueOperationBinding,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.signerOperationId === right.signerOperationId &&
    left.requestSha256 === right.requestSha256 &&
    left.requestNonce === right.requestNonce &&
    left.environment === right.environment &&
    left.audienceManifestUrlSha256 === right.audienceManifestUrlSha256
  );
}

function assertPosition(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length > 20 ||
    !CANONICAL_POSITION_PATTERN.test(value) ||
    BigInt(value) < 1n
  ) {
    invalidEvidence(`${label} is not a canonical positive integer`);
  }
}

function sameLease(
  left: FreshnessIssueLeaseBinding,
  right: FreshnessIssueLeaseBinding,
): boolean {
  return (
    sameOperation(left.operation, right.operation) &&
    left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.acquiredAtMs === right.acquiredAtMs &&
    left.expiresAtMs === right.expiresAtMs &&
    left.clockId === right.clockId &&
    left.clockEpoch === right.clockEpoch &&
    left.clockUncertaintyMs === right.clockUncertaintyMs &&
    sameCurrentStateBinding(left.currentState, right.currentState)
  );
}

function sameCurrentStateBinding(
  left: FreshnessIssueCurrentStateBinding,
  right: FreshnessIssueCurrentStateBinding,
): boolean {
  return bytesEqual(canonicalJsonBytes(left), canonicalJsonBytes(right));
}

function copyCurrentStateBinding(
  state: FreshnessIssueCurrentStateBinding,
): FreshnessIssueCurrentStateBinding {
  return {
    ...state,
    antiRollbackWitness: { ...state.antiRollbackWitness },
  };
}

function sameWitness(
  left: FreshnessAntiRollbackWitnessBinding,
  right: FreshnessAntiRollbackWitnessBinding,
): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.restoreEpoch === right.restoreEpoch &&
    left.generation === right.generation &&
    left.recordSha256 === right.recordSha256
  );
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const input = copyBytes(bytes);
  const buffer = new ArrayBuffer(input.byteLength);
  new Uint8Array(buffer).set(input);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return encodeBase64Url(new Uint8Array(digest));
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    invalidEvidence("Current-state source returned a non-byte value");
  }
  return Uint8Array.from(bytes);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertNonEmptyBytes(bytes: Uint8Array, label: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    invalidEvidence(`${label} bytes are missing`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertDigest(value: string, label: string): void {
  if (!SHA256_BASE64URL_PATTERN.test(value)) {
    invalidEvidence(`${label} is not a canonical SHA-256 digest`);
  }
}

function unavailable(message: string): never {
  throw new FreshnessCurrentStateReaderError("UNAVAILABLE", message);
}

function invalidEvidence(message: string): never {
  throw new FreshnessCurrentStateReaderError("INVALID_EVIDENCE", message);
}
