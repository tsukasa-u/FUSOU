import assert from "node:assert/strict";
import { randomUUID, webcrypto } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  MAX_FRESHNESS_ISSUE_LEASE_MS,
  issueRuntimeConfigFreshness,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts";
import {
  createCloudflareOperatorReleaseStateReader,
  createWorkerReadableCloudflareOperatorFreshnessSigner,
  issueCloudflareOperatorFreshness,
  verifyCloudflareOperatorFreshnessResponse,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-cloudflare-operator.ts";
import {
  signRuntimeConfigFreshnessResponseEnvelope,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import {
  createFreshnessCurrentStateInstallProofContext,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-current-state-reader.ts";
import {
  DurableObjectFreshnessIssueCoordinatorAdapter,
} from "../src/durable-object-adapter.ts";
import { RUNTIME_CONFIG_MANIFEST_POINTER_KEY } from "../src/r2-release-store.ts";
import {
  decodeRuntimeRpcValue,
  encodeRuntimeRpcValue,
  MAX_RUNTIME_RPC_REQUEST_BYTES,
  RUNTIME_RPC_PATH,
} from "../tests/runtime/rpc-data.ts";
import {
  clockEpoch,
  clockId,
  digest,
  equalBytes,
  makeCurrentStateReader,
  makeDifferentRequestBytes,
  makeRequestIdentity,
  makeSignedCurrentStateFixture,
  makeSignedReleaseStateReader,
  makeSignedNextReleaseRecord,
  makeSignedCurrentStateReader,
  makeTestSigner,
  makeVerifiedCurrentState,
  requestBytes,
  responseBytes,
  rootSigner,
  signedAtMs,
  vector,
  verifyFixtureResponse,
  verifySignedFixtureResponse,
} from "../tests/runtime/fixtures.mjs";

const CHILD_ENV = "FUSOU_FRESHNESS_COORDINATOR_RUNTIME_TEST_CHILD";
const ROOT_ENV = "FUSOU_FRESHNESS_COORDINATOR_RUNTIME_TEST_ROOT";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_NAME = "fusou-freshness-coordinator-runtime-test";
const BINDING_NAME = "FRESHNESS_ISSUE_COORDINATOR";
const CLASS_NAME = "LocalTestFreshnessIssueCoordinatorDO";
const RELEASE_WORKER_NAME = "fusou-release-ledger-runtime-test";
const RELEASE_CLASS_NAME = "LocalTestReleaseLedgerCoordinatorDO";
const RELEASE_R2_BUCKET_NAME = "fusou-release-ledger-runtime-test";
const LOCAL_CONFIG = resolve(
  PACKAGE_ROOT,
  "tests/runtime/local-only.wrangler.toml",
);
const WORKER_SOURCE = resolve(PACKAGE_ROOT, "tests/runtime/worker.ts");
const TOTAL_TIMEOUT_MS = 180_000;
const CHILD_SHUTDOWN_GRACE_MS = 8_000;
const RUNTIME_DISPOSE_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 8_000;
const UINT64_MAX = "18446744073709551615";
let localManifestEpochSequence = 100;

if (process.env[CHILD_ENV] === "1") {
  registerRuntimeTests();
} else {
  await superviseRuntimeTests();
}

function registerRuntimeTests() {
  const root = process.env[ROOT_ENV];
  assert.ok(root, "runtime supervisor must provide a temporary root");

  const context = {
    root,
    currentRuntime: undefined,
    namespace: undefined,
    releaseNamespace: undefined,
    workerBundle: undefined,
    fixture: undefined,
    signedReleaseFixture: undefined,
    compatibilityDate: undefined,
    interruptions: new Set(),
    cleanupPromise: undefined,
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      context.interruptions.add(signal);
      void cleanupRuntime(context).catch((error) => {
        console.error(
          `Runtime cleanup after ${signal} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        process.exitCode = signal === "SIGINT" ? 130 : 143;
      });
    });
  }

  describe(
    "SQLite-backed Freshness issue coordinator in pinned local Workers runtime",
    { concurrency: false },
    () => {
      before(async () => {
        context.fixture = await makeVerifiedCurrentState();
        context.signedReleaseFixture = await makeSignedCurrentStateFixture();
        context.compatibilityDate = readLocalRuntimeConfig();
        await buildWorker(context);
        await startRuntime(context);
      });

      after(async () => {
        await cleanupRuntime(context);
      });

      it(
        "rechecks Release delegation expiry at the ledger commit point",
        { timeout: 40_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-release-expiry-at-commit",
          );
          const nowMs = Date.now() + 5_000;
          const notAfterMs = nowMs + 1_000;
          const intent = await startReleaseIntent(
            seeded.coordinator,
            seeded.fixture,
            {
              manifestEpoch: "71002",
              nowMs,
              releaseDelegationNotAfterMs: notAfterMs,
            },
          );
          const staged = await stageReleaseIntent(
            seeded.coordinator,
            intent,
          );
          await rpc(
            seeded.stub.setCloudflareOperatorRuntimeUtcSequenceForLocalTest(
              [nowMs, nowMs, notAfterMs],
            ),
            "advance operator UTC between Release verification and commit",
          );
          const appended = await appendReleaseIntent(
            seeded.coordinator,
            staged,
          );
          assert.equal(appended.appended.status, "QUARANTINED");
          assert.match(
            appended.appended.operation.reason,
            /delegation expired/u,
          );
        },
      );

      it(
        "runs the explicit Cloudflare/operator Release-to-issue profile without an eight-second cutoff",
        { timeout: 40_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-long-sign",
          );
          const harness = await makeCloudflareOperatorHarness(context, seeded);
          let signerCalls = 0;
          const delayedSigner = {
            async issue(request) {
              signerCalls += 1;
              const result = await harness.signer.issue(request);
              await new Promise((resolvePromise) =>
                setTimeout(resolvePromise, 8_100)
              );
              return result;
            },
          };
          const operationId = randomUUID();
          const input = { operationId, requestBytes };
          const result = await issueCloudflareOperatorFreshness(input, {
            ...harness.dependencies,
            signer: delayedSigner,
          });
          assert.equal(result.status, "ISSUED");
          assert.equal(result.responseLength, result.responseBytes.byteLength);
          assert.equal(result.responseSha256, digest(result.responseBytes));
          assert.equal(signerCalls, 1);
          const verifiedState = await harness.stateReader.readCurrentState();
          const verified = await verifyCloudflareOperatorFreshnessResponse({
            raw: result.responseBytes,
            bootstrapSigner: seeded.fixture.rootSigner,
            manifestUrl: vector.manifest_url,
            requestBytes,
            nowMs: Date.now(),
            expectedState: verifiedState.state,
          });
          assert.equal(
            verified.releaseCommit.digest,
            verifiedState.state.recordSha256,
          );
          const repeated = await issueCloudflareOperatorFreshness(input, {
            ...harness.dependencies,
            signer: delayedSigner,
          });
          assert.equal(repeated.status, "ALREADY_FINALIZED");
          assert.ok(equalBytes(repeated.responseBytes, result.responseBytes));
          assert.equal(signerCalls, 1);
          const conflicting = await issueCloudflareOperatorFreshness(
            {
              operationId,
              requestBytes: makeDifferentRequestBytes(),
            },
            { ...harness.dependencies, signer: delayedSigner },
          );
          assert.equal(conflicting.status, "CONFLICT");
          assert.equal(signerCalls, 1);
          const wrongChain = await rpc(
            harness.coordinator.getCloudflareOperatorIssue({
              operationId,
              requestBytes,
              chainId: `${seeded.fixture.releaseHead.chainId}-other`,
            }),
            "reject operator result lookup under a different chain",
          );
          assert.equal(wrongChain.status, "CONFLICT");

          await restartRuntime(context);
          const reloaded = coordinatorForName(
            context,
            seeded.objectName,
            seeded.objectId,
            context.releaseNamespace,
          ).coordinator;
          const lookup = await rpc(
            reloaded.getCloudflareOperatorIssue({
              operationId,
              requestBytes,
              chainId: seeded.fixture.releaseHead.chainId,
            }),
            "lookup exact operator-profile result after runtime recreation",
          );
          assert.equal(lookup.status, "FINALIZED");
          assert.equal(lookup.responseBytes.byteLength, result.responseLength);
          assert.equal(lookup.responseSha256, result.responseSha256);
          assert.ok(equalBytes(lookup.responseBytes, result.responseBytes));
        },
      );

      it(
        "strict and Cloudflare/operator readers bind delegated Manifest bytes through Release and Freshness",
        { timeout: 60_000 },
        async () => {
          const strictFixture = await makeSignedCurrentStateFixture({
            delegatedManifest: true,
          });
          const operationId = randomUUID();
          const request = await makeRequestIdentity(operationId, requestBytes);
          const operation = {
            ...request.identity,
            signerOperationId: randomUUID(),
          };
          const nowMs = strictFixture.nowMs;
          const clock = {
            clockId,
            clockEpoch,
            nowMs,
            uncertaintyMs: 0,
          };
          const lease = {
            operation,
            leaseId: randomUUID(),
            fencingToken: "1",
            acquiredAtMs: nowMs - 5_000,
            expiresAtMs: nowMs + 20_000,
            clockId,
            clockEpoch,
            clockUncertaintyMs: 0,
            currentState: strictFixture.currentState,
          };
          const coordinator = {
            async readCurrentStateSnapshot() {
              return {
                operation,
                lease,
                operationStatus: "IN_PROGRESS",
                blocker: "RETAINED",
                environment: "production",
                currentState: strictFixture.currentState,
                witness: strictFixture.witness,
                restoreEpoch: strictFixture.witness.restoreEpoch,
                writerPending: false,
              };
            },
          };
          const strictReader = makeSignedCurrentStateReader(
            strictFixture,
            coordinator,
          );
          const readInput = {
            operation,
            challenge: request.challenge,
            lease,
            clock,
          };
          const strictEvidence = await strictReader.readCurrentState(readInput);
          const strictState = await strictReader.verifyCurrentState(
            strictEvidence,
            readInput,
          );
          assert.ok(equalBytes(strictState.manifestBytes, strictFixture.manifestBytes));
          assert.equal(strictState.manifestSha256, strictFixture.manifestSha256);

          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-delegated-manifest-binding",
            { delegatedManifest: true },
          );
          const harness = await makeCloudflareOperatorHarness(context, seeded);
          const operatorState = await harness.stateReader.readCurrentState();
          assert.equal(operatorState.manifest.envelopeSchemaVersion, 3);
          assert.equal(operatorState.manifest.manifestAuthorityGeneration, "1");
          assert.ok(equalBytes(operatorState.manifestBytes, seeded.fixture.manifestBytes));

          const issued = await issueCloudflareOperatorFreshness(
            { operationId: randomUUID(), requestBytes },
            harness.dependencies,
          );
          assert.equal(issued.status, "ISSUED");
          assert.equal(issued.responseLength, issued.responseBytes.byteLength);
          assert.equal(issued.responseSha256, digest(issued.responseBytes));
          const verified = await verifyCloudflareOperatorFreshnessResponse({
            raw: issued.responseBytes,
            bootstrapSigner: seeded.fixture.rootSigner,
            manifestUrl: seeded.fixture.manifestUrl,
            requestBytes,
            nowMs: Date.now(),
            expectedState: operatorState.state,
          });
          assert.equal(
            verified.releaseCommit.payload.manifest_sha256,
            seeded.fixture.manifestSha256,
          );
        },
      );

      it(
        "requires a durable admitted operation before the private Signer can sign",
        { timeout: 40_000 },
        async () => {
          const absentSeed = await seededCloudflareOperatorCoordinator(
            context,
            "operator-signer-absent",
          );
          const absentHarness = await makeCloudflareOperatorHarness(
            context,
            absentSeed,
          );
          const absentId = randomUUID();
          const absentIdentity = await makeRequestIdentity(absentId);
          const absentState = await absentHarness.stateReader.readCurrentState();
          const absentOperation = {
            profileId: "cloudflare-operator-v1",
            operationId: absentId,
            signerOperationId: `cloudflare-operator-freshness:${absentId}`,
            requestSha256: absentIdentity.identity.requestSha256,
            requestNonce: absentIdentity.challenge.request_nonce,
            environment: "production",
            chainId: absentSeed.fixture.releaseHead.chainId,
            audienceManifestUrlSha256:
              absentIdentity.challenge.audience_manifest_url_sha256,
          };
          const absentRequest = makeOperatorSigningRequest(
            absentOperation,
            "1",
            requestBytes,
            absentIdentity,
            absentState.state,
          );
          const absentSignatures = await withFreshnessResponseSignatureCount(
            absentHarness.privateKey,
            async () => {
              await assert.rejects(
                () => absentHarness.signer.issue(absentRequest),
                /NOT_FOUND/u,
              );
            },
          );
          assert.equal(absentSignatures, 0);

          for (const status of ["RESULT_UNKNOWN", "REJECTED"]) {
            const seeded = await seededCloudflareOperatorCoordinator(
              context,
              `operator-signer-${status.toLowerCase()}`,
            );
            const harness = await makeCloudflareOperatorHarness(context, seeded);
            const { identity, admission } =
              await admitCloudflareOperatorIssueForTest(
                harness,
                randomUUID(),
                requestBytes,
                `admit ${status} direct-signer case`,
              );
            const terminal = status === "RESULT_UNKNOWN"
              ? await rpc(
                  harness.coordinator.markCloudflareOperatorIssueUnknown({
                    operation: admission.operation,
                    fencingToken: admission.fencingToken,
                  }),
                  "make direct-signer operation unknown",
                )
              : await rpc(
                  harness.coordinator.rejectCloudflareOperatorIssue({
                    operation: admission.operation,
                    fencingToken: admission.fencingToken,
                    reason: "Local direct-signer rejection case",
                  }),
                  "reject direct-signer operation",
                );
            assert.equal(terminal.status, status);
            const signingRequest = makeOperatorSigningRequest(
              admission.operation,
              admission.fencingToken,
              requestBytes,
              identity,
              admission.currentState,
            );
            const signatures = await withFreshnessResponseSignatureCount(
              harness.privateKey,
              async () => {
                await assert.rejects(
                  () => harness.signer.issue(signingRequest),
                  new RegExp(status, "u"),
                );
              },
            );
            assert.equal(signatures, 0);
          }

          const finalizedSeed = await seededCloudflareOperatorCoordinator(
            context,
            "operator-signer-finalized",
          );
          const finalizedHarness = await makeCloudflareOperatorHarness(
            context,
            finalizedSeed,
          );
          const finalizedId = randomUUID();
          const issued = await issueCloudflareOperatorFreshness(
            { operationId: finalizedId, requestBytes },
            finalizedHarness.dependencies,
          );
          assert.equal(issued.status, "ISSUED");
          const finalizedAdmission = await rpc(
            finalizedHarness.coordinator.getCloudflareOperatorIssue({
              operationId: finalizedId,
              requestBytes,
              chainId: finalizedSeed.fixture.releaseHead.chainId,
            }),
            "read finalized operation before direct signer replay",
          );
          assert.equal(finalizedAdmission.status, "FINALIZED");
          assert.ok(finalizedAdmission.operation);
          const finalizedIdentity = await makeRequestIdentity(finalizedId);
          const finalizedState = await finalizedHarness.stateReader
            .readCurrentState();
          const finalizedRequest = makeOperatorSigningRequest(
            finalizedAdmission.operation,
            finalizedAdmission.fencingToken,
            requestBytes,
            finalizedIdentity,
            finalizedState.state,
          );
          assert.ok(finalizedRequest.issue);
          const finalizedSignatures = await withFreshnessResponseSignatureCount(
            finalizedHarness.privateKey,
            async () => {
              await assert.rejects(
                () => finalizedHarness.signer.issue(finalizedRequest),
                /FINALIZED/u,
              );
            },
          );
          assert.equal(finalizedSignatures, 0);
        },
      );

      it(
        "binds the private signing claim to request, Release, fence, and one atomic signer start",
        { timeout: 40_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-signer-claim-race",
          );
          const harness = await makeCloudflareOperatorHarness(context, seeded);
          const operationId = randomUUID();
          const { identity, admission } =
            await admitCloudflareOperatorIssueForTest(
              harness,
              operationId,
              requestBytes,
              "admit direct-signer claim race",
            );
          const signingRequest = makeOperatorSigningRequest(
            admission.operation,
            admission.fencingToken,
            requestBytes,
            identity,
            admission.currentState,
          );
          const differentBytes = makeDifferentRequestBytes();
          const differentIdentity = await makeRequestIdentity(
            operationId,
            differentBytes,
          );
          const alteredRelease = {
            ...admission.currentState,
            releaseOperationId: randomUUID(),
          };
          const invalidRequests = [
            {
              request: {
                ...signingRequest,
                issue: {
                  ...admission.operation,
                  operationId: randomUUID(),
                },
              },
              error: /NOT_FOUND/u,
            },
            {
              request: {
                ...signingRequest,
                issue: {
                  ...admission.operation,
                  signerOperationId: "cloudflare-operator-freshness:wrong",
                },
              },
              error: /CONFLICT/u,
            },
            {
              request: {
                ...signingRequest,
                issue: {
                  ...admission.operation,
                  requestSha256: "A".repeat(43),
                },
              },
              error: /exact request bytes/u,
            },
            {
              request: {
                ...signingRequest,
                issue: {
                  ...admission.operation,
                  requestSha256: differentIdentity.identity.requestSha256,
                  requestNonce: differentIdentity.challenge.request_nonce,
                },
                requestBytes: differentBytes,
                challenge: differentIdentity.challenge,
              },
              error: /CONFLICT/u,
            },
            {
              request: {
                ...signingRequest,
                issue: {
                  ...admission.operation,
                  requestNonce: "wrong-nonce",
                },
              },
              error: /fixed profile/u,
            },
            {
              request: {
                ...signingRequest,
                issue: {
                  ...admission.operation,
                  audienceManifestUrlSha256: "A".repeat(43),
                },
              },
              error: /fixed profile/u,
            },
            {
              request: {
                ...signingRequest,
                issue: {
                  ...admission.operation,
                  chainId: `${admission.operation.chainId}-wrong`,
                },
              },
              error: /fixed profile/u,
            },
            {
              request: {
                ...signingRequest,
                fencingToken: "999",
              },
              error: /CONFLICT/u,
            },
            {
              request: {
                ...signingRequest,
                currentState: alteredRelease,
              },
              error: /authorization/u,
            },
          ];

          await assert.rejects(
            () => harness.stateReader.readCurrentState({ operationId }),
            /issue blockers/u,
          );
          await assert.rejects(
            () =>
              harness.stateReader.readCurrentState({
                operationId: randomUUID(),
              }),
            /issue blockers/u,
          );

          let signedResponseBytes;
          const signatures = await withFreshnessResponseSignatureCount(
            harness.privateKey,
            async () => {
              for (const invalid of invalidRequests) {
                await assert.rejects(
                  () => harness.signer.issue(invalid.request),
                  invalid.error,
                );
              }
              const racing = await Promise.allSettled([
                harness.signer.issue(signingRequest),
                harness.signer.issue(signingRequest),
              ]);
              const completed = racing.filter(
                (result) => result.status === "fulfilled",
              );
              const rejected = racing.filter(
                (result) => result.status === "rejected",
              );
              assert.equal(completed.length, 1);
              assert.equal(rejected.length, 1);
              assert.equal(completed[0].value.outcome, "COMPLETED");
              signedResponseBytes = completed[0].value.responseBytes;
            },
          );
          assert.equal(signatures, 1);

          await restartRuntime(context);
          const reloaded = coordinatorForName(
            context,
            seeded.objectName,
            seeded.objectId,
            context.releaseNamespace,
          ).coordinator;
          const reloadedHarness = await makeCloudflareOperatorHarness(
            context,
            { ...seeded, coordinator: reloaded },
          );
          const replaySignatures = await withFreshnessResponseSignatureCount(
            reloadedHarness.privateKey,
            async () => {
              await assert.rejects(
                () => reloadedHarness.signer.issue(signingRequest),
                /ALREADY_CLAIMED/u,
              );
            },
          );
          assert.equal(replaySignatures, 0);
          const authorization = {
            operation: admission.operation,
            fencingToken: admission.fencingToken,
            requestBytes,
            currentState: admission.currentState,
          };
          const state = await reloadedHarness.stateReader.readCurrentState({
            issueAuthorization: authorization,
          });
          const finalized = await rpc(
            reloadedHarness.coordinator.finalizeCloudflareOperatorIssue({
              operation: admission.operation,
              fencingToken: admission.fencingToken,
              currentStateSha256: state.state.stateSha256,
              responseBytes: signedResponseBytes,
            }),
            "finalize the single claimed signer result after restart",
          );
          assert.equal(finalized.status, "FINALIZED");
          const finalizedReplaySignatures =
            await withFreshnessResponseSignatureCount(
              reloadedHarness.privateKey,
              async () => {
                await assert.rejects(
                  () => reloadedHarness.signer.issue(signingRequest),
                  /FINALIZED/u,
                );
              },
          );
          assert.equal(finalizedReplaySignatures, 0);

          const lookup = await rpc(
            reloadedHarness.coordinator.getCloudflareOperatorIssue({
              operationId,
              requestBytes,
              chainId: seeded.fixture.releaseHead.chainId,
            }),
            "lookup exact response bytes after signer claim finalization",
          );
          assert.equal(lookup.status, "FINALIZED");
          assert.equal(lookup.responseBytes.byteLength, signedResponseBytes.byteLength);
          assert.equal(lookup.responseSha256, digest(signedResponseBytes));
          assert.ok(equalBytes(lookup.responseBytes, signedResponseBytes));
        },
      );

      it(
        "keeps a late signed result private and blocks Release while the operation is unknown",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-late-result",
          );
          const harness = await makeCloudflareOperatorHarness(context, seeded);
          const signerStarted = deferred();
          const releaseSignerResult = deferred();
          let signerCalls = 0;
          let privateSigningRequest;
          const heldSigner = {
            async issue(request) {
              signerCalls += 1;
              privateSigningRequest = request;
              await harness.signer.issue(request);
              signerStarted.resolve();
              await releaseSignerResult.promise;
              throw new Error("Local test simulated signer response loss");
            },
          };
          const operationId = randomUUID();
          const issuePromise = issueCloudflareOperatorFreshness(
            { operationId, requestBytes },
            { ...harness.dependencies, signer: heldSigner },
          );
          await withTimeout(
            signerStarted.promise,
            RPC_TIMEOUT_MS,
            "Cloudflare/operator signer completion",
          );
          releaseSignerResult.resolve();
          const issueResult = await withTimeout(
            issuePromise,
            RPC_TIMEOUT_MS,
            "late Cloudflare/operator signer result",
          );
          assert.equal(issueResult.status, "RESULT_UNKNOWN");
          assert.equal(signerCalls, 1);
          const committed = await rpc(
            seeded.coordinator.readCloudflareOperatorReleaseSnapshot(),
            "read Release evidence while the signer result is unknown",
          );
          const corruptedPointer = Uint8Array.from(
            committed.releaseOperation.manifestBytes,
          );
          corruptedPointer[0] ^= 1;
          await rpc(
            seeded.stub.writeReleaseObjectForLocalTest(
              RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
              corruptedPointer,
            ),
            "simulate a negative R2 read during an unknown issue",
          );
          await assert.rejects(
            () =>
              harness.stateReader.readCurrentState({ operationId }),
            /issue blockers/u,
          );
          const stillUnknown = await rpc(
            seeded.coordinator.getCloudflareOperatorIssue({
              operationId,
              requestBytes,
              chainId: seeded.fixture.releaseHead.chainId,
            }),
            "confirm negative R2 read does not resolve unknown issue",
          );
          assert.equal(stillUnknown.status, "RESULT_UNKNOWN");
          const releaseIntent = await startReleaseIntent(
            seeded.coordinator,
            seeded.fixture,
            { manifestEpoch: "71001", nowMs: Date.now() },
          );
          assert.equal(releaseIntent.started.status, "WAITING_FOR_ISSUES");
          const blockedStage = await rpc(
            seeded.coordinator.stageReleaseManifest({
              operationId: releaseIntent.operationId,
              fencingToken: releaseIntent.fencingToken,
            }),
            "ensure unresolved operator issue blocks Release write",
          );
          assert.equal(blockedStage.status, "WAITING_FOR_ISSUES");

          await restartRuntime(context);
          const reloaded = coordinatorForName(
            context,
            seeded.objectName,
            seeded.objectId,
            context.releaseNamespace,
          ).coordinator;
          const unknown = await rpc(
            reloaded.getCloudflareOperatorIssue({
              operationId,
              requestBytes,
              chainId: seeded.fixture.releaseHead.chainId,
            }),
            "preserve unknown operator issue after runtime recreation",
          );
          assert.equal(unknown.status, "RESULT_UNKNOWN");
          assert.equal(unknown.responseBytes, undefined);
          assert.ok(privateSigningRequest);
          const reloadedHarness = await makeCloudflareOperatorHarness(
            context,
            { ...seeded, coordinator: reloaded },
          );
          const retrySignatures = await withFreshnessResponseSignatureCount(
            reloadedHarness.privateKey,
            async () => {
              await assert.rejects(
                () => reloadedHarness.signer.issue(privateSigningRequest),
                /RESULT_UNKNOWN/u,
              );
            },
          );
          assert.equal(retrySignatures, 0);
          const stillBlocked = await rpc(
            reloaded.stageReleaseManifest({
              operationId: releaseIntent.operationId,
              fencingToken: releaseIntent.fencingToken,
            }),
            "keep Release blocked after restart",
          );
          assert.equal(stillBlocked.status, "WAITING_FOR_ISSUES");
        },
      );

      it(
        "rejects a response that expires between signing and exact finalization",
        { timeout: 20_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-expiry-finalization",
          );
          const harness = await makeCloudflareOperatorHarness(context, seeded);
          const operationId = randomUUID();
          const requestIdentity = await makeRequestIdentity(
            operationId,
            requestBytes,
          );
          const admission = await rpc(
            harness.coordinator.beginCloudflareOperatorIssue({
              operationId,
              requestBytes,
              requestSha256: digest(requestBytes),
              challengeNonce: requestIdentity.challenge.request_nonce,
              audienceManifestUrlSha256:
                requestIdentity.challenge.audience_manifest_url_sha256,
              chainId: seeded.fixture.releaseHead.chainId,
            }),
            "admit short-lived operator-profile issue",
          );
          assert.equal(admission.status, "ACQUIRED");
          const signed = await harness.signer.issue({
            operation: "ISSUE_LATEST_AT_ISSUANCE",
            profileId: admission.operation.profileId,
            issue: admission.operation,
            fencingToken: admission.fencingToken,
            requestBytes,
            challenge: requestIdentity.challenge,
            currentState: admission.currentState,
          });
          assert.equal(signed.outcome, "COMPLETED");
          const authorization = {
            operation: admission.operation,
            fencingToken: admission.fencingToken,
            requestBytes,
            currentState: admission.currentState,
          };
          const state = await rpc(
            harness.stateReader.readCurrentState({
              issueAuthorization: authorization,
            }),
            "read Release state under the persistent signing claim",
          );
          const envelope = JSON.parse(
            Buffer.from(signed.responseBytes).toString("utf8"),
          );
          const payload = JSON.parse(
            Buffer.from(envelope.payload_base64url, "base64url").toString(
              "utf8",
            ),
          );
          payload.expires_at = new Date(Date.now() + 1_000).toISOString();
          const responseBytes = await signRuntimeConfigFreshnessResponseEnvelope({
            payload,
            signerKeyId: seeded.fixture.freshnessKeyId,
            privateKey: harness.privateKey,
            freshnessDelegationBytes:
              seeded.fixture.freshnessDelegationBytes,
            releaseDelegationBytes: state.releaseDelegationBytes,
            releaseRecordBytes: state.recordBytes,
          });
          const verified = await verifyCloudflareOperatorFreshnessResponse({
            raw: responseBytes,
            bootstrapSigner: seeded.fixture.rootSigner,
            manifestUrl: vector.manifest_url,
            requestBytes,
            nowMs: Date.now(),
            expectedState: state.state,
          });
          await new Promise((resolvePromise) =>
            setTimeout(
              resolvePromise,
              Math.max(0, verified.expiresAtMs - Date.now() + 25),
            )
          );
          const finalized = await rpc(
            harness.coordinator.finalizeCloudflareOperatorIssue({
              operation: admission.operation,
              fencingToken: admission.fencingToken,
              currentStateSha256: state.state.stateSha256,
              responseBytes,
            }),
            "reject expired bytes at exact operator-profile finalization",
          );
          assert.equal(finalized.status, "REJECTED");
          assert.match(finalized.reason, /expired/i);
          const releaseIntent = await startReleaseIntent(
            seeded.coordinator,
            seeded.fixture,
            { manifestEpoch: "71002", nowMs: Date.now() },
          );
          assert.equal(releaseIntent.started.status, "STARTED");
        },
      );

      it(
        "uses runtime UTC for operator state and blocks an observed backward clock",
        { timeout: 20_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-runtime-utc",
          );
          const first = await rpc(
            seeded.coordinator.readCloudflareOperatorReleaseSnapshot(),
            "read operator profile runtime UTC",
          );
          await new Promise((resolvePromise) =>
            setTimeout(resolvePromise, 10)
          );
          const second = await rpc(
            seeded.coordinator.readCloudflareOperatorReleaseSnapshot(),
            "read updated operator profile runtime UTC",
          );
          assert.ok(second.observedAtMs > first.observedAtMs);
          assert.equal(first.lastObservedUtcMs, first.observedAtMs);
          assert.equal(second.lastObservedUtcMs, second.observedAtMs);
          assert.ok(second.observedAtMs > seeded.fixture.nowMs);

          await rpc(
            seeded.stub.setCloudflareOperatorObservedUtcForLocalTest(
              Date.now() + 60_000,
            ),
            "simulate a persisted future UTC observation",
          );
          await assert.rejects(
            () =>
              seeded.coordinator.readCloudflareOperatorReleaseSnapshot(),
            /Runtime UTC moved backwards/u,
          );
        },
      );

      it(
        "rejects uninstalled or mixed operator evidence and prevents rebootstrap",
        { timeout: 20_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-profile-boundaries",
            { install: false },
          );
          const harness = await makeCloudflareOperatorHarness(context, seeded);
          await assert.rejects(
            () => harness.stateReader.readCurrentState(),
            /AVAILABLE Release binding/u,
          );
          let signerCalls = 0;
          const signer = {
            async issue(request) {
              signerCalls += 1;
              return harness.signer.issue(request);
            },
          };
          const uninstalled = await issueCloudflareOperatorFreshness(
            { operationId: randomUUID(), requestBytes },
            { ...harness.dependencies, signer },
          );
          assert.equal(uninstalled.status, "CONFLICT");
          assert.equal(signerCalls, 0);

          await assert.rejects(
            () =>
              seeded.stub.bootstrapCloudflareOperatorProfileForLocalTest(
                seeded.bootstrapSeed,
              ),
            /cannot convert existing or legacy state/u,
          );

          await assert.rejects(
            () =>
              createWorkerReadableCloudflareOperatorFreshnessSigner({
                manifestUrl: vector.manifest_url,
                environment: "production",
                chainId: seeded.fixture.releaseHead.chainId,
                bootstrapSigner: seeded.fixture.rootSigner,
                key: {
                  keyId: seeded.fixture.freshnessKeyId,
                  privateKey: harness.privateKey,
                  freshnessDelegationBytes:
                    seeded.fixture.releaseDelegationBytes,
                },
                stateReader: harness.stateReader,
              }),
            /purpose|audience/u,
          );
          await assert.rejects(
            () =>
              createWorkerReadableCloudflareOperatorFreshnessSigner({
                manifestUrl: vector.manifest_url,
                environment: "production",
                chainId: seeded.fixture.releaseHead.chainId,
                bootstrapSigner: seeded.fixture.rootSigner,
                key: {
                  keyId: "wrong-local-freshness-key",
                  privateKey: harness.privateKey,
                  freshnessDelegationBytes:
                    seeded.fixture.freshnessDelegationBytes,
                },
                stateReader: harness.stateReader,
              }              ),
              /does not match.*Freshness delegation/u,
          );
          assert.equal(typeof harness.signer.sign, "undefined");
        },
      );

      it(
        "recovers exact bytes after finalization response loss and refuses expired lookup",
        { timeout: 20_000 },
        async () => {
          const seeded = await seededCloudflareOperatorCoordinator(
            context,
            "operator-finalize-response-loss",
          );
          const harness = await makeCloudflareOperatorHarness(context, seeded);
          let signerCalls = 0;
          const signer = {
            async issue(request) {
              signerCalls += 1;
              const signed = await harness.signer.issue(request);
              return {
                ...signed,
                responseBytes: await shortenFreshnessResponse(
                  signed.responseBytes,
                  seeded.fixture,
                  harness.privateKey,
                  1_500,
                ),
              };
            },
          };
          const coordinator = {
            beginCloudflareOperatorIssue: (input) =>
              harness.coordinator.beginCloudflareOperatorIssue(input),
            getCloudflareOperatorIssue: (input) =>
              harness.coordinator.getCloudflareOperatorIssue(input),
            markCloudflareOperatorIssueUnknown: (input) =>
              harness.coordinator.markCloudflareOperatorIssueUnknown(input),
            rejectCloudflareOperatorIssue: (input) =>
              harness.coordinator.rejectCloudflareOperatorIssue(input),
            async finalizeCloudflareOperatorIssue(input) {
              const finalized = await harness.coordinator
                .finalizeCloudflareOperatorIssue(input);
              if (finalized.status === "FINALIZED") {
                throw new Error("Local test simulated lost finalize response");
              }
              return finalized;
            },
          };
          const issueInput = { operationId: randomUUID(), requestBytes };
          const first = await issueCloudflareOperatorFreshness(issueInput, {
            ...harness.dependencies,
            coordinator,
            signer,
          });
          assert.equal(first.status, "ISSUED");
          assert.equal(first.responseLength, first.responseBytes.byteLength);
          assert.equal(first.responseSha256, digest(first.responseBytes));
          assert.equal(signerCalls, 1);

          const exact = await issueCloudflareOperatorFreshness(issueInput, {
            ...harness.dependencies,
            signer,
          });
          assert.equal(exact.status, "ALREADY_FINALIZED");
          assert.ok(equalBytes(exact.responseBytes, first.responseBytes));
          assert.equal(signerCalls, 1);

          const verified = await verifyCloudflareOperatorFreshnessResponse({
            raw: first.responseBytes,
            bootstrapSigner: seeded.fixture.rootSigner,
            manifestUrl: vector.manifest_url,
            requestBytes,
            nowMs: Date.now(),
            expectedState: (
              await harness.stateReader.readCurrentState()
            ).state,
          });
          await new Promise((resolvePromise) =>
            setTimeout(
              resolvePromise,
              Math.max(0, verified.expiresAtMs - Date.now() + 25),
            )
          );
          const expired = await issueCloudflareOperatorFreshness(issueInput, {
            ...harness.dependencies,
            signer,
          });
          assert.equal(expired.status, "REJECTED");
          assert.match(expired.reason, /expired/u);
          assert.equal(signerCalls, 1);
        },
      );

      it(
        "atomically admits one concurrent issue and finalizes exact verified bytes",
        { timeout: 30_000 },
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "concurrent-issue",
          );
          const operationId = randomUUID();
          const heldSigner = deferred();
          const signerStarted = deferred();
          const signer = makeTestSigner({
            onIssue: async () => {
              signerStarted.resolve();
              return heldSigner.promise;
            },
          });
          const harness = makeCoreHarness(context, coordinator, {
            operationId,
            signer,
          });

          const firstIssue = issueRuntimeConfigFreshness(
            harness.input,
            harness.dependencies,
          );
          await withTimeout(
            signerStarted.promise,
            RPC_TIMEOUT_MS,
            "first signer start",
          );
          const secondIssue = await withTimeout(
            issueRuntimeConfigFreshness(
              harness.input,
              harness.dependencies,
            ),
            RPC_TIMEOUT_MS,
            "concurrent issue lookup",
          );
          assert.equal(secondIssue.status, "IN_PROGRESS");
          assert.equal(signer.calls, 1);
          const pending = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect concurrent issue",
          );
          assert.equal(pending?.status, "IN_PROGRESS");
          assert.equal(pending?.blocker, "RETAINED");

          heldSigner.resolve(await signer.completedResult(signer.lastRequest));
          const result = await withTimeout(
            firstIssue,
            RPC_TIMEOUT_MS,
            "first issue completion",
          );
          assert.equal(result.status, "ISSUED");
          assert.ok(equalBytes(result.responseBytes, responseBytes));
          assert.equal(result.responseSha256, digest(responseBytes));
          assert.equal(signer.calls, 1);
          await verifyFixtureResponse(result.responseBytes, context.fixture.evidence);
          await assertFinalizedBytes(stub, operationId);
        },
      );

      it(
        "reads a read-only Coordinator snapshot through RPC and preserves it across runtime recreation",
        async () => {
          const { stub, coordinator, objectId } = await seededCoordinator(
            context,
            "current-state-snapshot",
          );
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const begin = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin snapshot operation",
          );
          assert.equal(begin.status, "ACQUIRED");

          const snapshot = await rpc(
            coordinator.readCurrentStateSnapshot({
              operation: begin.operation,
              lease: begin.lease,
            }),
            "read Coordinator snapshot",
          );
          assert.equal(snapshot.operationStatus, "IN_PROGRESS");
          assert.equal(snapshot.blocker, "RETAINED");
          assert.equal(snapshot.writerPending, false);
          assert.equal(snapshot.operation.operationId, request.identity.operationId);
          assert.equal(snapshot.lease.leaseId, begin.lease.leaseId);
          assert.equal(snapshot.lease.fencingToken, begin.lease.fencingToken);
          assert.equal(snapshot.currentState.generation, context.fixture.currentState.generation);
          const operation = structuredClone(begin.operation);
          const lease = structuredClone(begin.lease);

          snapshot.currentState.generation = "999";
          snapshot.currentState.antiRollbackWitness.generation = "999";
          snapshot.lease.currentState.generation = "998";
          snapshot.witness.generation = "997";
          const persisted = await rpc(
            stub.inspectStateForLocalTest(),
            "inspect state after mutating snapshot",
          );
          assert.equal(
            persisted.currentState.generation,
            context.fixture.currentState.generation,
          );
          assert.equal(persisted.witness.generation, context.fixture.witness.generation);

          await restartRuntime(context);
          const reopened = coordinatorForName(
            context,
            "current-state-snapshot",
            objectId,
          );
          const restored = await rpc(
            reopened.coordinator.readCurrentStateSnapshot({
              operation,
              lease,
            }),
            "read Coordinator snapshot after runtime recreation",
          );
          assert.equal(
            restored.currentState.generation,
            context.fixture.currentState.generation,
          );
          await assert.rejects(
            reopened.coordinator.readCurrentStateSnapshot({
              operation,
              lease: {
                ...lease,
                fencingToken: "2",
              },
            }),
          );

          const release = await rpc(
            reopened.stub.beginReleaseForLocalTest(randomUUID()),
            "start local writer-pending state",
          );
          assert.equal(release.status, "WAITING_FOR_ISSUES");
          await assert.rejects(
            reopened.coordinator.readCurrentStateSnapshot({
              operation,
              lease,
            }),
          );

          const uninitialized = coordinatorForName(
            context,
            "current-state-snapshot-uninitialized",
          );
          await assert.rejects(
            async () =>
              await uninitialized.coordinator.readCurrentStateSnapshot({
                operation,
                lease,
              }),
          );
        },
      );

      it(
        "issues through the independently verified Release reader and replays exact bytes after runtime recreation",
        { timeout: 30_000 },
        async () => {
          const fixture = context.signedReleaseFixture;
          const diagnostic = await seededCoordinator(
            context,
            "verified-current-release-reader-direct",
            fixture,
          );
          const diagnosticRequest = await makeRequestIdentity(randomUUID());
          const diagnosticBegin = await rpc(
            diagnostic.coordinator.beginOrGet({
              ...diagnosticRequest.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin direct current-state reader verification",
          );
          assert.equal(diagnosticBegin.status, "ACQUIRED");
          const diagnosticReader = makeSignedCurrentStateReader(
            fixture,
            diagnostic.coordinator,
          );
          const diagnosticInput = {
            operation: diagnosticBegin.operation,
            challenge: diagnosticRequest.challenge,
            lease: diagnosticBegin.lease,
            clock: await diagnostic.coordinator.readClock(),
          };
          const diagnosticEvidence = await diagnosticReader.readCurrentState(
            diagnosticInput,
          );
          const diagnosticVerified = await diagnosticReader.verifyCurrentState(
            diagnosticEvidence,
            diagnosticInput,
          );
          assert.equal(
            diagnosticVerified.releaseCommitRecordSha256,
            fixture.currentState.journalHeadSha256,
          );

          const { stub, coordinator, objectId } = await seededCoordinator(
            context,
            "verified-current-release",
            fixture,
          );
          const operationId = randomUUID();
          const currentState = makeSignedCurrentStateReader(fixture, coordinator);
          const signer = makeTestSigner({ responseBytes: fixture.responseBytes });
          const harness = makeCoreHarness(context, coordinator, {
            fixture,
            currentStateReader: currentState,
            operationId,
            signer,
          });
          const result = await rpc(
            issueRuntimeConfigFreshness(harness.input, harness.dependencies),
            "issue from independently verified current Release",
          );
          assert.equal(result.status, "ISSUED", JSON.stringify(result));
          assert.ok(equalBytes(result.responseBytes, fixture.responseBytes));
          assert.equal(result.responseSha256, digest(fixture.responseBytes));
          assert.equal(signer.calls, 1);
          await verifySignedFixtureResponse(fixture, result.responseBytes);
          await assertFinalizedBytes(stub, operationId, fixture.responseBytes);

          await restartRuntime(context);
          const reopened = coordinatorForName(
            context,
            "verified-current-release",
            objectId,
          );
          const replaySigner = makeTestSigner({
            responseBytes: fixture.responseBytes,
          });
          const replayHarness = makeCoreHarness(context, reopened.coordinator, {
            fixture,
            currentStateReader: makeSignedCurrentStateReader(
              fixture,
              reopened.coordinator,
            ),
            operationId,
            signer: replaySigner,
          });
          const replay = await rpc(
            issueRuntimeConfigFreshness(
              replayHarness.input,
              replayHarness.dependencies,
            ),
            "retrieve finalized current Release response after recreation",
          );
          assert.equal(replay.status, "ALREADY_FINALIZED");
          assert.ok(equalBytes(replay.responseBytes, fixture.responseBytes));
          assert.equal(replay.responseSha256, digest(fixture.responseBytes));
          assert.equal(replaySigner.calls, 0);
          await verifySignedFixtureResponse(fixture, replay.responseBytes);
        },
      );

      it(
        "rejects unauthenticated or mismatched current Release evidence before signing",
        { timeout: 45_000 },
        async () => {
          const cases = [
            {
              name: "Release Record bytes",
              mutate: (fixture) => {
                fixture.source.journalEvidence.recordBytes[0] ^= 1;
              },
            },
            {
              name: "Release delegation bytes",
              mutate: (fixture) => {
                fixture.source.journalEvidence.releaseDelegationBytes[0] ^= 1;
              },
            },
            {
              name: "Journal authenticated append time",
              mutate: (fixture) => {
                fixture.source.journalEvidence.appendedAt =
                  "2026-11-08T11:00:00.000Z";
              },
            },
            {
              name: "Journal append receipt",
              mutate: (fixture) => {
                fixture.source.journalEvidence.appendReceiptBytes[0] ^= 1;
              },
            },
            {
              name: "Journal current-head proof",
              mutate: (fixture) => {
                fixture.source.corruptCurrentHeadProof = true;
              },
            },
            {
              name: "Journal read outside the issue lease",
              mutate: (fixture) => {
                fixture.source.journalObservedAtOffsetMs = 8_001;
              },
            },
            {
              name: "Journal append-time uncertainty crosses delegation",
              mutate: (fixture) => {
                fixture.source.journalAppendTimeUncertaintyMs =
                  Number.MAX_SAFE_INTEGER;
              },
            },
            {
              name: "wrong pinned Journal chain",
              overrides: {
                expectedChainId: "different-release-chain",
              },
            },
            {
              name: "wrong pinned append-time source",
              overrides: {
                expectedAppendTimeSourceId: "different-time-source",
              },
            },
            {
              name: "R2 pointer ETag",
              mutate: (fixture) => {
                fixture.source.pointerEtag = "different-r2-etag";
              },
            },
            {
              name: "immutable Manifest snapshot",
              mutate: (fixture) => {
                fixture.source.immutableReference = "missing-snapshot";
              },
            },
            {
              name: "pointer and immutable snapshot bytes",
              mutate: (fixture) => {
                fixture.source.immutableSnapshotBytes[0] ^= 1;
              },
            },
            {
              name: "Manifest signature bytes",
              mutate: (fixture) => {
                fixture.source.pointerBytes[fixture.source.pointerBytes.length - 2] ^= 1;
              },
            },
            {
              name: "rollback witness signature",
              mutate: (fixture) => {
                fixture.source.corruptRollbackWitness = true;
              },
            },
            {
              name: "witness read outside the issue lease",
              mutate: (fixture) => {
                fixture.source.witnessObservedAtOffsetMs = 8_001;
              },
            },
            {
              name: "wrong pinned witness source",
              overrides: {
                expectedSourceId: "different-witness",
              },
            },
            {
              name: "rollback witness restore epoch",
              mutate: (fixture) => {
                fixture.source.witnessEvidence.restoreEpoch =
                  `${fixture.source.witnessEvidence.restoreEpoch}-restored`;
              },
            },
            {
              name: "rollback witness generation",
              mutate: (fixture) => {
                fixture.source.witnessEvidence.generation = "2";
              },
            },
            {
              name: "missing current-state provider",
              overrides: {
                readCurrentHead: async () => {
                  throw new Error("test-only Journal provider unavailable");
                },
              },
            },
          ];

          for (const [index, testCase] of cases.entries()) {
            const fixture = await makeSignedCurrentStateFixture();
            testCase.mutate?.(fixture);
            const operationId = randomUUID();
            const scenario = `reader-invalid-${index}`;
            const { stub, coordinator } = await seededCoordinator(
              context,
              scenario,
              fixture,
            );
            const signer = makeTestSigner({ responseBytes: fixture.responseBytes });
            const harness = makeCoreHarness(context, coordinator, {
              fixture,
              currentStateReader: makeSignedCurrentStateReader(
                fixture,
                coordinator,
                testCase.overrides,
              ),
              operationId,
              signer,
            });
            const result = await rpc(
              issueRuntimeConfigFreshness(
                harness.input,
                harness.dependencies,
              ),
              `reject invalid ${testCase.name}`,
            );
            assert.equal(result.status, "REJECTED", testCase.name);
            assert.equal(signer.calls, 0, testCase.name);
            const operation = await rpc(
              stub.inspectOperationForLocalTest(operationId),
              `inspect rejected ${testCase.name}`,
            );
            assert.equal(operation?.status, "REJECTED", testCase.name);
            assert.equal(operation?.blocker, "CLEARED", testCase.name);
          }

          const fixture = await makeSignedCurrentStateFixture();
          const operationId = randomUUID();
          const { coordinator } = await seededCoordinator(
            context,
            "reader-self-asserted-journal",
            fixture,
          );
          const signer = makeTestSigner({ responseBytes: fixture.responseBytes });
          const harness = makeCoreHarness(context, coordinator, {
            fixture,
            currentStateReader: makeSignedCurrentStateReader(
              fixture,
              coordinator,
              {
                journalVerifier: {
                  async verifyCurrentHead() {
                    return { currentHeadVerified: true };
                  },
                },
              },
            ),
            operationId,
            signer,
          });
          const result = await rpc(
            issueRuntimeConfigFreshness(harness.input, harness.dependencies),
            "reject self-asserted Journal verification",
          );
          assert.equal(result.status, "REJECTED");
          assert.equal(signer.calls, 0);
        },
      );

      it(
        "rejects replayed Journal and witness proofs after signing",
        { timeout: 45_000 },
        async () => {
          for (const source of ["journal", "witness"]) {
            const fixture = await makeSignedCurrentStateFixture();
            const operationId = randomUUID();
            const { stub, coordinator } = await seededCoordinator(
              context,
              `reader-replayed-${source}-proof`,
              fixture,
            );
            let firstEvidence;
            const overrides =
              source === "journal"
                ? {
                    readCurrentHead: async (readContext) => {
                      firstEvidence ??=
                        await fixture.journal.readCurrentHead(readContext);
                      return firstEvidence;
                    },
                  }
                : {
                    readCurrentWitness: async (readContext) => {
                      firstEvidence ??=
                        await fixture.antiRollbackWitness.readCurrentWitness(
                          readContext,
                        );
                      return firstEvidence;
                    },
                  };
            const signer = makeTestSigner({
              responseBytes: fixture.responseBytes,
            });
            const harness = makeCoreHarness(context, coordinator, {
              fixture,
              currentStateReader: makeSignedCurrentStateReader(
                fixture,
                coordinator,
                overrides,
              ),
              operationId,
              signer,
            });
            const result = await rpc(
              issueRuntimeConfigFreshness(
                harness.input,
                harness.dependencies,
              ),
              `reject replayed ${source} proof`,
            );
            assert.equal(result.status, "REJECTED", source);
            assert.equal(signer.calls, 1, source);
            assert.equal("responseBytes" in result, false, source);
            const stored = await rpc(
              stub.inspectOperationForLocalTest(operationId),
              `inspect replayed ${source} proof`,
            );
            assert.equal(stored?.status, "REJECTED", source);
            assert.equal(stored?.responseBytes, null, source);
          }
        },
      );

      it(
        "re-reads current Release after signing and does not return a response when it changes",
        { timeout: 30_000 },
        async () => {
          const fixture = await makeSignedCurrentStateFixture();
          const operationId = randomUUID();
          const { stub, coordinator } = await seededCoordinator(
            context,
            "reader-current-release-changes",
            fixture,
          );
          let signer;
          signer = makeTestSigner({
            responseBytes: fixture.responseBytes,
            onIssue: async (request) => {
              fixture.source.pointerEtag = "changed-after-signing";
              return signer.completedResult(request);
            },
          });
          const harness = makeCoreHarness(context, coordinator, {
            fixture,
            currentStateReader: makeSignedCurrentStateReader(
              fixture,
              coordinator,
            ),
            operationId,
            signer,
          });
          const result = await rpc(
            issueRuntimeConfigFreshness(harness.input, harness.dependencies),
            "reject changed current Release after signing",
          );
          assert.equal(result.status, "REJECTED", JSON.stringify(result));
          assert.equal(signer.calls, 1, JSON.stringify(result));
          assert.equal("responseBytes" in result, false);
          const stored = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect post-sign current Release mismatch",
          );
          assert.equal(stored?.status, "REJECTED");
          assert.equal(stored?.blocker, "CLEARED");
          assert.equal(stored?.signerResultSha256, digest(fixture.responseBytes));
        },
      );

      it(
        "rejects a different canonical request under the same operation ID without overwriting it",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "request-conflict",
          );
          const operationId = randomUUID();
          const original = await makeRequestIdentity(operationId, requestBytes);
          const acquired = await rpc(
            coordinator.beginOrGet({
              ...original.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin original operation",
          );
          assert.equal(acquired.status, "ACQUIRED");

          const changed = await makeRequestIdentity(
            operationId,
            makeDifferentRequestBytes(),
          );
          const conflict = await rpc(
            coordinator.beginOrGet({
              ...changed.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin conflicting operation",
          );
          assert.equal(conflict.status, "CONFLICT");
          const lookup = await rpc(
            coordinator.getOperation(changed.identity),
            "lookup conflicting operation",
          );
          assert.equal(lookup.status, "CONFLICT");

          const stored = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect original operation after conflict",
          );
          assert.equal(stored?.status, "IN_PROGRESS");
          assert.equal(stored?.blocker, "RETAINED");
          assert.equal(stored?.operation.requestSha256, original.identity.requestSha256);
          assert.equal(stored?.operation.requestNonce, original.identity.requestNonce);
        },
      );

      it(
        "preserves an IN_PROGRESS blocker across runtime recreation without re-signing",
        async () => {
          const objectName = "restart-in-progress";
          const operationId = randomUUID();
          const { stub, coordinator, objectId } = await seededCoordinator(
            context,
            objectName,
          );
          const request = await makeRequestIdentity(operationId, requestBytes);
          const begin = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin restart-pending operation",
          );
          assert.equal(begin.status, "ACQUIRED");
          await restartRuntime(context);
          const reopened = coordinatorForName(context, objectName, objectId);
          const signer = makeTestSigner();
          const harness = makeCoreHarness(context, reopened.coordinator, {
            operationId,
            signer,
          });
          const replay = await rpc(
            issueRuntimeConfigFreshness(
              harness.input,
              harness.dependencies,
            ),
            "issue after IN_PROGRESS restart",
          );
          assert.equal(replay.status, "IN_PROGRESS");
          assert.equal(signer.calls, 0);
          const persisted = await rpc(
            reopened.stub.inspectOperationForLocalTest(operationId),
            "inspect restarted IN_PROGRESS operation",
          );
          assert.equal(persisted?.status, "IN_PROGRESS");
          assert.equal(persisted?.blocker, "RETAINED");
        },
      );

      it(
        "preserves RESULT_UNKNOWN and its blocker across runtime recreation",
        async () => {
          const objectName = "restart-result-unknown";
          const operationId = randomUUID();
          const { stub, coordinator, objectId } = await seededCoordinator(
            context,
            objectName,
          );
          const failedSigner = makeTestSigner({
            onIssue: async () => {
              throw new Error("test-only lost signer result");
            },
          });
          const first = makeCoreHarness(context, coordinator, {
            operationId,
            signer: failedSigner,
          });
          const result = await rpc(
            issueRuntimeConfigFreshness(first.input, first.dependencies),
            "issue with unknown signer result",
          );
          const beforeRestart = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect unknown result",
          );
          assert.equal(
            result.status,
            "RESULT_UNKNOWN",
            JSON.stringify({ result, beforeRestart }),
          );
          assert.equal(failedSigner.calls, 1);
          assert.equal(beforeRestart?.status, "RESULT_UNKNOWN");
          assert.equal(beforeRestart?.blocker, "RETAINED");

          await restartRuntime(context);
          const reopened = coordinatorForName(context, objectName, objectId);
          const replaySigner = makeTestSigner();
          const replay = makeCoreHarness(context, reopened.coordinator, {
            operationId,
            signer: replaySigner,
          });
          const replayResult = await rpc(
            issueRuntimeConfigFreshness(replay.input, replay.dependencies),
            "replay unknown result after restart",
          );
          assert.equal(replayResult.status, "RESULT_UNKNOWN");
          assert.equal(replaySigner.calls, 0);
          const afterRestart = await rpc(
            reopened.stub.inspectOperationForLocalTest(operationId),
            "inspect restarted unknown result",
          );
          assert.equal(afterRestart?.status, "RESULT_UNKNOWN");
          assert.equal(afterRestart?.blocker, "RETAINED");
        },
      );

      it(
        "returns the persisted FINALIZED exact bytes after runtime recreation without re-signing",
        async () => {
          const objectName = "restart-finalized";
          const operationId = randomUUID();
          const { stub, coordinator, objectId } = await seededCoordinator(
            context,
            objectName,
          );
          const signer = makeTestSigner();
          const first = makeCoreHarness(context, coordinator, {
            operationId,
            signer,
          });
          const issued = await rpc(
            issueRuntimeConfigFreshness(first.input, first.dependencies),
            "issue before finalized restart",
          );
          assert.equal(issued.status, "ISSUED");
          await assertFinalizedBytes(stub, operationId);
          await restartRuntime(context);
          const reopened = coordinatorForName(context, objectName, objectId);
          const persisted = await rpc(
            reopened.coordinator.getOperation(
              (await makeRequestIdentity(operationId, requestBytes)).identity,
            ),
            "read finalized bytes after restart",
          );
          assert.equal(persisted.status, "FINALIZED");
          assert.ok(equalBytes(persisted.responseBytes, responseBytes));
          assert.equal(persisted.responseSha256, digest(responseBytes));
          const replaySigner = makeTestSigner();
          const replay = makeCoreHarness(context, reopened.coordinator, {
            operationId,
            signer: replaySigner,
          });
          const replayResult = await rpc(
            issueRuntimeConfigFreshness(replay.input, replay.dependencies),
            "replay finalized response after restart",
          );
          assert.equal(replayResult.status, "ALREADY_FINALIZED");
          assert.ok(equalBytes(replayResult.responseBytes, responseBytes));
          assert.equal(replaySigner.calls, 0);
          await verifyFixtureResponse(
            replayResult.responseBytes,
            context.fixture.evidence,
          );
        },
      );

      it(
        "recovers a committed finalization whose RPC response was lost",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "lost-finalization-response",
          );
          const signer = makeTestSigner();
          let finalizeCalls = 0;
          const faultedCoordinator = coordinatorWithOverrides(coordinator, {
            finalizeIfCurrent: async (input) => {
              finalizeCalls += 1;
              await coordinator.finalizeIfCurrent(input);
              throw new Error("test-only lost DO RPC response after commit");
            },
          });
          const harness = makeCoreHarness(context, faultedCoordinator, {
            operationId: randomUUID(),
            signer,
          });
          const result = await rpc(
            issueRuntimeConfigFreshness(harness.input, harness.dependencies),
            "recover lost finalization response",
          );
          assert.equal(result.status, "ALREADY_FINALIZED");
          assert.ok(equalBytes(result.responseBytes, responseBytes));
          assert.equal(finalizeCalls, 1);
          assert.equal(signer.calls, 1);
          await verifyFixtureResponse(result.responseBytes, context.fixture.evidence);
          await assertFinalizedBytes(stub, harness.input.operationId);
        },
      );

      it(
        "fails closed when finalization and its durable lookup are both unavailable",
        async () => {
          const objectName = "unknown-finalization-outcome";
          const operationId = randomUUID();
          const { stub, coordinator, objectId } = await seededCoordinator(
            context,
            objectName,
          );
          const signer = makeTestSigner();
          let loseLookup = true;
          const faultedCoordinator = coordinatorWithOverrides(coordinator, {
            finalizeIfCurrent: async () => {
              throw new Error("test-only finalization persistence outcome unknown");
            },
            getOperation: async () => {
              if (loseLookup) {
                loseLookup = false;
                throw new Error("test-only durable lookup unavailable");
              }
              return coordinator.getOperation(
                (await makeRequestIdentity(operationId, requestBytes)).identity,
              );
            },
          });
          const harness = makeCoreHarness(context, faultedCoordinator, {
            operationId,
            signer,
          });
          await assert.rejects(
            issueRuntimeConfigFreshness(harness.input, harness.dependencies),
            (error) => error?.code === "FINALIZATION_OUTCOME_UNKNOWN",
          );
          assert.equal(signer.calls, 1);
          const beforeRestart = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect unknown finalization state",
          );
          assert.equal(beforeRestart?.status, "IN_PROGRESS");
          assert.equal(beforeRestart?.blocker, "RETAINED");
          assert.equal(beforeRestart?.responseBytes, null);

          await restartRuntime(context);
          const reopened = coordinatorForName(context, objectName, objectId);
          const durable = await rpc(
            reopened.coordinator.getOperation(
              (await makeRequestIdentity(operationId, requestBytes)).identity,
            ),
            "lookup after unknown finalization restart",
          );
          assert.equal(durable.status, "IN_PROGRESS");
          const replaySigner = makeTestSigner();
          const replay = makeCoreHarness(context, reopened.coordinator, {
            operationId,
            signer: replaySigner,
          });
          const replayResult = await rpc(
            issueRuntimeConfigFreshness(replay.input, replay.dependencies),
            "replay unresolved finalization",
          );
          assert.equal(replayResult.status, "IN_PROGRESS");
          assert.equal(replaySigner.calls, 0);
          const afterRestart = await rpc(
            reopened.stub.inspectOperationForLocalTest(operationId),
            "inspect unresolved finalization after restart",
          );
          assert.equal(afterRestart?.blocker, "RETAINED");
        },
      );

      it(
        "does not release an issue blocker when its caller aborts",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "caller-abort",
          );
          const operationId = randomUUID();
          const heldSigner = deferred();
          const signerStarted = deferred();
          let signerContext;
          const signer = makeTestSigner({
            onIssue: async (_request, callContext) => {
              signerContext = callContext;
              signerStarted.resolve();
              return heldSigner.promise;
            },
          });
          const controller = new AbortController();
          const harness = makeCoreHarness(context, coordinator, {
            operationId,
            signer,
            signal: controller.signal,
          });
          const issue = issueRuntimeConfigFreshness(
            harness.input,
            harness.dependencies,
          );
          await withTimeout(
            signerStarted.promise,
            RPC_TIMEOUT_MS,
            "abort test signer start",
          );
          controller.abort();
          await new Promise((resolvePromise) => setImmediate(resolvePromise));
          assert.equal(signerContext.signal, controller.signal);
          assert.equal(controller.signal.aborted, true);
          const pending = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect operation after caller abort",
          );
          assert.equal(pending?.status, "IN_PROGRESS");
          assert.equal(pending?.blocker, "RETAINED");
          heldSigner.resolve(await signer.completedResult(signer.lastRequest));
          const result = await rpc(issue, "finish signer after caller abort");
          assert.equal(result.status, "ISSUED");
          await assertFinalizedBytes(stub, operationId);
        },
      );

      it(
        "keeps an expired lease blocked until the delayed signer result is terminally rejected",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "expired-lease",
          );
          const operationId = randomUUID();
          const heldSigner = deferred();
          const signerStarted = deferred();
          const signer = makeTestSigner({
            onIssue: async () => {
              signerStarted.resolve();
              return heldSigner.promise;
            },
          });
          const harness = makeCoreHarness(context, coordinator, {
            operationId,
            signer,
          });
          const issue = issueRuntimeConfigFreshness(
            harness.input,
            harness.dependencies,
          );
          await withTimeout(
            signerStarted.promise,
            RPC_TIMEOUT_MS,
            "expired lease signer start",
          );
          const lease = signer.lastRequest.lease;
          await rpc(
            stub.setClockForLocalTest({
              clockId,
              clockEpoch,
              nowMs: lease.expiresAtMs + 1,
              uncertaintyMs: 0,
            }),
            "advance local test clock past lease",
          );
          const leaseCheck = await rpc(
            coordinator.checkLease(lease),
            "check expired lease",
          );
          assert.equal(leaseCheck.status, "EXPIRED");
          const stillBlocked = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect expired but unsettled issue",
          );
          assert.equal(stillBlocked?.status, "IN_PROGRESS");
          assert.equal(stillBlocked?.blocker, "RETAINED");

          heldSigner.resolve(await signer.completedResult(signer.lastRequest));
          const result = await rpc(issue, "reject delayed expired signer result");
          assert.equal(result.status, "REJECTED");
          assert.equal(result.reason, "LEASE_NOT_ACTIVE");
          const terminal = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect terminal expired issue",
          );
          assert.equal(terminal?.status, "REJECTED");
          assert.equal(terminal?.blocker, "CLEARED");
          assert.equal(terminal?.responseBytes, null);
        },
      );

      it(
        "rejects delayed signing after current-state generation binding changes",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "changed-current-state",
          );
          const operationId = randomUUID();
          const heldSigner = deferred();
          const signerStarted = deferred();
          const signer = makeTestSigner({
            onIssue: async () => {
              signerStarted.resolve();
              return heldSigner.promise;
            },
          });
          const harness = makeCoreHarness(context, coordinator, {
            operationId,
            signer,
          });
          const issue = issueRuntimeConfigFreshness(
            harness.input,
            harness.dependencies,
          );
          await withTimeout(
            signerStarted.promise,
            RPC_TIMEOUT_MS,
            "state-change signer start",
          );
          const changedState = {
            ...context.fixture.currentState,
            stateSha256: changeBase64UrlDigest(
              context.fixture.currentState.stateSha256,
            ),
          };
          await rpc(
            stub.restoreCoordinationStateForLocalTest(changedState),
            "change local current-state binding",
          );
          const blocked = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect issue after state change",
          );
          assert.equal(blocked?.status, "IN_PROGRESS");
          assert.equal(blocked?.blocker, "RETAINED");

          heldSigner.resolve(await signer.completedResult(signer.lastRequest));
          const result = await rpc(issue, "reject delayed old-state signature");
          assert.equal(result.status, "REJECTED");
          assert.notEqual(result.status, "ISSUED");
          const terminal = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect rejected old-state signature",
          );
          assert.equal(terminal?.status, "REJECTED");
          assert.equal(terminal?.blocker, "CLEARED");
        },
      );

      it(
        "serializes Release writer-pending against active and new issue operations",
        { timeout: 30_000 },
        async () => {
          const objectName = "release-issue-race";
          const { stub, coordinator } = await seededCoordinator(
            context,
            objectName,
          );
          const operationId = randomUUID();
          const heldSigner = deferred();
          const signerStarted = deferred();
          const signer = makeTestSigner({
            onIssue: async () => {
              signerStarted.resolve();
              return heldSigner.promise;
            },
          });
          const original = makeCoreHarness(context, coordinator, {
            operationId,
            signer,
          });
          const issue = issueRuntimeConfigFreshness(
            original.input,
            original.dependencies,
          );
          await withTimeout(
            signerStarted.promise,
            RPC_TIMEOUT_MS,
            "Release-race signer start",
          );

          const writerOperationId = randomUUID();
          const releaseStart = await rpc(
            stub.beginReleaseForLocalTest(writerOperationId),
            "begin local Release writer",
          );
          assert.equal(releaseStart.status, "WAITING_FOR_ISSUES");
          const waitingRelease = await rpc(
            stub.completeReleaseForLocalTest(
              writerOperationId,
              context.fixture.currentState,
              context.fixture.witness,
            ),
            "attempt Release update with active issue",
          );
          assert.equal(waitingRelease, "WAITING_FOR_ISSUES");
          const oldState = await rpc(
            stub.inspectStateForLocalTest(),
            "inspect head during Release wait",
          );
          assert.equal(
            oldState.currentState.generation,
            context.fixture.currentState.generation,
          );
          assert.equal(oldState.writerPending, true);

          const rejectedSigner = makeTestSigner();
          const blockedOperation = makeCoreHarness(
            context,
            coordinatorForName(context, objectName).coordinator,
            { signer: rejectedSigner },
          );
          const blocked = await rpc(
            issueRuntimeConfigFreshness(
              blockedOperation.input,
              blockedOperation.dependencies,
            ),
            "begin issue after Release writer-pending",
          );
          assert.equal(blocked.status, "REJECTED");
          assert.equal(blocked.reason, "CURRENT_STATE_UNAVAILABLE");
          assert.equal(rejectedSigner.calls, 0);

          heldSigner.resolve(await signer.completedResult(signer.lastRequest));
          const oldIssueResult = await rpc(issue, "finish fenced old issue");
          assert.equal(oldIssueResult.status, "REJECTED");
          assert.equal(signer.calls, 1);
          const oldIssueState = await rpc(
            stub.inspectOperationForLocalTest(operationId),
            "inspect fenced issue",
          );
          assert.equal(oldIssueState?.status, "REJECTED");
          assert.equal(oldIssueState?.blocker, "CLEARED");

          const nextGeneration = (
            BigInt(context.fixture.currentState.generation) + 1n
          ).toString();
          const nextWitness = {
            ...context.fixture.witness,
            generation: nextGeneration,
          };
          const nextState = {
            ...context.fixture.currentState,
            generation: nextGeneration,
            pointerGeneration: nextGeneration,
            antiRollbackWitness: nextWitness,
            stateSha256: changeBase64UrlDigest(
              context.fixture.currentState.stateSha256,
            ),
          };
          const committed = await rpc(
            stub.completeReleaseForLocalTest(
              writerOperationId,
              nextState,
              nextWitness,
            ),
            "complete local Release after issue is terminal",
          );
          assert.equal(committed, "COMMITTED");
          const newHead = await rpc(
            stub.inspectStateForLocalTest(),
            "inspect local Release head",
          );
          assert.equal(newHead.currentState.generation, nextGeneration);
          assert.equal(newHead.writerPending, false);
        },
      );

      it(
        "rejects an old clock epoch and fencing token after coordination state changes",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "old-clock-epoch",
          );
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const begin = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin before clock epoch change",
          );
          assert.equal(begin.status, "ACQUIRED");
          await rpc(
            stub.setClockForLocalTest({
              clockId: `${clockId}-restored`,
              clockEpoch: `${clockEpoch}-restored`,
              nowMs: vector.now_ms + 1,
              uncertaintyMs: 0,
            }),
            "advance clock restore epoch",
          );
          const check = await rpc(
            coordinator.checkLease(begin.lease),
            "check old lease after clock epoch change",
          );
          assert.equal(check.status, "FENCED");
          const stored = await rpc(
            stub.inspectOperationForLocalTest(request.identity.operationId),
            "inspect old-epoch issue",
          );
          assert.equal(stored?.status, "IN_PROGRESS");
          assert.equal(stored?.blocker, "RETAINED");
          const state = await rpc(
            stub.inspectStateForLocalTest(),
            "inspect incremented write fence",
          );
          assert.notEqual(state.writeFencingToken, begin.lease.fencingToken);
        },
      );

      it(
        "rejects malformed lease mutations and response digest mismatch without changing terminal state",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "invalid-transition",
          );
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const begin = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin invalid-transition operation",
          );
          assert.equal(begin.status, "ACQUIRED");

          const wrongLeaseMutation = await rpc(
            stub.attemptRejectBeforeSignerForLocalTest({
              operation: begin.operation,
              lease: {
                ...begin.lease,
                fencingToken: (BigInt(begin.lease.fencingToken) + 1n).toString(),
              },
              reason: "LEASE_NOT_ACTIVE",
            }),
            "try rejection with a different lease fence",
          );
          assert.equal(wrongLeaseMutation.status, "THREW");
          assert.match(wrongLeaseMutation.errorMessage, /lease|fence/i);
          const rejected = await rpc(
            coordinator.finalizeIfCurrent({
              operation: begin.operation,
              lease: begin.lease,
              responseBytes: Uint8Array.from(responseBytes),
              responseSha256: digest(Buffer.from("different response")),
              signedAtMs,
              currentState: context.fixture.currentState,
            }),
            "finalize with mismatched response digest",
          );
          assert.equal(rejected.status, "REJECTED");
          assert.equal(rejected.reason, "SIGNER_RESPONSE_INVALID");
          assert.equal(rejected.blocker, "CLEARED");
          const snapshot = await rpc(
            stub.inspectOperationForLocalTest(request.identity.operationId),
            "inspect terminal digest rejection",
          );
          assert.equal(snapshot?.status, "REJECTED");
          assert.equal(snapshot?.blocker, "CLEARED");
          assert.equal(snapshot?.responseBytes, null);
          const oldUnknownMutation = await rpc(
            stub.attemptMarkResultUnknownForLocalTest({
              operation: begin.operation,
              lease: begin.lease,
              signerOperationId: begin.operation.signerOperationId,
            }),
            "try RESULT_UNKNOWN after terminal rejection",
          );
          assert.equal(oldUnknownMutation.status, "THREW");
          assert.match(oldUnknownMutation.errorMessage, /in-progress|terminal/i);
        },
      );

      it(
        "does not let an old rejection mutate a FINALIZED operation",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "finalized-old-rejection",
          );
          const signer = makeTestSigner();
          const harness = makeCoreHarness(context, coordinator, { signer });
          const issued = await rpc(
            issueRuntimeConfigFreshness(harness.input, harness.dependencies),
            "issue before stale rejection",
          );
          assert.equal(issued.status, "ISSUED");
          const signedRequest = signer.lastRequest;
          const oldRejection = await rpc(
            stub.attemptRejectBeforeSignerForLocalTest({
              operation: signedRequest.issue,
              lease: signedRequest.lease,
              reason: "LEASE_NOT_ACTIVE",
            }),
            "try stale rejection after finalization",
          );
          assert.equal(oldRejection.status, "THREW");
          assert.match(oldRejection.errorMessage, /terminal|in-progress/i);
          const snapshot = await rpc(
            stub.inspectOperationForLocalTest(harness.input.operationId),
            "inspect finalized operation after stale rejection",
          );
          assert.equal(snapshot?.status, "FINALIZED");
          assert.equal(snapshot?.blocker, "CLEARED");
          assert.ok(equalBytes(snapshot.responseBytes, responseBytes));
        },
      );

      it(
        "rejects restored coordination state that disagrees with the current witness",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "restored-stale-state",
          );
          const oldGeneration = (
            BigInt(context.fixture.currentState.generation) - 1n
          ).toString();
          const oldWitness = {
            ...context.fixture.witness,
            generation: oldGeneration,
          };
          const restoredState = {
            ...context.fixture.currentState,
            generation: oldGeneration,
            pointerGeneration: oldGeneration,
            antiRollbackWitness: oldWitness,
          };
          await rpc(
            stub.restoreCoordinationStateForLocalTest(restoredState),
            "restore stale local coordinator state",
          );
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const result = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "begin issue against stale restored state",
          );
          assert.equal(result.status, "REJECTED");
          assert.equal(result.reason, "CURRENT_STATE_MISMATCH");
          assert.equal(result.blocker, "CLEARED");
          const snapshot = await rpc(
            stub.inspectOperationForLocalTest(request.identity.operationId),
            "inspect stale restore rejection",
          );
          assert.equal(snapshot?.status, "REJECTED");
          assert.equal(snapshot?.blocker, "CLEARED");
        },
      );

      it(
        "fails closed when the unsigned fencing counter reaches its uint64 maximum",
        async () => {
          const { stub, coordinator } = await seededCoordinator(
            context,
            "fence-exhaustion",
          );
          await rpc(
            stub.setNextFenceForLocalTest(UINT64_MAX),
            "set local fence counter to uint64 maximum",
          );
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const exhaustedBegin = await rpc(
            stub.attemptBeginOrGetForLocalTest({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "try begin with exhausted uint64 fence",
          );
          assert.equal(exhaustedBegin.status, "THREW");
          assert.match(
            exhaustedBegin.errorMessage,
            /fencing counter reached uint64 maximum/i,
          );
          assert.equal(
            await rpc(
              stub.inspectOperationForLocalTest(request.identity.operationId),
              "inspect fence-exhaustion operation",
            ),
            null,
          );
          const state = await rpc(
            stub.inspectStateForLocalTest(),
            "inspect exhausted local fence",
          );
          assert.equal(state.nextFencingToken, UINT64_MAX);
        },
      );

      it(
        "bootstraps an empty Coordinator binding only from an explicit verified initial Release checkpoint and issues through the real core",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-bootstrap",
          );
          const { coordinator, fixture, releaseOperationId, clock } = seeded;
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const beforeInstall = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "reject issue admission before initial binding install",
          );
          assert.equal(beforeInstall.status, "REJECTED");
          assert.equal(beforeInstall.reason, "CURRENT_STATE_UNAVAILABLE");

          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          assert.equal(prepared.started.status, "STARTED");
          const installed = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: prepared.proofContext,
              verifiedState: prepared.verifiedState,
            }),
            "atomically install the independently verified initial binding",
          );
          assert.equal(installed.status, "INSTALLED");
          assert.deepEqual(
            installed.operation.installedState,
            fixture.currentState,
          );

          const repeated = await rpc(
            coordinator.beginReleaseBindingInstall({
              operationId: prepared.proofContext.installOperationId,
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
            }),
            "read the permanent bootstrap operation result",
          );
          assert.equal(repeated.status, "INSTALLED");
          assert.equal(
            repeated.operation.installedState.stateSha256,
            fixture.currentState.stateSha256,
          );
          const conflictingReplay = await rpc(
            coordinator.beginReleaseBindingInstall({
              operationId: prepared.proofContext.installOperationId,
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: "different-restore-epoch",
            }),
            "reject reusing an install ID with different request binding",
          );
          assert.equal(conflictingReplay.status, "CONFLICT");

          const harness = makeCoreHarness(context, coordinator, {
            fixture,
            currentStateReader: makeSignedCurrentStateReader(
              fixture,
              coordinator,
            ),
          });
          const issued = await rpc(
            issueRuntimeConfigFreshness(
              harness.input,
              harness.dependencies,
            ),
            "issue Freshness through the verified installed binding",
          );
          assert.equal(issued.status, "ISSUED");
          await assertFinalizedBytes(
            seeded.stub,
            harness.input.operationId,
            fixture.responseBytes,
          );
        },
      );

      it(
        "advances an installed binding from AVAILABLE, finalizes an issue, and never replays an old install over a later head",
        { timeout: 40_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-advance",
          );
          const { coordinator, fixture, releaseOperationId, clock } = seeded;
          const firstInstall = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          const firstFinalized = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: firstInstall.proofContext,
              verifiedState: firstInstall.verifiedState,
            }),
            "install the initial binding before advancing",
          );
          assert.equal(firstFinalized.status, "INSTALLED");

          const intent = await startReleaseIntent(coordinator, fixture);
          const staged = await stageReleaseIntent(coordinator, intent);
          const appended = await appendReleaseIntent(coordinator, staged);
          assert.equal(appended.appended.status, "LEDGER_COMMITTED");
          const available = await finalizeReleaseIntent(coordinator, appended);
          assert.equal(available.finalized.status, "AVAILABLE");
          const issueBeforeInstall = await rpc(
            coordinator.beginOrGet({
              ...(await makeRequestIdentity(randomUUID(), requestBytes)).identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "reject issue while the AVAILABLE head has not been installed",
          );
          assert.equal(issueBeforeInstall.status, "REJECTED");
          assert.equal(issueBeforeInstall.reason, "CURRENT_STATE_MISMATCH");

          const stalePredecessor = await rpc(
            coordinator.beginReleaseBindingInstall({
              operationId: randomUUID(),
              mode: "ADVANCE",
              releaseOperationId: intent.operationId,
              expectedCurrentStateSha256: digest(
                new TextEncoder().encode("stale-current-state"),
              ),
              expectedRestoreEpoch: clockEpoch,
            }),
            "reject an advance from a stale predecessor binding",
          );
          assert.equal(stalePredecessor.status, "CONFLICT");
          const nextInstall = await prepareReleaseBindingInstall(
            context,
            coordinator,
            appended.committedFixture,
            {
              mode: "ADVANCE",
              releaseOperationId: intent.operationId,
              expectedCurrentStateSha256: fixture.currentState.stateSha256,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          assert.equal(nextInstall.started.status, "STARTED");
          const installed = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: nextInstall.proofContext,
              verifiedState: nextInstall.verifiedState,
            }),
            "advance current-state binding to the AVAILABLE Release",
          );
          assert.equal(installed.status, "INSTALLED");
          assert.equal(
            installed.operation.installedState.stateSha256,
            appended.committedFixture.currentState.stateSha256,
          );
          const nextHarness = makeCoreHarness(context, coordinator, {
            fixture: appended.committedFixture,
            currentStateReader: makeSignedCurrentStateReader(
              appended.committedFixture,
              coordinator,
            ),
          });
          const issued = await rpc(
            issueRuntimeConfigFreshness(
              nextHarness.input,
              nextHarness.dependencies,
            ),
            "issue Freshness after binding advance",
          );
          assert.equal(issued.status, "ISSUED");

          const replayedOldInstall = await rpc(
            coordinator.beginReleaseBindingInstall({
              operationId: firstInstall.proofContext.installOperationId,
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
            }),
            "query the completed older bootstrap after a later advance",
          );
          assert.equal(replayedOldInstall.status, "INSTALLED");
          const currentHead = await rpc(
            coordinator.readReleaseLedgerHead(),
            "verify old install replay did not roll back the latest head",
          );
          assert.equal(currentHead.position, "2");
          assert.equal(
            currentHead.recordSha256,
            appended.committedFixture.releaseHead.recordSha256,
          );
          assert.equal(
            (await rpc(
              coordinator.getReleaseBindingInstall(
                firstInstall.proofContext.installOperationId,
              ),
              "read the persisted original bootstrap result",
            )).installedState.stateSha256,
            fixture.currentState.stateSha256,
          );
        },
      );

      it(
        "persists a completed bootstrap after response loss and runtime recreation",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-install-response-loss",
          );
          const { coordinator, fixture, releaseOperationId, clock, objectId, objectName } =
            seeded;
          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          await assert.rejects(
            async () => {
              await rpc(
                coordinator.finalizeReleaseBindingInstall({
                  proofContext: prepared.proofContext,
                  verifiedState: prepared.verifiedState,
                }),
                "commit bootstrap before simulated response loss",
              );
              throw new Error("local test simulated lost install response");
            },
            /local test simulated lost install response/i,
          );
          await restartRuntime(context);
          const reopened = coordinatorForName(
            context,
            objectName,
            objectId,
            context.releaseNamespace,
          ).coordinator;
          const persisted = await rpc(
            reopened.getReleaseBindingInstall(
              prepared.proofContext.installOperationId,
            ),
            "query the install result after restart",
          );
          assert.equal(persisted.status, "INSTALLED");
          assert.equal(
            persisted.installedState.stateSha256,
            fixture.currentState.stateSha256,
          );
          const head = await rpc(
            reopened.readReleaseLedgerHead(),
            "confirm Release head remains installed after restart",
          );
          assert.equal(head.position, "1");
          assert.equal(head.recordSha256, fixture.releaseHead.recordSha256);
        },
      );

      it(
        "rejects a ledger-committed Release until exact R2 readback makes it AVAILABLE",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-not-available",
          );
          const { coordinator, fixture, releaseOperationId, clock } = seeded;
          const bootstrap = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          const installed = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: bootstrap.proofContext,
              verifiedState: bootstrap.verifiedState,
            }),
            "bootstrap before testing a pending Release",
          );
          assert.equal(installed.status, "INSTALLED");

          const intent = await startReleaseIntent(coordinator, fixture);
          const staged = await stageReleaseIntent(coordinator, intent);
          const appended = await appendReleaseIntent(coordinator, staged);
          assert.equal(appended.appended.status, "LEDGER_COMMITTED");
          const installOperationId = randomUUID();
          const rejected = await rpc(
            coordinator.beginReleaseBindingInstall({
              operationId: installOperationId,
              mode: "ADVANCE",
              releaseOperationId: intent.operationId,
              expectedCurrentStateSha256: fixture.currentState.stateSha256,
              expectedRestoreEpoch: clockEpoch,
            }),
            "reject install while Release R2 readback remains unconfirmed",
          );
          assert.equal(rejected.status, "CONFLICT");
          assert.equal(
            await rpc(
              coordinator.getReleaseBindingInstall(installOperationId),
              "confirm rejected pending Release created no install",
            ),
            null,
          );
          const issue = await rpc(
            coordinator.beginOrGet({
              ...(await makeRequestIdentity(randomUUID(), requestBytes)).identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "keep issue admission closed before R2 readback",
          );
          assert.equal(issue.status, "REJECTED");
          assert.equal(issue.reason, "CURRENT_STATE_UNAVAILABLE");
        },
      );

      it(
        "blocks issue admission and competing Release writers while independent verification is in flight",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-install-gate",
          );
          const { coordinator, fixture, releaseOperationId, clock } = seeded;
          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          assert.equal(prepared.started.status, "STARTED");
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const blockedIssue = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "reject issue admission during initial binding install",
          );
          assert.equal(blockedIssue.status, "REJECTED");
          const pending = await rpc(
            coordinator.getReleaseBindingInstall(
              prepared.proofContext.installOperationId,
            ),
            "confirm install attempt remains a durable blocker",
          );
          assert.equal(pending.status, "VERIFYING");

          const installed = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: prepared.proofContext,
              verifiedState: prepared.verifiedState,
            }),
            "finish the blocked initial binding install",
          );
          assert.equal(installed.status, "INSTALLED");
          const issueAfter = await rpc(
            coordinator.beginOrGet({
              ...(await makeRequestIdentity(randomUUID(), requestBytes)).identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "admit issue only after binding install finalization",
          );
          assert.equal(issueAfter.status, "ACQUIRED");
          await rpc(
            coordinator.rejectBeforeSigner({
              operation: issueAfter.operation,
              lease: issueAfter.lease,
              reason: "CURRENT_STATE_UNAVAILABLE",
            }),
            "clear the test-only issue admission blocker",
          );
        },
      );

      for (const proofFailure of [
        "MISSING_JOURNAL_PROOF",
        "INVALID_WITNESS",
        "MISSING_WITNESS",
        "WRONG_CHAIN",
        "WRONG_RESTORE_EPOCH",
      ]) {
        it(
          `keeps initial binding uninstalled when independent proof is ${proofFailure.toLowerCase()}`,
          { timeout: 30_000 },
          async () => {
            const seeded = await seededInitialReleaseCoordinator(
              context,
              `current-state-proof-${proofFailure.toLowerCase()}`,
            );
            const { coordinator, fixture, releaseOperationId, clock } = seeded;
            const options = {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch:
                proofFailure === "WRONG_RESTORE_EPOCH"
                  ? "different-restore-epoch"
                  : clockEpoch,
              clock,
            };
            const installOperationId = randomUUID();
            const started = await rpc(
              coordinator.beginReleaseBindingInstall({
                operationId: installOperationId,
                mode: options.mode,
                releaseOperationId,
                expectedCurrentStateSha256: null,
                expectedRestoreEpoch: options.expectedRestoreEpoch,
              }),
              "begin a proof-failure install attempt",
            );
            if (proofFailure === "WRONG_RESTORE_EPOCH") {
              assert.equal(started.status, "CONFLICT");
              assert.equal(
                await rpc(
                  coordinator.getReleaseBindingInstall(installOperationId),
                  "confirm wrong-epoch request was not persisted",
                ),
                null,
              );
              const issue = await rpc(
                coordinator.beginOrGet({
                  ...(await makeRequestIdentity(randomUUID(), requestBytes)).identity,
                  maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
                }),
                "reject issue admission without a bootstrapped binding",
              );
              assert.equal(issue.status, "REJECTED");
              return;
            }
            assert.equal(started.status, "STARTED");
            const operation = started.operation;
            const proofContext = await createFreshnessCurrentStateInstallProofContext({
              mode: options.mode,
              environment: "production",
              chainId:
                proofFailure === "WRONG_CHAIN"
                  ? "different-chain"
                  : fixture.releaseHead.chainId,
              installOperationId: operation.operationId,
              installFencingToken: operation.installFencingToken,
              releaseOperationId,
              releaseFencingToken: operation.releaseFencingToken,
              targetPosition: operation.targetPosition,
              targetGeneration: operation.targetGeneration,
              targetRecordSha256: operation.targetRecordSha256,
              expectedRestoreEpoch: options.expectedRestoreEpoch,
              expectedCurrentStateSha256: null,
              clock,
            });
            if (proofFailure === "MISSING_JOURNAL_PROOF") {
              fixture.source.corruptCurrentHeadProof = true;
            }
            if (proofFailure === "INVALID_WITNESS") {
              fixture.source.corruptRollbackWitness = true;
            }
            const readerOverrides = proofFailure === "MISSING_WITNESS"
              ? { readCurrentWitness: async () => null }
              : undefined;
            const reader = makeSignedReleaseStateReader(
              fixture,
              await runtimeR2ManifestReader(context),
              readerOverrides,
            );
            await assert.rejects(async () => {
              const evidence = await reader.readReleaseState(proofContext);
              await reader.verifyReleaseState(evidence, proofContext);
            });
            const pending = await rpc(
              coordinator.getReleaseBindingInstall(operation.operationId),
              "confirm failed verification retains the install blocker",
            );
            assert.equal(pending.status, "VERIFYING");
            assert.equal(pending.installedState, null);
            const issue = await rpc(
              coordinator.beginOrGet({
                ...(await makeRequestIdentity(randomUUID(), requestBytes)).identity,
                maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
              }),
              "reject issue admission after independent proof failure",
            );
            assert.equal(issue.status, "REJECTED");
          },
        );
      }

      for (const mismatch of [
        "POINTER_BYTES",
        "POINTER_ETAG",
        "SNAPSHOT_BYTES",
        "SNAPSHOT_REFERENCE",
      ]) {
        it(
          `rejects independent binding install when R2 ${mismatch.toLowerCase()} differs`,
          { timeout: 30_000 },
          async () => {
            const seeded = await seededInitialReleaseCoordinator(
              context,
              `current-state-r2-${mismatch.toLowerCase()}`,
            );
            const { stub, coordinator, fixture, releaseOperationId, clock } =
              seeded;
            const installOperationId = randomUUID();
            const started = await rpc(
              coordinator.beginReleaseBindingInstall({
                operationId: installOperationId,
                mode: "BOOTSTRAP",
                releaseOperationId,
                expectedCurrentStateSha256: null,
                expectedRestoreEpoch: clockEpoch,
              }),
              "reserve an R2 mismatch bootstrap attempt",
            );
            assert.equal(started.status, "STARTED");
            const changed = Uint8Array.from(fixture.manifestBytes);
            changed[changed.length - 1] ^= 1;
            if (mismatch === "POINTER_BYTES") {
              await rpc(
                stub.writeReleaseObjectForLocalTest(
                  RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
                  changed,
                ),
                "change test pointer bytes",
              );
            } else if (mismatch === "POINTER_ETAG") {
              await rpc(
                stub.writeReleaseObjectForLocalTest(
                  RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
                  fixture.manifestBytes,
                ),
                "change test pointer ETag with an exact-byte rewrite",
              );
            } else if (mismatch === "SNAPSHOT_BYTES") {
              await rpc(
                stub.writeReleaseObjectForLocalTest(
                  fixture.releaseHead.manifestRef,
                  changed,
                ),
                "change immutable test snapshot bytes",
              );
            }
            const manifests = await runtimeR2ManifestReader(context);
            const mismatchedEtagManifests = {
              ...manifests,
              async readCurrentManifestPointer() {
                const pointer = await manifests.readCurrentManifestPointer();
                return pointer === null
                  ? null
                  : { ...pointer, etag: `${pointer.etag}-mismatch` };
              },
            };
            const reader = makeSignedReleaseStateReader(
              fixture,
              mismatch === "SNAPSHOT_REFERENCE"
                ? {
                    ...manifests,
                    async readImmutableManifestSnapshot(reference) {
                      const object =
                        await manifests.readImmutableManifestSnapshot(reference);
                      return object === null
                        ? null
                        : {
                            ...object,
                            reference: `${reference}-different`,
                          };
                    },
                  }
                : mismatch === "POINTER_ETAG"
                  ? mismatchedEtagManifests
                  : manifests,
            );
            const operation = started.operation;
            const proofContext = await createFreshnessCurrentStateInstallProofContext({
              mode: "BOOTSTRAP",
              environment: "production",
              chainId: fixture.releaseHead.chainId,
              installOperationId,
              installFencingToken: operation.installFencingToken,
              releaseOperationId,
              releaseFencingToken: operation.releaseFencingToken,
              targetPosition: operation.targetPosition,
              targetGeneration: operation.targetGeneration,
              targetRecordSha256: operation.targetRecordSha256,
              expectedRestoreEpoch: clockEpoch,
              expectedCurrentStateSha256: null,
              clock,
            });
            await assert.rejects(async () => {
              const evidence = await reader.readReleaseState(proofContext);
              await reader.verifyReleaseState(evidence, proofContext);
            });
            const pending = await rpc(
              coordinator.getReleaseBindingInstall(installOperationId),
              "confirm R2 mismatch preserves the pending install blocker",
            );
            assert.equal(pending.status, "VERIFYING");
            assert.equal(pending.installedState, null);
          },
        );
      }

      it(
        "quarantines stale fences, rejects a competing Release, and never saves caller-mutated binding claims",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-install-stale-fence",
          );
          const { coordinator, fixture, releaseOperationId, clock } = seeded;
          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          await assert.rejects(() =>
            coordinator.beginReleaseOperation({
              operationId: randomUUID(),
              expectedHead: fixture.releaseHead,
              manifestBytes: fixture.manifestBytes,
            }),
          );

          const wrongFenceContext =
            await createFreshnessCurrentStateInstallProofContext({
              mode: "BOOTSTRAP",
              environment: "production",
              chainId: fixture.releaseHead.chainId,
              installOperationId:
                prepared.proofContext.installOperationId,
              installFencingToken: "999",
              releaseOperationId,
              releaseFencingToken:
                prepared.proofContext.releaseFencingToken,
              targetPosition: prepared.proofContext.targetPosition,
              targetGeneration: prepared.proofContext.targetGeneration,
              targetRecordSha256: prepared.proofContext.targetRecordSha256,
              expectedRestoreEpoch: clockEpoch,
              expectedCurrentStateSha256: null,
              clock,
            });
          const reader = makeSignedReleaseStateReader(
            fixture,
            await runtimeR2ManifestReader(context),
          );
          const evidence = await reader.readReleaseState(wrongFenceContext);
          const verifiedState = await reader.verifyReleaseState(
            evidence,
            wrongFenceContext,
          );
          const quarantined = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: wrongFenceContext,
              verifiedState,
            }),
            "reject the stale install fence in the SQLite transaction",
          );
          assert.equal(quarantined.status, "QUARANTINED");
          assert.equal(quarantined.operation.installedState, null);
          const issue = await rpc(
            coordinator.beginOrGet({
              ...(await makeRequestIdentity(randomUUID(), requestBytes)).identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "retain issue gate after a stale install fence",
          );
          assert.equal(issue.status, "REJECTED");
        },
      );

      it(
        "does not install after the Release head changes during verification",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-install-stale-head",
          );
          const { stub, coordinator, fixture, releaseOperationId, clock } =
            seeded;
          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          await rpc(
            stub.deleteReleaseLedgerHeadForLocalTest(),
            "simulate Release head loss during asynchronous verification",
          );
          await assert.rejects(() =>
            coordinator.finalizeReleaseBindingInstall({
              proofContext: prepared.proofContext,
              verifiedState: prepared.verifiedState,
            }),
          );
          const pending = await rpc(
            coordinator.getReleaseBindingInstall(
              prepared.proofContext.installOperationId,
            ),
            "confirm lost head leaves install unresolved",
          );
          assert.equal(pending.status, "VERIFYING");
          assert.equal(pending.installedState, null);
          const issue = await rpc(
            coordinator.beginOrGet({
              ...(await makeRequestIdentity(randomUUID(), requestBytes)).identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "keep issue admission closed after head loss",
          );
          assert.equal(issue.status, "REJECTED");
        },
      );

      it(
        "quarantines a changed previous binding instead of overwriting it after external verification",
        { timeout: 40_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-install-stale-binding",
          );
          const { stub, coordinator, fixture, releaseOperationId, clock } =
            seeded;
          const bootstrap = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: bootstrap.proofContext,
              verifiedState: bootstrap.verifiedState,
            }),
            "bootstrap before the stale-binding test",
          );
          const intent = await startReleaseIntent(coordinator, fixture);
          const staged = await stageReleaseIntent(coordinator, intent);
          const appended = await appendReleaseIntent(coordinator, staged);
          const available = await finalizeReleaseIntent(coordinator, appended);
          assert.equal(available.finalized.status, "AVAILABLE");
          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            appended.committedFixture,
            {
              mode: "ADVANCE",
              releaseOperationId: intent.operationId,
              expectedCurrentStateSha256: fixture.currentState.stateSha256,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          await rpc(
            stub.restoreCoordinationStateForLocalTest(
              appended.committedFixture.currentState,
            ),
            "change the prior binding during external proof verification",
          );
          const quarantined = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: prepared.proofContext,
              verifiedState: prepared.verifiedState,
            }),
            "reject install against a changed expected predecessor",
          );
          assert.equal(quarantined.status, "QUARANTINED");
          assert.equal(quarantined.operation.installedState, null);
          const state = await rpc(
            stub.inspectStateForLocalTest(),
            "confirm install did not overwrite the changed binding",
          );
          assert.equal(
            state.currentState.stateSha256,
            appended.committedFixture.currentState.stateSha256,
          );
          assert.equal(state.writerPending, true);
        },
      );

      it(
        "rejects a caller-mutated witness claim even when the Release operation is AVAILABLE",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-install-mutated-proof-claims",
          );
          const { coordinator, fixture, releaseOperationId, clock } = seeded;
          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          const changedClaim = {
            ...prepared.verifiedState,
            antiRollbackWitness: {
              ...prepared.verifiedState.antiRollbackWitness,
              restoreEpoch: "caller-claimed-restore-epoch",
            },
          };
          const quarantined = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: prepared.proofContext,
              verifiedState: changedClaim,
            }),
            "reject a caller-mutated witness claim",
          );
          assert.equal(quarantined.status, "QUARANTINED");
          assert.equal(quarantined.operation.installedState, null);
          assert.equal(
            await rpc(
              coordinator.getReleaseBindingInstall(
                prepared.proofContext.installOperationId,
              ),
              "verify mutated witness remains quarantined",
            ).then((operation) => operation.status),
            "QUARANTINED",
          );
        },
      );

      it(
        "refuses automatic rebootstrap after current-state loss or corruption",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededInitialReleaseCoordinator(
            context,
            "current-state-install-state-loss",
          );
          const { stub, coordinator, fixture, releaseOperationId, clock } =
            seeded;
          const prepared = await prepareReleaseBindingInstall(
            context,
            coordinator,
            fixture,
            {
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
              clock,
            },
          );
          const installed = await rpc(
            coordinator.finalizeReleaseBindingInstall({
              proofContext: prepared.proofContext,
              verifiedState: prepared.verifiedState,
            }),
            "install an initial binding before state-loss tests",
          );
          assert.equal(installed.status, "INSTALLED");

          await rpc(
            stub.deleteCoordinatorStateForLocalTest(),
            "simulate current-state-only loss with Release history retained",
          );
          const automaticBootstrap = await rpc(
            coordinator.beginReleaseBindingInstall({
              operationId: randomUUID(),
              mode: "BOOTSTRAP",
              releaseOperationId,
              expectedCurrentStateSha256: null,
              expectedRestoreEpoch: clockEpoch,
            }),
            "reject rebootstrap from an existing Release history",
          );
          assert.equal(automaticBootstrap.status, "CONFLICT");

          await rpc(
            stub.bootstrapLocalTestState({
              environment: "production",
              currentState: fixture.currentState,
              witness: fixture.witness,
              clock,
            }),
            "restore explicit local test state for corruption validation",
          );
          await rpc(
            stub.corruptCoordinatorStateForLocalTest(),
            "corrupt current-state JSON without clearing its history",
          );
          const corruptIssue = await makeRequestIdentity(
            randomUUID(),
            requestBytes,
          );
          await assert.rejects(() =>
            coordinator.beginReleaseBindingInstall({
              operationId: randomUUID(),
              mode: "ADVANCE",
              releaseOperationId,
              expectedCurrentStateSha256: fixture.currentState.stateSha256,
              expectedRestoreEpoch: clockEpoch,
            }),
          );
          await assert.rejects(() =>
            coordinator.beginOrGet({
              ...corruptIssue.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
          );
        },
      );

      it(
        "compare-and-appends exact signed Release bytes, finalizes R2 readback, and recovers the operation after restart",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededReleaseCoordinator(
            context,
            "release-ledger-roundtrip",
          );
          const { stub, coordinator, fixture, objectId, objectName } = seeded;
          const baseline = await rpc(
            coordinator.readReleaseLedgerHead(),
            "read seeded Release ledger head",
          );
          assert.equal(baseline.position, "1");
          assert.ok(equalBytes(baseline.recordBytes, fixture.recordBytes));
          assert.ok(equalBytes(baseline.manifestBytes, fixture.manifestBytes));

          const nextManifest = await makeSignedCurrentStateFixture({
            manifestEpoch: "2",
            previousReleaseHead: fixture.releaseHead,
          });
          const operationId = randomUUID();
          const started = await rpc(
            coordinator.beginReleaseOperation({
              operationId,
              expectedHead: baseline,
              manifestBytes: nextManifest.manifestBytes,
            }),
            "begin compare-and-append Release operation",
          );
          assert.equal(started.status, "STARTED");
          assert.ok(started.operation.fencingToken);

          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const blockedIssue = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "attempt Freshness admission behind Release writer gate",
          );
          assert.equal(blockedIssue.status, "REJECTED");
          assert.equal(blockedIssue.reason, "CURRENT_STATE_UNAVAILABLE");

          const staged = await rpc(
            coordinator.stageReleaseManifest({
              operationId,
              fencingToken: started.operation.fencingToken,
            }),
            "publish and read back Release Manifest",
          );
          assert.equal(staged.status, "R2_STAGED");
          assert.equal(staged.operation.manifestLength, nextManifest.manifestBytes.byteLength);
          assert.ok(equalBytes(staged.operation.pointerBytes, nextManifest.manifestBytes));
          assert.ok(equalBytes(staged.operation.snapshotBytes, nextManifest.manifestBytes));

          const committedFixture = await makeSignedCurrentStateFixture({
            manifestEpoch: "2",
            pointerEtag: staged.operation.pointerEtag,
            previousReleaseHead: fixture.releaseHead,
          });
          assert.ok(equalBytes(
            committedFixture.manifestBytes,
            nextManifest.manifestBytes,
          ));
          const appended = await rpc(
            coordinator.appendReleaseRecord({
              operationId,
              fencingToken: started.operation.fencingToken,
              recordBytes: committedFixture.recordBytes,
              releaseDelegationBytes: committedFixture.releaseDelegationBytes,
            }),
            "append signed Release Record",
          );
          assert.equal(appended.status, "LEDGER_COMMITTED");
          assert.equal(appended.operation.position, "2");
          assert.equal(appended.operation.generation, "2");
          assert.equal(
            appended.operation.recordLength,
            committedFixture.recordBytes.byteLength,
          );
          assert.ok(equalBytes(appended.operation.recordBytes, committedFixture.recordBytes));
          const issueBeforeReadback = await makeRequestIdentity(
            randomUUID(),
            requestBytes,
          );
          const blockedBeforeReadback = await rpc(
            coordinator.beginOrGet({
              ...issueBeforeReadback.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "keep Freshness closed after ledger commit but before R2 finalization",
          );
          assert.equal(blockedBeforeReadback.status, "REJECTED");

          const sameAppend = await rpc(
            coordinator.appendReleaseRecord({
              operationId,
              fencingToken: started.operation.fencingToken,
              recordBytes: committedFixture.recordBytes,
              releaseDelegationBytes: committedFixture.releaseDelegationBytes,
            }),
            "query idempotent Release append",
          );
          assert.equal(sameAppend.status, "LEDGER_COMMITTED");
          const changedRecord = Uint8Array.from(committedFixture.recordBytes);
          changedRecord[changedRecord.length - 1] ^= 1;
          const conflictingAppend = await rpc(
            coordinator.appendReleaseRecord({
              operationId,
              fencingToken: started.operation.fencingToken,
              recordBytes: changedRecord,
              releaseDelegationBytes: committedFixture.releaseDelegationBytes,
            }),
            "reject a different Record for the same operation",
          );
          assert.equal(conflictingAppend.status, "CONFLICT");

          const currentHead = await rpc(
            coordinator.readReleaseLedgerHead(),
            "read committed Release ledger head",
          );
          assert.equal(currentHead.position, "2");
          assert.equal(currentHead.generation, "2");
          assert.equal(currentHead.recordSha256, digest(committedFixture.recordBytes));
          assert.ok(equalBytes(currentHead.recordBytes, committedFixture.recordBytes));
          assert.ok(equalBytes(currentHead.manifestBytes, committedFixture.manifestBytes));
          const committedHeadRecordSha256 = currentHead.recordSha256;

          const available = await rpc(
            coordinator.finalizeReleaseR2Readback({
              operationId,
              fencingToken: started.operation.fencingToken,
            }),
            "verify post-append R2 readback",
          );
          assert.equal(available.status, "AVAILABLE");
          assert.equal(available.operation.status, "AVAILABLE");
          const committedPointerEtag = available.operation.pointerEtag;
          const unavailableIssue = await rpc(
            coordinator.beginOrGet({
              ...await makeRequestIdentity(randomUUID(), requestBytes).then(
                (value) => value.identity,
              ),
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "reject issue against stale Coordinator current state",
          );
          assert.equal(unavailableIssue.status, "REJECTED");
          assert.equal(unavailableIssue.reason, "CURRENT_STATE_MISMATCH");

          await restartRuntime(context);
          const reopened = coordinatorForName(
            context,
            objectName,
            objectId,
            context.releaseNamespace,
          );
          const recoveredHead = await rpc(
            reopened.coordinator.readReleaseLedgerHead(),
            "recover Release head after runtime recreation",
          );
          const recoveredOperation = await rpc(
            reopened.coordinator.getReleaseOperation(operationId),
            "recover Release operation after runtime recreation",
          );
          assert.equal(recoveredOperation.status, "AVAILABLE");
          assert.equal(recoveredOperation.recordLength, committedFixture.recordBytes.byteLength);
          assert.ok(equalBytes(recoveredOperation.recordBytes, committedFixture.recordBytes));
          assert.equal(recoveredHead.recordSha256, committedHeadRecordSha256);
          assert.equal(recoveredHead.pointerEtag, committedPointerEtag);
        },
      );

      it(
        "serializes competing Release writers and preserves operation request binding",
        async () => {
          const seeded = await seededReleaseCoordinator(
            context,
            "release-competing-writers",
          );
          const { stub, coordinator, fixture } = seeded;
          const baseline = await rpc(
            coordinator.readReleaseLedgerHead(),
            "read competing Release predecessor",
          );
          const firstFixture = await makeSignedCurrentStateFixture({
            manifestEpoch: "2",
            previousReleaseHead: fixture.releaseHead,
          });
          const secondFixture = await makeSignedCurrentStateFixture({
            manifestEpoch: "3",
            previousReleaseHead: fixture.releaseHead,
          });
          const firstId = randomUUID();
          const secondId = randomUUID();
          const candidates = [
            { operationId: firstId, fixture: firstFixture },
            { operationId: secondId, fixture: secondFixture },
          ];
          const results = await Promise.all(candidates.map(({ operationId, fixture: next }) =>
            coordinator.beginReleaseOperation({
              operationId,
              expectedHead: baseline,
              manifestBytes: next.manifestBytes,
            })
          ));
          const winnerIndex = results.findIndex((result) => result.status === "STARTED");
          const loserIndex = results.findIndex((result) => result.status === "CONFLICT");
          assert.notEqual(winnerIndex, -1);
          assert.notEqual(loserIndex, -1);
          assert.notEqual(winnerIndex, loserIndex);

          const winner = candidates[winnerIndex];
          const loser = candidates[loserIndex];
          const idempotentBegin = await rpc(
            coordinator.beginReleaseOperation({
              operationId: winner.operationId,
              expectedHead: baseline,
              manifestBytes: winner.fixture.manifestBytes,
            }),
            "replay the exact Release operation request",
          );
          assert.equal(idempotentBegin.status, "STARTED");
          const changedRequest = await rpc(
            coordinator.beginReleaseOperation({
              operationId: winner.operationId,
              expectedHead: baseline,
              manifestBytes: loser.fixture.manifestBytes,
            }),
            "reject changed bytes under the same Release operation ID",
          );
          assert.equal(changedRequest.status, "CONFLICT");
          const storedWinner = await rpc(
            coordinator.getReleaseOperation(winner.operationId),
            "read the original Release operation request",
          );
          assert.ok(equalBytes(storedWinner.manifestBytes, winner.fixture.manifestBytes));

          const wrongChain = await rpc(
            coordinator.beginReleaseOperation({
              operationId: randomUUID(),
              expectedHead: { ...baseline, chainId: "different-test-chain" },
              manifestBytes: loser.fixture.manifestBytes,
            }),
            "reject a Release predecessor from another chain",
          );
          assert.equal(wrongChain.status, "CONFLICT");
          const wrongEnvironment = await rpc(
            stub.attemptBeginReleaseOperationForLocalTest({
              operationId: randomUUID(),
              expectedHead: { ...baseline, environment: "staging" },
              manifestBytes: loser.fixture.manifestBytes,
            }),
            "reject a Release predecessor from another environment",
          );
          assert.equal(wrongEnvironment.status, "THREW");
          assert.match(wrongEnvironment.errorMessage, /expected Release head binding is invalid/i);
          const staleFence = await rpc(
            stub.attemptStageReleaseManifestForLocalTest({
              operationId: winner.operationId,
              fencingToken: "0",
            }),
            "attempt staging with a stale Release fence",
          );
          assert.equal(staleFence.status, "THREW");
          assert.match(staleFence.errorMessage, /fencing token/i);

          const staged = await rpc(
            coordinator.stageReleaseManifest({
              operationId: winner.operationId,
              fencingToken: idempotentBegin.operation.fencingToken,
            }),
            "stage the single winning Release",
          );
          assert.equal(staged.status, "R2_STAGED");
          const committedFixture = await makeSignedCurrentStateFixture({
            manifestEpoch: winner.fixture.manifestEpoch,
            pointerEtag: staged.operation.pointerEtag,
            previousReleaseHead: fixture.releaseHead,
          });
          const appended = await rpc(
            coordinator.appendReleaseRecord({
              operationId: winner.operationId,
              fencingToken: staged.operation.fencingToken,
              recordBytes: committedFixture.recordBytes,
              releaseDelegationBytes: committedFixture.releaseDelegationBytes,
            }),
            "append the unique winning Release",
          );
          assert.equal(appended.status, "LEDGER_COMMITTED");
          const head = await rpc(
            coordinator.readReleaseLedgerHead(),
            "confirm one Release won the predecessor",
          );
          assert.equal(head.position, "2");
          assert.equal(head.recordSha256, digest(committedFixture.recordBytes));
          assert.equal(
            (await rpc(
              coordinator.getReleaseOperation(loser.operationId),
              "inspect losing concurrent Release operation",
            )).status,
            "CONFLICT",
          );
          const finalized = await rpc(
            coordinator.finalizeReleaseR2Readback({
              operationId: winner.operationId,
              fencingToken: staged.operation.fencingToken,
            }),
            "finalize the unique winning Release",
          );
          assert.equal(finalized.status, "AVAILABLE");
        },
      );

      it(
        "keeps a delayed R2 outcome unknown after a negative read and recovers the same operation",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededReleaseCoordinator(
            context,
            "release-delayed-r2-unknown",
          );
          const { stub, coordinator, objectId, objectName, fixture } = seeded;
          const intent = await startReleaseIntent(coordinator, fixture);
          await rpc(
            stub.armDelayedPointerWriteForLocalTest(),
            "arm delayed test-only R2 pointer write",
          );
          const stagedPromise = coordinator.stageReleaseManifest({
            operationId: intent.operationId,
            fencingToken: intent.fencingToken,
          });
          await rpc(
            stub.waitForDelayedPointerWriteForLocalTest(),
            "wait for the R2 write to reach its delayed point",
          );

          const negativeRead = await rpc(
            coordinator.reconcileReleaseOperation({
              operationId: intent.operationId,
              fencingToken: intent.fencingToken,
            }),
            "reconcile before the delayed R2 write commits",
          );
          assert.equal(negativeRead.status, "RESULT_UNKNOWN");
          assert.equal(negativeRead.operation.unknownStage, "R2_WRITE");
          await rpc(
            stub.releaseDelayedPointerWriteForLocalTest(),
            "allow the delayed R2 pointer write to commit",
          );
          const lostResponse = await rpc(
            stagedPromise,
            "observe the lost R2 write response",
          );
          assert.equal(lostResponse.status, "RESULT_UNKNOWN");
          const unresolved = await rpc(
            coordinator.getReleaseOperation(intent.operationId),
            "query the unresolved Release operation by its original ID",
          );
          assert.equal(unresolved.status, "RESULT_UNKNOWN");
          assert.equal(unresolved.unknownStage, "R2_WRITE");

          await restartRuntime(context);
          const reopened = coordinatorForName(
            context,
            objectName,
            objectId,
            context.releaseNamespace,
          );
          const recovered = await rpc(
            reopened.coordinator.getReleaseOperation(intent.operationId),
            "recover the unresolved Release operation after restart",
          );
          assert.equal(recovered.status, "RESULT_UNKNOWN");
          const recoveredHead = await rpc(
            reopened.coordinator.readReleaseLedgerHead(),
            "confirm the prior head remains until reconciliation",
          );
          assert.equal(recoveredHead.position, "1");
          const competingOperation = await rpc(
            reopened.coordinator.beginReleaseOperation({
              operationId: randomUUID(),
              expectedHead: recoveredHead,
              manifestBytes: intent.nextFixture.manifestBytes,
            }),
            "reject a new operation while the original result is unresolved",
          );
          assert.equal(competingOperation.status, "CONFLICT");
          const reconciled = await rpc(
            reopened.coordinator.reconcileReleaseOperation({
              operationId: intent.operationId,
              fencingToken: intent.fencingToken,
            }),
            "recover the exact delayed R2 publication",
          );
          assert.equal(reconciled.status, "R2_STAGED");
          assert.equal(reconciled.operation.status, "R2_STAGED");

          const recoveredIntent = {
            operationId: intent.operationId,
            fencingToken: intent.fencingToken,
            nextFixture: intent.nextFixture,
            previousFixture: intent.previousFixture,
          };
          const staged = await stageReleaseIntent(
            reopened.coordinator,
            recoveredIntent,
          );
          const appended = await appendReleaseIntent(
            reopened.coordinator,
            staged,
          );
          assert.equal(appended.appended.status, "LEDGER_COMMITTED");
          const finalized = await finalizeReleaseIntent(
            reopened.coordinator,
            appended,
          );
          assert.equal(finalized.finalized.status, "AVAILABLE");
        },
      );

      it(
        "recovers a committed ledger operation after its append response is lost, even after a later head advances",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededReleaseCoordinator(
            context,
            "release-lost-append-response",
          );
          const { stub, coordinator, fixture } = seeded;
          const firstIntent = await startReleaseIntent(coordinator, fixture);
          const firstStaged = await stageReleaseIntent(coordinator, firstIntent);
          await rpc(
            stub.loseNextAppendResponseForLocalTest(),
            "arm a test-only lost response after ledger commit",
          );
          const lostResponse = await rpc(
            stub.attemptAppendReleaseRecordForLocalTest({
              operationId: firstStaged.operationId,
              fencingToken: firstStaged.fencingToken,
              recordBytes: firstStaged.committedFixture.recordBytes,
              releaseDelegationBytes:
                firstStaged.committedFixture.releaseDelegationBytes,
            }),
            "simulate a lost append response after the ledger commit",
          );
          assert.equal(lostResponse.status, "THREW");
          assert.match(lostResponse.errorMessage, /lost Release append response/i);
          const recoveredAppend = await rpc(
            coordinator.getReleaseOperation(firstStaged.operationId),
            "query the committed operation after its response was lost",
          );
          assert.equal(recoveredAppend.status, "LEDGER_COMMITTED");
          assert.equal(
            recoveredAppend.recordLength,
            firstStaged.committedFixture.recordBytes.byteLength,
          );
          assert.ok(equalBytes(
            recoveredAppend.recordBytes,
            firstStaged.committedFixture.recordBytes,
          ));
          const firstFinalized = await finalizeReleaseIntent(
            coordinator,
            firstStaged,
          );
          assert.equal(firstFinalized.finalized.status, "AVAILABLE");

          await rpc(
            stub.restoreCoordinationStateForLocalTest(
              firstStaged.committedFixture.currentState,
            ),
            "install the next local test current-state binding",
          );
          await rpc(
            stub.setWitnessForLocalTest(firstStaged.committedFixture.witness),
            "install the matching local test witness binding",
          );
          const secondIntent = await startReleaseIntent(
            coordinator,
            firstStaged.committedFixture,
            { manifestEpoch: "3" },
          );
          const secondStaged = await stageReleaseIntent(
            coordinator,
            secondIntent,
          );
          const secondAppended = await appendReleaseIntent(
            coordinator,
            secondStaged,
          );
          assert.equal(secondAppended.appended.status, "LEDGER_COMMITTED");
          const secondFinalized = await finalizeReleaseIntent(
            coordinator,
            secondAppended,
          );
          assert.equal(secondFinalized.finalized.status, "AVAILABLE");

          const originalOperation = await rpc(
            coordinator.getReleaseOperation(firstIntent.operationId),
            "query the first operation after the Release head advances again",
          );
          assert.equal(originalOperation.status, "AVAILABLE");
          assert.equal(originalOperation.position, "2");
          assert.ok(equalBytes(
            originalOperation.recordBytes,
            firstStaged.committedFixture.recordBytes,
          ));
          const latestHead = await rpc(
            coordinator.readReleaseLedgerHead(),
            "confirm the later Release head",
          );
          assert.equal(latestHead.position, "3");
          assert.notEqual(latestHead.recordSha256, originalOperation.recordSha256);
        },
      );

      it(
        "keeps a post-append R2 readback failure unknown and blocked across restart",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededReleaseCoordinator(
            context,
            "release-readback-unknown",
          );
          const { stub, coordinator, objectId, objectName, fixture } = seeded;
          const intent = await startReleaseIntent(coordinator, fixture);
          const staged = await stageReleaseIntent(coordinator, intent);
          const appended = await appendReleaseIntent(coordinator, staged);
          assert.equal(appended.appended.status, "LEDGER_COMMITTED");
          await rpc(
            stub.failNextR2ReadbackForLocalTest(),
            "fail the exact pointer and snapshot reads once",
          );
          const unresolved = await rpc(
            coordinator.finalizeReleaseR2Readback({
              operationId: intent.operationId,
              fencingToken: intent.fencingToken,
            }),
            "finalize while R2 readback is unavailable",
          );
          assert.equal(unresolved.status, "RESULT_UNKNOWN");
          assert.equal(unresolved.operation.unknownStage, "R2_READBACK");
          const request = await makeRequestIdentity(randomUUID(), requestBytes);
          const blockedIssue = await rpc(
            coordinator.beginOrGet({
              ...request.identity,
              maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
            }),
            "reject Freshness admission while R2 readback is unresolved",
          );
          assert.equal(blockedIssue.status, "REJECTED");

          await restartRuntime(context);
          const reopened = coordinatorForName(
            context,
            objectName,
            objectId,
            context.releaseNamespace,
          );
          const persisted = await rpc(
            reopened.coordinator.getReleaseOperation(intent.operationId),
            "recover unresolved post-append readback after restart",
          );
          assert.equal(persisted.status, "RESULT_UNKNOWN");
          assert.equal(persisted.unknownStage, "R2_READBACK");
          const reconciled = await rpc(
            reopened.coordinator.reconcileReleaseOperation({
              operationId: intent.operationId,
              fencingToken: intent.fencingToken,
            }),
            "re-read the exact R2 bytes before releasing the writer gate",
          );
          assert.equal(reconciled.status, "AVAILABLE");
          assert.equal(reconciled.operation.status, "AVAILABLE");
        },
      );

      for (const mismatch of ["POINTER_BYTES", "SNAPSHOT_BYTES", "POINTER_ETAG"]) {
        it(
          `quarantines Release finalization when R2 ${mismatch.toLowerCase()} changes`,
          { timeout: 30_000 },
          async () => {
            const seeded = await seededReleaseCoordinator(
              context,
              `release-r2-${mismatch.toLowerCase()}`,
            );
            const { stub, coordinator, fixture } = seeded;
            const intent = await startReleaseIntent(coordinator, fixture);
            const staged = await stageReleaseIntent(coordinator, intent);
            const appended = await appendReleaseIntent(coordinator, staged);
            assert.equal(appended.appended.status, "LEDGER_COMMITTED");

            if (mismatch === "POINTER_BYTES") {
              const corrupt = Uint8Array.from(intent.nextFixture.manifestBytes);
              corrupt[0] ^= 1;
              await rpc(
                stub.writeReleaseObjectForLocalTest(
                  RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
                  corrupt,
                ),
                "corrupt the Release pointer through the test-only R2 adapter",
              );
            } else if (mismatch === "SNAPSHOT_BYTES") {
              const corrupt = Uint8Array.from(intent.nextFixture.manifestBytes);
              corrupt[0] ^= 1;
              await rpc(
                stub.writeReleaseObjectForLocalTest(
                  intent.nextFixture.manifestRef,
                  corrupt,
                ),
                "corrupt the immutable snapshot through the test-only R2 adapter",
              );
            } else if (mismatch === "POINTER_ETAG") {
              await rpc(
                stub.mismatchNextPointerEtagForLocalTest(),
                "inject a mismatched ETag on the next pointer read",
              );
            }

            const quarantined = await rpc(
              coordinator.finalizeReleaseR2Readback({
                operationId: intent.operationId,
                fencingToken: intent.fencingToken,
              }),
              "reject Release finalization after R2 binding changes",
            );
            assert.equal(quarantined.status, "QUARANTINED");
            assert.equal(quarantined.operation.status, "QUARANTINED");
            const request = await makeRequestIdentity(randomUUID(), requestBytes);
            const issue = await rpc(
              coordinator.beginOrGet({
                ...request.identity,
                maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
              }),
              "keep Freshness closed after R2 mismatch",
            );
            assert.equal(issue.status, "REJECTED");

            if (mismatch === "SNAPSHOT_BYTES") {
              await rpc(
                stub.writeReleaseObjectForLocalTest(
                  intent.nextFixture.manifestRef,
                  intent.nextFixture.manifestBytes,
                ),
                "restore the test-only immutable snapshot after corruption",
              );
            }
          },
        );
      }

      for (const malformed of ["RECORD_SIGNATURE", "DELEGATION_SIGNATURE"]) {
        it(
          `quarantines an invalid signed Release ${malformed.toLowerCase()}`,
          { timeout: 30_000 },
          async () => {
            const seeded = await seededReleaseCoordinator(
              context,
              `release-invalid-${malformed.toLowerCase()}`,
            );
            const { stub, coordinator, fixture } = seeded;
            const intent = await startReleaseIntent(coordinator, fixture);
            const staged = await stageReleaseIntent(coordinator, intent);
            const recordBytes = Uint8Array.from(
              staged.committedFixture.recordBytes,
            );
            const delegationBytes = Uint8Array.from(
              staged.committedFixture.releaseDelegationBytes,
            );
            if (malformed === "RECORD_SIGNATURE") {
              recordBytes[recordBytes.length - 1] ^= 1;
            } else {
              delegationBytes[delegationBytes.length - 1] ^= 1;
            }
            const outcome = await rpc(
              stub.attemptAppendReleaseRecordForLocalTest({
                operationId: intent.operationId,
                fencingToken: intent.fencingToken,
                recordBytes,
                releaseDelegationBytes: delegationBytes,
              }),
              "verify invalid signed Release input",
            );
            assert.equal(outcome.status, "THREW");
            const operation = await rpc(
              coordinator.getReleaseOperation(intent.operationId),
              "inspect quarantined invalid Release operation",
            );
            assert.equal(operation.status, "QUARANTINED");
            const head = await rpc(
              coordinator.readReleaseLedgerHead(),
              "confirm invalid signed input did not advance the head",
            );
            assert.equal(head.position, "1");
          },
        );
      }

      for (const staleBinding of ["PREDECESSOR_DIGEST", "PREDECESSOR_GENERATION"]) {
        it(
          `rejects a validly signed Release with stale ${staleBinding.toLowerCase()}`,
          { timeout: 30_000 },
          async () => {
            const seeded = await seededReleaseCoordinator(
              context,
              `release-stale-${staleBinding.toLowerCase()}`,
            );
            const { coordinator, fixture } = seeded;
            const intent = await startReleaseIntent(coordinator, fixture);
            const staged = await stageReleaseIntent(coordinator, intent);
            const stalePreviousHead = staleBinding === "PREDECESSOR_DIGEST"
              ? {
                  ...fixture.releaseHead,
                  recordSha256: changeBase64UrlDigest(
                    fixture.releaseHead.recordSha256,
                  ),
                }
              : { ...fixture.releaseHead, generation: "9", position: "9" };
            const staleFixture = await makeSignedCurrentStateFixture({
              manifestEpoch: intent.nextFixture.manifestEpoch,
              pointerEtag: staged.staged.operation.pointerEtag,
              previousReleaseHead: stalePreviousHead,
            });
            assert.ok(equalBytes(
              staleFixture.manifestBytes,
              intent.nextFixture.manifestBytes,
            ));
            const result = await rpc(
              coordinator.appendReleaseRecord({
                operationId: intent.operationId,
                fencingToken: intent.fencingToken,
                recordBytes: staleFixture.recordBytes,
                releaseDelegationBytes: staleFixture.releaseDelegationBytes,
              }),
              "compare the signed predecessor with the current ledger head",
            );
            assert.equal(result.status, "QUARANTINED");
            const head = await rpc(
              coordinator.readReleaseLedgerHead(),
              "confirm stale predecessor did not advance the ledger",
            );
            assert.equal(head.position, "1");
          },
        );
      }

      for (const binding of ["MANIFEST_DIGEST", "MANIFEST_REFERENCE"]) {
        it(
          `fails closed when the persisted Release ${binding.toLowerCase()} is corrupt`,
          { timeout: 30_000 },
          async () => {
            const seeded = await seededReleaseCoordinator(
              context,
              `release-corrupt-${binding.toLowerCase()}`,
            );
            const { stub, coordinator, fixture } = seeded;
            const intent = await startReleaseIntent(coordinator, fixture);
            await rpc(
              stub.corruptReleaseOperationBindingForLocalTest(
                intent.operationId,
                binding,
              ),
              "corrupt one persisted Release binding in the test-only DO",
            );
            const outcome = await rpc(
              stub.attemptGetReleaseOperationForLocalTest(intent.operationId),
              "verify corrupted Release operation binding",
            );
            assert.equal(outcome.status, "THREW");
            assert.match(
              outcome.errorMessage,
              /Persisted Release operation Manifest binding is invalid/i,
            );
          },
        );
      }

      it(
        "does not initialize a missing persisted Release head as genesis",
        async () => {
          const seeded = await seededReleaseCoordinator(
            context,
            "release-missing-head",
          );
          const { stub, coordinator } = seeded;
          await rpc(
            stub.deleteReleaseLedgerHeadForLocalTest(),
            "delete the head row through a test-only corruption hook",
          );
          const missingHead = await rpc(
            stub.attemptReadReleaseLedgerHeadForLocalTest(),
            "read the corrupted Release ledger",
          );
          assert.equal(missingHead.status, "THREW");
          assert.match(missingHead.errorMessage, /Release ledger head is missing/i);
          const operationId = randomUUID();
          const genesisManifest = await makeSignedCurrentStateFixture({
            manifestEpoch: "2",
          });
          const attemptedGenesis = await rpc(
            stub.attemptBeginReleaseOperationForLocalTest({
              operationId,
              expectedHead: null,
              manifestBytes: genesisManifest.manifestBytes,
            }),
            "reject implicit Release genesis after state loss",
          );
          assert.equal(attemptedGenesis.status, "THREW");
          assert.match(attemptedGenesis.errorMessage, /Release ledger head is missing/i);
          assert.equal(
            await rpc(
              coordinator.getReleaseOperation(operationId),
              "confirm rejected implicit genesis did not persist an operation",
            ),
            null,
          );
        },
      );

      it(
        "orders the Release writer gate against active and newly admitted Freshness issues",
        { timeout: 30_000 },
        async () => {
          const seeded = await seededReleaseCoordinator(
            context,
            "release-freshness-issue-race",
          );
          const { coordinator, fixture } = seeded;
          const reader = makeSignedCurrentStateReader(fixture, coordinator);
          const heldSigner = deferred();
          const signerStarted = deferred();
          const signer = makeTestSigner({
            onIssue: async () => {
              signerStarted.resolve();
              return heldSigner.promise;
            },
          });
          const activeIssue = makeCoreHarness(context, coordinator, {
            fixture,
            currentStateReader: reader,
            signer,
          });
          const issuePromise = issueRuntimeConfigFreshness(
            activeIssue.input,
            activeIssue.dependencies,
          );
          await withTimeout(
            signerStarted.promise,
            RPC_TIMEOUT_MS,
            "active Release-race signer start",
          );

          const intent = await startReleaseIntent(coordinator, fixture);
          assert.equal(intent.started.status, "WAITING_FOR_ISSUES");
          const waiting = await rpc(
            coordinator.stageReleaseManifest({
              operationId: intent.operationId,
              fencingToken: intent.fencingToken,
            }),
            "keep R2 publication behind the active issue",
          );
          assert.equal(waiting.status, "WAITING_FOR_ISSUES");

          const blockedSigner = makeTestSigner({ responseBytes: fixture.responseBytes });
          const blockedIssue = makeCoreHarness(context, coordinator, {
            fixture,
            currentStateReader: reader,
            signer: blockedSigner,
          });
          const blockedResult = await rpc(
            issueRuntimeConfigFreshness(
              blockedIssue.input,
              blockedIssue.dependencies,
            ),
            "reject new Freshness admission behind the Release writer",
          );
          assert.equal(blockedResult.status, "REJECTED");
          assert.equal(blockedSigner.calls, 0);

          heldSigner.resolve(await signer.completedResult(signer.lastRequest));
          const terminalIssue = await rpc(
            issuePromise,
            "finish the in-flight issue under the Release writer fence",
          );
          assert.equal(terminalIssue.status, "REJECTED");
          assert.equal(signer.calls, 1);
          const staged = await stageReleaseIntent(coordinator, intent);
          const appended = await appendReleaseIntent(coordinator, staged);
          assert.equal(appended.appended.status, "LEDGER_COMMITTED");
          const finalized = await finalizeReleaseIntent(coordinator, appended);
          assert.equal(finalized.finalized.status, "AVAILABLE");
        },
      );

    },
  );
}

async function buildWorker(context) {
  context.workerBundle = resolve(context.root, "freshness-coordinator-worker.mjs");
  await withTimeout(
    build({
      entryPoints: [WORKER_SOURCE],
      outfile: context.workerBundle,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      external: ["cloudflare:workers"],
      logLevel: "silent",
    }),
    30_000,
    "local coordinator Worker bundle",
  );
}

async function startRuntime(context) {
  const compatibilityDate = context.compatibilityDate;
  assert.ok(compatibilityDate);
  const options = convertV4MiniflareOptions({
    rootPath: context.root,
    host: "127.0.0.1",
    port: 0,
    https: false,
    resourcePersistencePath: resolve(context.root, "persistent"),
    isolatedResourcePersistencePath: resolve(context.root, "isolated"),
    resourceTmpPath: resolve(context.root, "resource-tmp"),
    telemetry: { enabled: false },
    workers: [
      {
        name: WORKER_NAME,
        scriptPath: context.workerBundle,
        modules: true,
        compatibilityDate,
        compatibilityFlags: [],
        unsafeEphemeralDurableObjects: false,
        durableObjects: {
          [BINDING_NAME]: {
            className: CLASS_NAME,
            scriptName: WORKER_NAME,
            unsafeUniqueKey: "fusou-freshness-coordinator-local-runtime-v1",
            useSQLite: true,
          },
        },
      },
      {
        name: RELEASE_WORKER_NAME,
        scriptPath: context.workerBundle,
        modules: true,
        compatibilityDate,
        compatibilityFlags: [],
        bindings: {
          RELEASE_LEDGER_CHAIN_ID: "test-release-chain-v1",
          FRESHNESS_MANIFEST_URL: vector.manifest_url,
          RELEASE_LEDGER_ROOT_KEY_ID:
            context.signedReleaseFixture.rootSigner.key_id,
          RELEASE_LEDGER_ROOT_PUBLIC_KEY_SPKI:
            context.signedReleaseFixture.rootSigner.public_key_spki,
          RELEASE_LEDGER_MANIFEST_KEY_ID:
            context.signedReleaseFixture.manifestRootSigner.key_id,
          RELEASE_LEDGER_MANIFEST_PUBLIC_KEY_SPKI:
            context.signedReleaseFixture.manifestRootSigner.public_key_spki,
        },
        r2Buckets: {
          RELEASE_LEDGER_R2: RELEASE_R2_BUCKET_NAME,
        },
        unsafeEphemeralDurableObjects: false,
        durableObjects: {
          [BINDING_NAME]: {
            className: RELEASE_CLASS_NAME,
            scriptName: RELEASE_WORKER_NAME,
            unsafeUniqueKey: "fusou-release-ledger-local-runtime-v1",
            useSQLite: true,
          },
        },
      },
    ],
  });
  const configuredWorker = options.workers.find(
    (worker) => worker.config.name === WORKER_NAME,
  )?.config;
  assert.ok(configuredWorker, "Miniflare did not configure the local DO Worker");
  assert.equal(configuredWorker.compatibilityDate, compatibilityDate);
  assert.deepEqual(configuredWorker.compatibilityFlags, []);
  const configuredReleaseWorker = options.workers.find(
    (worker) => worker.config.name === RELEASE_WORKER_NAME,
  )?.config;
  assert.ok(
    configuredReleaseWorker,
    "Miniflare did not configure the local Release ledger Worker",
  );
  assert.equal(configuredReleaseWorker.compatibilityDate, compatibilityDate);
  assert.deepEqual(configuredReleaseWorker.compatibilityFlags, []);

  const runtime = new Miniflare(options);
  context.currentRuntime = runtime;
  const readyUrl = await withTimeout(
    runtime.ready,
    30_000,
    "Miniflare/workerd startup",
  );
  assert.equal(readyUrl.protocol, "http:");
  assert.equal(readyUrl.hostname, "127.0.0.1");
  assert.ok(Number(readyUrl.port) > 0);
  context.namespace = await withTimeout(
    runtime.getDurableObjectNamespace(BINDING_NAME, WORKER_NAME),
    8_000,
    "local DO namespace readiness",
  );
  context.releaseNamespace = await withTimeout(
    runtime.getDurableObjectNamespace(BINDING_NAME, RELEASE_WORKER_NAME),
    8_000,
    "local Release ledger DO namespace readiness",
  );
  const worker = await runtime.getWorker(WORKER_NAME);
  const response = await withTimeout(
    worker.fetch(new Request("http://runtime-test.local/ready")),
    8_000,
    "Worker runtime readiness request",
  );
  assert.equal(response.status, 404);
}

async function restartRuntime(context) {
  await disposeCurrentRuntime(context);
  await startRuntime(context);
}

async function disposeCurrentRuntime(context) {
  const runtime = context.currentRuntime;
  if (!runtime) return;
  context.currentRuntime = undefined;
  context.namespace = undefined;
  context.releaseNamespace = undefined;
  await withTimeout(
    runtime.dispose(),
    RUNTIME_DISPOSE_TIMEOUT_MS,
    "Miniflare/workerd disposal",
  );
}

async function cleanupRuntime(context) {
  if (context.cleanupPromise) return context.cleanupPromise;
  context.cleanupPromise = (async () => {
    const failures = [];
    try {
      await disposeCurrentRuntime(context);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Freshness coordinator runtime cleanup failed");
    }
  })();
  return context.cleanupPromise;
}

async function seededCoordinator(
  context,
  scenario,
  fixture = context.fixture,
  namespace = context.namespace,
) {
  const objectName = `${scenario}-${randomUUID()}`;
  const { stub, coordinator } = coordinatorForName(
    context,
    objectName,
    undefined,
    namespace,
  );
  await rpc(
    stub.bootstrapLocalTestState({
      environment: "production",
      currentState: fixture.currentState,
      witness: fixture.witness,
      clock: {
        clockId,
        clockEpoch,
        nowMs: vector.now_ms,
        uncertaintyMs: 0,
      },
    }),
    `bootstrap ${scenario} DO`,
  );
  return {
    objectName,
    objectId: context.namespace.idFromName(objectName).toString(),
    stub,
    coordinator,
  };
}

async function seededReleaseCoordinator(context, scenario) {
  assert.ok(context.releaseNamespace, "Release ledger namespace is unavailable");
  const objectName = `${scenario}-${randomUUID()}`;
  const { stub, coordinator } = coordinatorForName(
    context,
    objectName,
    undefined,
    context.releaseNamespace,
  );
  const clearedPointer = await rpc(
    stub.attemptClearReleasePointerForLocalTest(),
    `clear ${scenario} test R2 pointer`,
  );
  assert.equal(
    clearedPointer.status,
    "RETURNED",
    clearedPointer.status === "THREW"
      ? `${clearedPointer.errorName}: ${clearedPointer.errorMessage}`
      : undefined,
  );
  const manifestEpoch = String(++localManifestEpochSequence);
  const template = await makeSignedCurrentStateFixture({ manifestEpoch });
  const baselinePublication = await rpc(
    stub.publishBaselineManifestForLocalTest(
      template.manifestRef,
      template.manifestBytes,
    ),
    `publish ${scenario} baseline Manifest`,
  );
  const fixture = await makeSignedCurrentStateFixture({
    manifestEpoch,
    pointerEtag: baselinePublication.pointerEtag,
  });
  assert.ok(equalBytes(fixture.manifestBytes, baselinePublication.pointerBytes));
  assert.ok(equalBytes(fixture.manifestBytes, baselinePublication.snapshotBytes));
  await rpc(
    stub.bootstrapLocalTestState({
      environment: "production",
      currentState: fixture.currentState,
      witness: fixture.witness,
      clock: {
        clockId,
        clockEpoch,
        nowMs: vector.now_ms,
        uncertaintyMs: 0,
      },
    }),
    `bootstrap ${scenario} DO`,
  );
  await rpc(
    stub.bootstrapReleaseLedgerForLocalTest({
      operationId: randomUUID(),
      requestSha256: digest(
        new TextEncoder().encode(`test-ledger-anchor:${scenario}`),
      ),
      chainId: fixture.releaseHead.chainId,
      head: fixture.releaseHead,
    }),
    `bootstrap ${scenario} Release ledger anchor`,
  );
  return {
    objectName,
    objectId: context.releaseNamespace.idFromName(objectName).toString(),
    stub,
    coordinator,
    fixture,
  };
}

async function seededInitialReleaseCoordinator(context, scenario) {
  assert.ok(context.releaseNamespace, "Release ledger namespace is unavailable");
  const objectName = `${scenario}-${randomUUID()}`;
  const { stub, coordinator } = coordinatorForName(
    context,
    objectName,
    undefined,
    context.releaseNamespace,
  );
  await rpc(
    stub.attemptClearReleasePointerForLocalTest(),
    `clear ${scenario} initial test pointer`,
  );
  const manifestEpoch = String(++localManifestEpochSequence);
  const template = await makeSignedCurrentStateFixture({ manifestEpoch });
  const publication = await rpc(
    stub.publishBaselineManifestForLocalTest(
      template.manifestRef,
      template.manifestBytes,
    ),
    `publish ${scenario} explicit test checkpoint`,
  );
  const fixture = await makeSignedCurrentStateFixture({
    manifestEpoch,
    pointerEtag: publication.pointerEtag,
  });
  assert.ok(equalBytes(fixture.manifestBytes, publication.pointerBytes));
  assert.ok(equalBytes(fixture.manifestBytes, publication.snapshotBytes));
  const releaseOperationId = randomUUID();
  const clock = {
    clockId,
    clockEpoch,
    nowMs: vector.now_ms,
    uncertaintyMs: 0,
  };
  await rpc(
    stub.bootstrapInitialReleaseCheckpointForLocalTest({
      operationId: releaseOperationId,
      requestSha256: digest(
        new TextEncoder().encode(`test-initial-release:${scenario}`),
      ),
      chainId: fixture.releaseHead.chainId,
      head: fixture.releaseHead,
      restoreEpoch: clockEpoch,
      clock,
    }),
    `seed ${scenario} initial Release checkpoint without current-state binding`,
  );
  return {
    objectName,
    objectId: context.releaseNamespace.idFromName(objectName).toString(),
    stub,
    coordinator,
    fixture,
    releaseOperationId,
    clock,
  };
}

async function seededCloudflareOperatorCoordinator(
  context,
  scenario,
  { install = true, delegatedManifest = false } = {},
) {
  assert.ok(context.releaseNamespace, "Release ledger namespace is unavailable");
  const objectName = `${scenario}-${randomUUID()}`;
  const { stub, coordinator } = coordinatorForName(
    context,
    objectName,
    undefined,
    context.releaseNamespace,
  );
  const clearedPointer = await rpc(
    stub.attemptClearReleasePointerForLocalTest(),
    `clear ${scenario} initial test pointer`,
  );
  assert.equal(
    clearedPointer.status,
    "RETURNED",
    clearedPointer.status === "THREW"
      ? `${clearedPointer.errorName}: ${clearedPointer.errorMessage}`
      : undefined,
  );

  const nowMs = Date.now();
  const manifestEpoch = String(++localManifestEpochSequence);
  const template = await makeSignedCurrentStateFixture({
    manifestEpoch,
    nowMs,
    delegatedManifest,
  });
  const publication = await rpc(
    stub.publishBaselineManifestForLocalTest(
      template.manifestRef,
      template.manifestBytes,
    ),
    `publish ${scenario} explicit local checkpoint`,
  );
  const fixture = await makeSignedCurrentStateFixture({
    manifestEpoch,
    nowMs,
    pointerEtag: publication.pointerEtag,
    delegatedManifest,
  });
  assert.ok(equalBytes(fixture.manifestBytes, publication.pointerBytes));
  assert.ok(equalBytes(fixture.manifestBytes, publication.snapshotBytes));

  const releaseOperationId = randomUUID();
  const restoreEpoch = `local-test-${randomUUID()}`;
  const clock = {
    clockId,
    clockEpoch: restoreEpoch,
    nowMs,
    uncertaintyMs: 0,
  };
  const bootstrapSeed = {
    operationId: releaseOperationId,
    requestSha256: digest(
      new TextEncoder().encode(`test-cloudflare-operator:${scenario}`),
    ),
    chainId: fixture.releaseHead.chainId,
    head: fixture.releaseHead,
    restoreEpoch,
    clock,
  };
  await rpc(
    stub.bootstrapCloudflareOperatorProfileForLocalTest(bootstrapSeed),
    `seed ${scenario} explicit Cloudflare/operator test checkpoint`,
  );
  if (install) {
    const installOperationId = randomUUID();
    const started = await rpc(
      coordinator.beginCloudflareOperatorBindingInstall({
        operationId: installOperationId,
        mode: "BOOTSTRAP",
        releaseOperationId,
        expectedCurrentStateSha256: null,
        expectedRestoreEpoch: restoreEpoch,
      }),
      `begin ${scenario} operator-profile binding install`,
    );
    assert.equal(started.status, "STARTED");
    const installed = await rpc(
      coordinator.finalizeCloudflareOperatorBindingInstall({
        operationId: installOperationId,
      }),
      `finalize ${scenario} operator-profile binding install`,
    );
    assert.equal(installed.status, "INSTALLED");
  }

  return {
    objectName,
    objectId: context.releaseNamespace.idFromName(objectName).toString(),
    stub,
    coordinator,
    fixture,
    releaseOperationId,
    restoreEpoch,
    bootstrapSeed,
  };
}

async function prepareReleaseBindingInstall(
  context,
  coordinator,
  fixture,
  {
    installOperationId = randomUUID(),
    releaseOperationId,
    mode,
    expectedCurrentStateSha256,
    expectedRestoreEpoch = clockEpoch,
    clock,
    proofContextOverrides = {},
    manifestsOverride,
    readerOverrides,
  },
) {
  const started = await rpc(
    coordinator.beginReleaseBindingInstall({
      operationId: installOperationId,
      mode,
      releaseOperationId,
      expectedCurrentStateSha256,
      expectedRestoreEpoch,
    }),
    `begin ${mode.toLowerCase()} current-state binding install`,
  );
  if (started.status !== "STARTED") return { started };
  const operation = started.operation;
  const proofContext = await createFreshnessCurrentStateInstallProofContext({
    mode,
    environment: "production",
    chainId: fixture.releaseHead.chainId,
    installOperationId,
    installFencingToken: operation.installFencingToken,
    releaseOperationId,
    releaseFencingToken: operation.releaseFencingToken,
    targetPosition: operation.targetPosition,
    targetGeneration: operation.targetGeneration,
    targetRecordSha256: operation.targetRecordSha256,
    expectedRestoreEpoch,
    expectedCurrentStateSha256,
    clock,
    ...proofContextOverrides,
  });
  const manifests = manifestsOverride ??
    await runtimeR2ManifestReader(context);
  const reader = makeSignedReleaseStateReader(
    fixture,
    manifests,
    readerOverrides,
  );
  const evidence = await reader.readReleaseState(proofContext);
  const verifiedState = await reader.verifyReleaseState(evidence, proofContext);
  return {
    started,
    proofContext,
    evidence,
    verifiedState,
    reader,
  };
}

async function runtimeR2ManifestReader(context) {
  const runtime = context.currentRuntime;
  assert.ok(runtime, "Miniflare runtime is unavailable");
  const bucket = await runtime.getR2Bucket(
    "RELEASE_LEDGER_R2",
    RELEASE_WORKER_NAME,
  );
  return {
    async readCurrentManifestPointer() {
      const getCall = bucket.get(RUNTIME_CONFIG_MANIFEST_POINTER_KEY);
      let object = null;
      try {
        object = await getCall;
        if (object === null) return null;
        return {
          etag: object.etag,
          bytes: new Uint8Array(await object.arrayBuffer()),
        };
      } finally {
        disposeRuntimeRpcResult(object);
        disposeRuntimeRpcResult(getCall);
      }
    },
    async readImmutableManifestSnapshot(reference) {
      const getCall = bucket.get(reference);
      let object = null;
      try {
        object = await getCall;
        if (object === null) return null;
        return {
          reference,
          bytes: new Uint8Array(await object.arrayBuffer()),
        };
      } finally {
        disposeRuntimeRpcResult(object);
        disposeRuntimeRpcResult(getCall);
      }
    },
  };
}

function disposeRuntimeRpcResult(value) {
  if (value == null) return;
  const dispose = Reflect.get(value, Symbol.dispose);
  if (typeof dispose === "function") {
    Reflect.apply(dispose, value, []);
  }
}

async function startReleaseIntent(
  coordinator,
  previousFixture,
  {
    operationId = randomUUID(),
    manifestEpoch = "2",
    nowMs,
    releaseDelegationNotAfterMs,
  } = {},
) {
  const baseline = await rpc(
    coordinator.readReleaseLedgerHead(),
    "read Release ledger predecessor",
  );
  assert.ok(baseline);
  const nextFixture = await makeSignedCurrentStateFixture({
    manifestEpoch,
    previousReleaseHead: previousFixture.releaseHead,
    nowMs,
    releaseDelegationNotAfterMs,
  });
  const started = await rpc(
    coordinator.beginReleaseOperation({
      operationId,
      expectedHead: baseline,
      manifestBytes: nextFixture.manifestBytes,
    }),
    "begin Release compare-and-append",
  );
  assert.ok(started.operation.fencingToken);
  return {
    baseline,
    nextFixture,
    operationId,
    started,
    fencingToken: started.operation.fencingToken,
    previousFixture,
    releaseDelegationNotAfterMs,
  };
}

async function stageReleaseIntent(coordinator, intent) {
  const staged = await rpc(
    coordinator.stageReleaseManifest({
      operationId: intent.operationId,
      fencingToken: intent.fencingToken,
    }),
    "stage and read back Release Manifest",
  );
  assert.equal(staged.status, "R2_STAGED");
  const committedFixture = await makeSignedCurrentStateFixture({
    manifestEpoch: intent.nextFixture.manifestEpoch,
    pointerEtag: staged.operation.pointerEtag,
    previousReleaseHead: intent.previousFixture.releaseHead,
    nowMs: intent.nextFixture.nowMs,
    releaseDelegationNotAfterMs: intent.releaseDelegationNotAfterMs,
  });
  assert.ok(equalBytes(
    committedFixture.manifestBytes,
    intent.nextFixture.manifestBytes,
  ));
  return { ...intent, staged, committedFixture };
}

async function appendReleaseIntent(coordinator, intent) {
  const appended = await rpc(
    coordinator.appendReleaseRecord({
      operationId: intent.operationId,
      fencingToken: intent.fencingToken,
      recordBytes: intent.committedFixture.recordBytes,
      releaseDelegationBytes: intent.committedFixture.releaseDelegationBytes,
    }),
    "append exact signed Release Record",
  );
  return { ...intent, appended };
}

async function finalizeReleaseIntent(coordinator, intent) {
  const finalized = await rpc(
    coordinator.finalizeReleaseR2Readback({
      operationId: intent.operationId,
      fencingToken: intent.fencingToken,
    }),
    "finalize Release after exact R2 readback",
  );
  return { ...intent, finalized };
}

function coordinatorForName(
  context,
  objectName,
  objectId,
  namespace = context.namespace,
) {
  assert.ok(namespace, "Freshness coordinator namespace is unavailable");
  const id = objectId === undefined
    ? namespace.idFromName(objectName)
    : namespace.idFromString(objectId);
  const workerName = namespace === context.releaseNamespace
    ? RELEASE_WORKER_NAME : WORKER_NAME;
  const worker = context.currentRuntime.getWorker(workerName);
  const stub = new Proxy({}, {
    get(_target, method) {
      if (typeof method !== "string" || method === "then") return undefined;
      return async (...args) => {
        const body = JSON.stringify({
          id: id.toString(), method, args: encodeRuntimeRpcValue(args),
        });
        assert.ok(Buffer.byteLength(body) <= MAX_RUNTIME_RPC_REQUEST_BYTES);
        const response = await (await worker).fetch(
          `http://runtime-test.local${RUNTIME_RPC_PATH}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body },
        );
        assert.equal(response.status, 200, "test-only RPC transport rejected the call");
        const outcome = await response.json();
        if (!outcome.ok) {
          const error = new Error(outcome.error.message);
          error.name = outcome.error.name;
          throw error;
        }
        return decodeRuntimeRpcValue(outcome.result);
      };
    },
  });
  return {
    stub,
    coordinator: new DurableObjectFreshnessIssueCoordinatorAdapter(stub),
  };
}

function makeCoreHarness(context, coordinator, options = {}) {
  const fixture = options.fixture ?? context.fixture;
  const signer = options.signer ?? makeTestSigner(
    fixture.responseBytes === undefined
      ? {}
      : { responseBytes: fixture.responseBytes },
  );
  return {
    signer,
    dependencies: {
      manifestUrl: vector.manifest_url,
      bootstrapSigner: fixture.rootSigner ?? rootSigner,
      coordinator,
      currentState:
        options.currentStateReader ??
        makeCurrentStateReader(fixture.evidence),
      signer,
    },
    input: {
      operationId: options.operationId ?? randomUUID(),
      requestBytes: options.requestBytes ?? requestBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  };
}

async function makeCloudflareOperatorHarness(context, seeded) {
  const fixture = seeded.fixture;
  const privateKey = await webcrypto.subtle.importKey(
    "pkcs8",
    fixture.freshnessPrivateKeyPkcs8Bytes,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const stateReader = createCloudflareOperatorReleaseStateReader({
    coordinator: seeded.coordinator,
    manifests: await runtimeR2ManifestReader(context),
    releaseRootSigner: fixture.rootSigner,
    manifestRootSigner: fixture.manifestRootSigner,
    manifestUrl: fixture.manifestUrl,
  });
  const signer = await createWorkerReadableCloudflareOperatorFreshnessSigner({
    manifestUrl: vector.manifest_url,
    environment: "production",
    chainId: fixture.releaseHead.chainId,
    bootstrapSigner: fixture.rootSigner,
    coordinator: seeded.coordinator,
    key: {
      keyId: fixture.freshnessKeyId,
      privateKey,
      freshnessDelegationBytes: fixture.freshnessDelegationBytes,
    },
    stateReader,
  });
  return {
    coordinator: seeded.coordinator,
    fixture,
    privateKey,
    signer,
    stateReader,
    dependencies: {
      manifestUrl: vector.manifest_url,
      chainId: fixture.releaseHead.chainId,
      bootstrapSigner: fixture.rootSigner,
      coordinator: seeded.coordinator,
      currentState: stateReader,
      signer,
    },
  };
}

async function admitCloudflareOperatorIssueForTest(
  harness,
  operationId,
  raw,
  description,
) {
  const identity = await makeRequestIdentity(operationId, raw);
  const admission = await rpc(
    harness.coordinator.beginCloudflareOperatorIssue({
      operationId,
      requestBytes: raw,
      requestSha256: identity.identity.requestSha256,
      challengeNonce: identity.challenge.request_nonce,
      audienceManifestUrlSha256:
        identity.challenge.audience_manifest_url_sha256,
      chainId: harness.fixture.releaseHead.chainId,
    }),
    description,
  );
  assert.equal(admission.status, "ACQUIRED");
  return { identity, admission };
}

function makeOperatorSigningRequest(
  operation,
  fencingToken,
  raw,
  identity,
  currentState,
) {
  return {
    operation: "ISSUE_LATEST_AT_ISSUANCE",
    profileId: operation.profileId,
    issue: operation,
    fencingToken,
    requestBytes: raw,
    challenge: identity.challenge,
    currentState,
  };
}

async function withFreshnessResponseSignatureCount(privateKey, operation) {
  let count = 0;
  const subtles = [...new Set(
    [webcrypto.subtle, globalThis.crypto?.subtle]
      .filter((subtle) => subtle !== undefined),
  )];
  const originals = subtles.map((subtle) => ({
    subtle,
    descriptor: Object.getOwnPropertyDescriptor(subtle, "sign"),
    original: subtle.sign,
  }));
  try {
    for (const entry of originals) {
      Object.defineProperty(entry.subtle, "sign", {
        configurable: true,
        writable: true,
        value: async function (...args) {
          if (args[1] === privateKey) count += 1;
          return Reflect.apply(entry.original, this, args);
        },
      });
    }
    await operation();
    return count;
  } finally {
    for (const entry of originals) {
      if (entry.descriptor === undefined) {
        delete entry.subtle.sign;
      } else {
        Object.defineProperty(entry.subtle, "sign", entry.descriptor);
      }
    }
  }
}

async function shortenFreshnessResponse(
  responseBytes,
  fixture,
  privateKey,
  lifetimeMs,
) {
  const envelope = JSON.parse(Buffer.from(responseBytes).toString("utf8"));
  const payload = JSON.parse(
    Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"),
  );
  payload.expires_at = new Date(Date.now() + lifetimeMs).toISOString();
  return signRuntimeConfigFreshnessResponseEnvelope({
    payload,
    signerKeyId: fixture.freshnessKeyId,
    privateKey,
    freshnessDelegationBytes: Buffer.from(
      envelope.freshness_delegation_base64url,
      "base64url",
    ),
    releaseDelegationBytes: Buffer.from(
      envelope.release_authority_delegation_base64url,
      "base64url",
    ),
    releaseRecordBytes: Buffer.from(
      envelope.release_commit_record_base64url,
      "base64url",
    ),
  });
}

function coordinatorWithOverrides(coordinator, overrides) {
  return {
    beginOrGet: (input) => coordinator.beginOrGet(input),
    getOperation: (input) =>
      overrides.getOperation
        ? overrides.getOperation(input)
        : coordinator.getOperation(input),
    readClock: () => coordinator.readClock(),
    checkLease: (lease) => coordinator.checkLease(lease),
    rejectBeforeSigner: (input) => coordinator.rejectBeforeSigner(input),
    rejectCompletedSigner: (input) =>
      coordinator.rejectCompletedSigner(input),
    markResultUnknown: (input) => coordinator.markResultUnknown(input),
    finalizeIfCurrent: (input) =>
      overrides.finalizeIfCurrent
        ? overrides.finalizeIfCurrent(input)
        : coordinator.finalizeIfCurrent(input),
  };
}

async function assertFinalizedBytes(
  stub,
  operationId,
  expectedBytes = responseBytes,
) {
  const snapshot = await rpc(
    stub.inspectOperationForLocalTest(operationId),
    "inspect finalized operation",
  );
  assert.equal(snapshot?.status, "FINALIZED");
  assert.equal(snapshot?.blocker, "CLEARED");
  assert.equal(snapshot?.responseLength, expectedBytes.byteLength);
  assert.equal(snapshot?.responseSha256, digest(expectedBytes));
  assert.ok(equalBytes(snapshot?.responseBytes, expectedBytes));
  assert.ok(snapshot?.finalizedAt);
}

function readLocalRuntimeConfig() {
  const source = readFileSync(LOCAL_CONFIG, "utf8");
  const compatibilityDate = source.match(
    /^compatibility_date\s*=\s*"([^"]+)"\s*$/m,
  )?.[1];
  assert.ok(compatibilityDate, "local-only Wrangler config needs compatibility_date");
  assert.match(source, /^main\s*=\s*"tests\/runtime\/worker\.ts"\s*$/m);
  assert.match(
    source,
    new RegExp(
      `^name\\s*=\\s*"fusou-freshness-coordinator-local-test"\\s*$`,
      "m",
    ),
  );
  assert.match(source, new RegExp(`^name\\s*=\\s*"${BINDING_NAME}"\\s*$`, "m"));
  assert.match(source, new RegExp(`^class_name\\s*=\\s*"${CLASS_NAME}"\\s*$`, "m"));
  assert.match(
    source,
    new RegExp(`^new_sqlite_classes\\s*=\\s*\\["${CLASS_NAME}"\\]\\s*$`, "m"),
  );

  const miniflareDirectory = realpathSync(
    resolve(PACKAGE_ROOT, "node_modules/miniflare"),
  );
  const workerdDirectory = realpathSync(resolve(miniflareDirectory, "../workerd"));
  const miniflareVersion = JSON.parse(
    readFileSync(resolve(miniflareDirectory, "package.json"), "utf8"),
  ).version;
  const workerdVersion = JSON.parse(
    readFileSync(resolve(workerdDirectory, "package.json"), "utf8"),
  ).version;
  console.log(
    `Runtime pins: Miniflare ${miniflareVersion}; workerd ${workerdVersion}; compatibility_date ${compatibilityDate}; flags []`,
  );
  return compatibilityDate;
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function changeBase64UrlDigest(value) {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

async function rpc(promise, description) {
  try {
    return await withTimeout(promise, RPC_TIMEOUT_MS, description);
  } finally {
    if (promise !== null && typeof promise === "object") {
      disposeRuntimeRpcResult(promise);
    }
  }
}

async function withTimeout(promise, timeoutMs, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${description} timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function superviseRuntimeTests() {
  const root = mkdtempSync(resolve(tmpdir(), "fusou-freshness-coordinator-"));
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--test", scriptPath],
    {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        [CHILD_ENV]: "1",
        [ROOT_ENV]: root,
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const rpcWarning = "An RPC stub was not disposed properly";
  let sawRpcWarning = false;
  for (const [source, destination] of [
    [child.stdout, process.stdout], [child.stderr, process.stderr],
  ]) {
    let tail = "";
    source.on("data", (chunk) => {
      destination.write(chunk);
      const text = tail + chunk.toString();
      if (text.includes(rpcWarning)) sawRpcWarning = true;
      tail = text.slice(-(rpcWarning.length - 1));
    });
  }
  const childOutputClosed = new Promise((resolvePromise) => {
    child.once("close", resolvePromise);
  });
  const childExit = new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) =>
      resolvePromise({ code, signal }),
    );
  });
  let requestedSignal;
  let timeoutHandle;
  let resolveStopRequest;
  const stopRequest = new Promise((resolvePromise) => {
    resolveStopRequest = resolvePromise;
  });
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (requestedSignal !== undefined) return;
      requestedSignal = signal;
      child.kill(signal);
      resolveStopRequest(signal);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  const timeout = new Promise((resolvePromise) => {
    timeoutHandle = setTimeout(
      () => resolvePromise({ kind: "timeout" }),
      TOTAL_TIMEOUT_MS,
    );
  });

  let result;
  let failure;
  try {
    const outcome = await Promise.race([
      childExit.then((exit) => ({ kind: "exit", exit })),
      stopRequest.then((signal) => ({ kind: "signal", signal })),
      timeout,
    ]);
    if (outcome.kind === "exit") {
      result = outcome.exit;
    } else {
      const signal =
        outcome.kind === "signal"
          ? outcome.signal
          : "SIGTERM";
      if (outcome.kind === "timeout") {
        console.error(`Runtime test exceeded ${TOTAL_TIMEOUT_MS} ms; stopping child`);
        child.kill(signal);
      }
      result = await waitForChildExit(childExit, CHILD_SHUTDOWN_GRACE_MS);
      if (result === null) {
        signalChildProcessGroup(child, "SIGKILL");
        result = await waitForChildExit(childExit, CHILD_SHUTDOWN_GRACE_MS);
      }
      if (result === null) {
        throw new Error("Runtime test child did not exit after SIGKILL");
      }
      if (outcome.kind === "timeout") {
        failure = new Error(`Runtime test exceeded ${TOTAL_TIMEOUT_MS} ms`);
      } else {
        result = { code: signal === "SIGINT" ? 130 : 143, signal };
      }
    }
  } catch (error) {
    failure = error;
    if (
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill("SIGTERM");
      const exit = await waitForChildExit(childExit, CHILD_SHUTDOWN_GRACE_MS);
      if (exit === null) {
        signalChildProcessGroup(child, "SIGKILL");
        const killed = await waitForChildExit(childExit, CHILD_SHUTDOWN_GRACE_MS);
        if (killed === null) {
          failure = new AggregateError(
            [error, new Error("Runtime test child remained alive after SIGKILL")],
            "Runtime test supervisor cleanup failed",
          );
        }
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    let processCleanupConfirmed = child.pid === undefined;
    if (child.pid !== undefined && process.platform !== "win32") {
      try {
        processCleanupConfirmed = await stopProcessGroup(
          child.pid,
          CHILD_SHUTDOWN_GRACE_MS,
        );
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError(
              [failure, cleanupError],
              "Runtime test process-group cleanup failed",
            )
          : cleanupError;
      }
    } else if (child.pid !== undefined) {
      processCleanupConfirmed =
        child.exitCode !== null || child.signalCode !== null;
    }

    let childExitConfirmed =
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null;
    if (!childExitConfirmed && child.pid !== undefined) {
      try {
        childExitConfirmed =
          (await waitForChildExit(childExit, CHILD_SHUTDOWN_GRACE_MS)) !== null;
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError(
              [failure, cleanupError],
              "Runtime test child exit could not be confirmed",
            )
          : cleanupError;
      }
    }

    if (processCleanupConfirmed && childExitConfirmed) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (cleanupError) {
        failure = failure
          ? new AggregateError(
              [failure, cleanupError],
              "Runtime test and temporary-directory cleanup failed",
            )
          : cleanupError;
      }
    } else {
      const cleanupError = new Error(
        `Runtime process cleanup was not confirmed; temporary root retained at ${root}`,
      );
      failure = failure
        ? new AggregateError([failure, cleanupError], "Runtime test cleanup failed")
        : cleanupError;
    }
  }

  try {
    await withTimeout(childOutputClosed, CHILD_SHUTDOWN_GRACE_MS, "runtime output closure");
  } catch (outputError) {
    failure = failure
      ? new AggregateError([failure, outputError], "Runtime test output did not close")
      : outputError;
  }
  if (sawRpcWarning && requestedSignal === undefined && !failure) {
    failure = new Error("Runtime tests leaked an RPC stub; see the forwarded warning above");
  }
  if (failure) throw failure;
  if (result?.code !== 0) {
    process.exitCode =
      typeof result?.code === "number"
        ? result.code
        : result?.signal === "SIGINT"
          ? 130
          : 1;
  }
}

function waitForChildExit(exitPromise, timeoutMs) {
  let timer;
  return Promise.race([
    exitPromise,
    new Promise((resolvePromise) => {
      timer = setTimeout(() => resolvePromise(null), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function signalChildProcessGroup(child, signal) {
  if (process.platform === "win32" || child.pid === undefined) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopProcessGroup(processGroupId, timeoutMs) {
  signalProcessGroup(processGroupId, "SIGTERM");
  if (await waitForProcessGroupExit(processGroupId, timeoutMs)) return true;
  signalProcessGroup(processGroupId, "SIGKILL");
  return waitForProcessGroupExit(processGroupId, timeoutMs);
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return true;
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}
