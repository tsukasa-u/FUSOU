import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rmdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withNativeLaunchBridge } from "./release-native-launch-bridge.mjs";
import { withNativeInspectionBudget } from "./release-native-resources.mjs";
import { nativeResourceFixtureBudget } from "./release-native-attestation-fixture.mjs";

for (const mode of ["success", "STOPPING", "REAPED", "TREE_EMPTY", "CAPTURE_COMPLETE", "CLEANUP_CONFIRMED",
  "cancel", "direct", "direct-cancel"]) {
  test(`Rust/Node Unix IPC (${mode.startsWith("direct") ? "direct synthetic, no tree guarantee" : "fake OS adapter"}): ${mode}`, async t => {
    const binary = process.env.FUSOU_NATIVE_BRIDGE_TEST_PEER;
    assert.ok(binary, "explicit compiled native unit-test harness is required; no production launcher");
    const directory = await mkdtemp(join(tmpdir(), "fusou-native-peer-")), path = join(directory, "wire");
    const server = createServer(); server.listen(path); await once(server, "listening");
    let channel, peer;
    t.after(async () => {
      channel?.destroy();
      if (peer?.exitCode === null && peer.signalCode === null) { peer.kill("SIGKILL"); await once(peer, "close"); }
      await new Promise(resolve => server.close(resolve)); await rmdir(directory);
    });
    const connected = once(server, "connection");
    peer = spawn(binary, ["--exact", "ipc_peer::serve", "--nocapture"], {
      env: { PATH: "/usr/bin:/bin", FUSOU_NATIVE_TEST_SOCKET: path, FUSOU_NATIVE_TEST_MODE: mode,
        FUSOU_SYNTHETIC_PROBE: process.env.FUSOU_SYNTHETIC_PROBE ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [peer.stdout, peer.stderr]) stream.on("data", bytes => {
      output += bytes.toString(); assert.ok(output.length <= 16384);
    });
    const closed = once(peer, "close");
    [channel] = await connected;
    const budget = nativeResourceFixtureBudget({ max_concurrent_operations: 1, timeout_ms: 2000,
      max_bytes: 256 * 1024 * 1024, max_reads: 16384 });
    const abort = new AbortController();
    const result = withNativeLaunchBridge({ resourceBudget: budget, signal: abort.signal, channel,
      cleanupTimeoutMs: 2000, reservation: { image: 64 * 1024 * 1024, input: 128 * 1024 * 1024, fds: 16384,
        execution: 1, capture: 1024 * 1024, stop: 4096, cleanup: 4096, reads: 16384, captures: 2 } });
    const observed = result.then(value => ({ value }), error => ({ error }));
    if (mode === "cancel" || mode === "direct-cancel") {
      abort.abort();
      assert.equal((await observed).error?.code, "NATIVE_RESOURCE_ABORTED");
    }
    const [exit, signal] = await closed;
    assert.equal(exit, 0, output); assert.equal(signal, null, output);
    const record = await observed;
    if (mode === "success") {
      assert.equal(record.value?.authenticated, false, output);
      assert.equal(record.value.state, "CLEANUP_CONFIRMED");
    } else if (mode !== "cancel" && mode !== "direct-cancel") {
      assert.equal(record.error?.code, "NATIVE_BRIDGE_QUARANTINED", output);
    }
    const next = withNativeInspectionBudget(budget, undefined, () => 1);
    if (mode === "success" || mode === "cancel") assert.equal(await next, 1);
    else await assert.rejects(next, { code: "NATIVE_RESOURCE_BUSY" });
  });
}
