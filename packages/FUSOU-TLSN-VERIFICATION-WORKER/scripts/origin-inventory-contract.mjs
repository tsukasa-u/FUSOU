import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOriginInventory } from "../src/origin-trust-contract.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = resolve(packageRoot, "../configs/tlsn-origin-inventory.json");
const workerInventoryPath = resolve(packageRoot, "../configs/tlsn-origin-inventory.json.txt");

export function loadOriginInventoryContract() {
  const bytes = readFileSync(inventoryPath);
  const workerBytes = readFileSync(workerInventoryPath);
  if (!bytes.equals(workerBytes)) {
    throw new Error("Worker-bundled Origin inventory bytes do not match the canonical inventory");
  }
  const inventory = parseOriginInventory(bytes.toString("utf8"));
  return {
    schema_version: inventory.schema_version,
    sha256: createHash("sha256").update(bytes).digest("base64url"),
    target_count: inventory.targets.length,
    port: 443,
  };
}