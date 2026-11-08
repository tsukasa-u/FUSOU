import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  DurableObjectFreshnessIssueCoordinatorAdapter,
} from "../src/durable-object-adapter.ts";
import {
  clockEpoch,
  clockId,
  digest,
  equalBytes,
  makeCurrentStateReader,
  makeDifferentRequestBytes,
  makeRequestIdentity,
  makeTestSigner,
  makeVerifiedCurrentState,
  requestBytes,
  responseBytes,
  rootSigner,
  signedAtMs,
  vector,
  verifyFixtureResponse,
} from "../tests/runtime/fixtures.mjs";

const CHILD_ENV = "FUSOU_FRESHNESS_COORDINATOR_RUNTIME_TEST_CHILD";
const ROOT_ENV = "FUSOU_FRESHNESS_COORDINATOR_RUNTIME_TEST_ROOT";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_NAME = "fusou-freshness-coordinator-runtime-test";
const BINDING_NAME = "FRESHNESS_ISSUE_COORDINATOR";
const CLASS_NAME = "LocalTestFreshnessIssueCoordinatorDO";
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
    workerBundle: undefined,
    fixture: undefined,
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
        context.compatibilityDate = readLocalRuntimeConfig();
        await buildWorker(context);
        await startRuntime(context);
      });

      after(async () => {
        await cleanupRuntime(context);
      });

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
    ],
  });
  const configuredWorker = options.workers.find(
    (worker) => worker.config.name === WORKER_NAME,
  )?.config;
  assert.ok(configuredWorker, "Miniflare did not configure the local DO Worker");
  assert.equal(configuredWorker.compatibilityDate, compatibilityDate);
  assert.deepEqual(configuredWorker.compatibilityFlags, []);

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

async function seededCoordinator(context, scenario) {
  const objectName = `${scenario}-${randomUUID()}`;
  const { stub, coordinator } = coordinatorForName(context, objectName);
  await rpc(
    stub.bootstrapLocalTestState({
      environment: "production",
      currentState: context.fixture.currentState,
      witness: context.fixture.witness,
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

function coordinatorForName(context, objectName, objectId) {
  assert.ok(context.namespace, "Freshness coordinator namespace is unavailable");
  const id = objectId === undefined
    ? context.namespace.idFromName(objectName)
    : context.namespace.idFromString(objectId);
  const stub = context.namespace.get(id);
  return {
    stub,
    coordinator: new DurableObjectFreshnessIssueCoordinatorAdapter(stub),
  };
}

function makeCoreHarness(context, coordinator, options = {}) {
  const signer = options.signer ?? makeTestSigner();
  return {
    signer,
    dependencies: {
      manifestUrl: vector.manifest_url,
      bootstrapSigner: rootSigner,
      coordinator,
      currentState: makeCurrentStateReader(context.fixture.evidence),
      signer,
    },
    input: {
      operationId: options.operationId ?? randomUUID(),
      requestBytes: options.requestBytes ?? requestBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  };
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

async function assertFinalizedBytes(stub, operationId) {
  const snapshot = await rpc(
    stub.inspectOperationForLocalTest(operationId),
    "inspect finalized operation",
  );
  assert.equal(snapshot?.status, "FINALIZED");
  assert.equal(snapshot?.blocker, "CLEARED");
  assert.equal(snapshot?.responseLength, responseBytes.byteLength);
  assert.equal(snapshot?.responseSha256, digest(responseBytes));
  assert.ok(equalBytes(snapshot?.responseBytes, responseBytes));
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
  return withTimeout(promise, RPC_TIMEOUT_MS, description);
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
      stdio: "inherit",
    },
  );
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
