import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const inventoryPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../configs/tlsn-origin-inventory.json");
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function loadOriginInventoryContract() {
  const bytes = readFileSync(inventoryPath);
  let inventory;
  try {
    inventory = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("shipped Origin inventory must be valid JSON");
  }
  if (
    inventory?.schema_version !== 1 ||
    inventory?.source !== "packages/configs/configs.toml:[app.connect_kc_server.server_list]" ||
    !Array.isArray(inventory.targets) ||
    inventory.targets.length !== 20
  ) {
    throw new Error("shipped Origin inventory must contain exactly 20 schema-v1 targets");
  }
  const indices = new Set();
  const identities = new Set();
  for (const target of inventory.targets) {
    if (
      !Number.isSafeInteger(target?.server_index) ||
      target.port !== 443 ||
      typeof target.server_identity !== "string" ||
      !hostnamePattern.test(target.server_identity) ||
      target.server_identity !== target.server_identity.toLowerCase() ||
      indices.has(target.server_index) ||
      identities.has(target.server_identity)
    ) {
      throw new Error("shipped Origin inventory contains an invalid or duplicate target");
    }
    indices.add(target.server_index);
    identities.add(target.server_identity);
  }
  return {
    schema_version: 1,
    sha256: createHash("sha256").update(bytes).digest("base64url"),
    target_count: inventory.targets.length,
    port: 443,
  };
}