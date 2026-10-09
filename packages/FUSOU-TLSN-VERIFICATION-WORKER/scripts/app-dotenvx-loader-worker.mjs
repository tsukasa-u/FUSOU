import { parentPort, workerData } from "node:worker_threads";
import dotenvx from "@dotenvx/dotenvx";

try {
  const loaded = dotenvx.config({
    path: workerData.envFiles, envKeysFile: workerData.envKeysFile,
    processEnv: { ...workerData.publicEnvironment },
    overload: true, strict: true, quiet: true, opsOff: true,
  });
  parentPort.postMessage({
    public_inputs: Object.fromEntries(workerData.inputNames.map((name) => [name, loaded.parsed[name] ?? null])),
  });
} catch {
  parentPort.postMessage({ error: "canonical dotenvx loading/decryption failed" });
}
