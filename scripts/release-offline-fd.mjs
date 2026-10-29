import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";
import { requireRelease } from "./release-build-proof.mjs";
import { assertNativeResourceScope, parseNativeInspectionJson, withNativeInspectionBudgetSync } from "./release-native-resources.mjs";

export const FD_ABI_VERSION = 1;
export const FD_HEADER_BYTES = 48;
export const FD_ENTRY_BYTES = 64;
export const OFFLINE_FILE_FLAGS = Object.freeze({
  bundle: "--bundle", trusted_notary_registry: "--trusted-notary-registry",
  session_authority_registry: "--session-authority-registry", binding_authority_registry: "--binding-authority-registry",
  origin_inventory: "--origin-inventory", target_approval: "--target-approval", trust_anchor_der: "--trust-anchor-der",
});
export const OFFLINE_SCALAR_FLAGS = Object.freeze(["evidence-root-key-id", "evidence-root-public-key-spki",
  "session-authority-key-id", "session-authority-public-key-spki", "binding-authority-key-id",
  "binding-authority-public-key-spki", "canonical-user-id", "device-id", "device-public-key",
  "server-identity", "profile-sha256", "verifier-key-id"]);
export const OFFLINE_BUNDLE_ARTIFACTS = Object.freeze(["presentation", "result", "result_registry", "result_registry_envelope",
  "notary_registry", "health", "session", "authenticated_user", "device_identity", "device_authentication",
  "possession_proof", "consume_receipt", "replay", "session_authority_registry", "binding_authority_registry",
  "capture_metadata", "semantic_verification", "trust_root", "subject"]);
const externalRoles = Object.keys(OFFLINE_FILE_FLAGS).filter((role) => role !== "bundle").sort();
const limitKeys = ["max_frame_bytes", "max_entries", "max_entry_bytes", "max_json_bytes",
  "max_json_nodes", "max_json_depth", "max_string_bytes", "max_read_calls"];
const magic = Buffer.from("FUSOUFD\0"), inventoryDomain = Buffer.from("FUSOU-FD-INVENTORY-V1\0");
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength").get;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const digest = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) &&
  Buffer.from(value, "base64url").toString("base64url") === value;
const check = (condition, detail) => requireRelease(condition, `FD_ABI_V1 ${detail}`);
const add = (a, b) => { check(Number.isSafeInteger(a + b), "integer overflow"); return a + b; };
const align = (value) => add(value, (8 - value % 8) % 8);
const hash = (raw, scope) => { scope.charge(raw.byteLength); return createHash("sha256").update(raw).digest(); };
const key = (entry) => `${entry.kind}:${entry.role}`;
const ordered = (a, b) => a.kind - b.kind || (a.role < b.role ? -1 : a.role > b.role ? 1 : 0);

export function assertFdLimits(limits) {
  check(exact(limits, limitKeys) && limitKeys.every((name) =>
    Number.isSafeInteger(limits[name]) && limits[name] > 0) &&
    limits.max_entries <= 0xffffffff && limits.max_json_depth <= 64, "limits");
}
export function assertFdPolicy(policy) {
  check(exact(policy.fd_abi, ["schema_version", "limits", "verifier_build_sha256", "runtime_profile_sha256"]) &&
    policy.fd_abi.schema_version === 1 && digest(policy.fd_abi.verifier_build_sha256) &&
    digest(policy.fd_abi.runtime_profile_sha256), "profile identity");
  assertFdLimits(policy.fd_abi.limits);
}
function canonicalBytes(value, scope) {
  scope.object(value);
  return Buffer.from(canonicalJson(value));
}
function utf8(value, scope) {
  check(typeof value === "string", "metadata string");
  scope.object(value);
  const raw = Buffer.from(value);
  check(raw.toString("utf8") === value, "invalid Unicode");
  return raw;
}
function json(raw, limits, scope) {
  check(raw instanceof Uint8Array, "JSON bytes");
  check(raw.byteLength <= limits.max_json_bytes, "JSON byte limit");
  let depth = 0, nodes = 0;
  for (let i = 0; i < raw.length; i++) {
    scope.check();
    const c = raw[i];
    if (c === 34) {
      const start = ++i;
      for (; i < raw.length && raw[i] !== 34; i++) if (raw[i] === 92) i++;
      check(i < raw.length && i - start <= limits.max_string_bytes, "JSON string limit");
      nodes++;
    } else if (c === 91 || c === 123) {
      check(++depth <= limits.max_json_depth, "JSON depth limit"); nodes++;
    } else if (c === 93 || c === 125) {
      check(depth-- > 0, "JSON structure");
    } else if (![9, 10, 13, 32, 44, 58].includes(c)) {
      nodes++;
      while (i + 1 < raw.length && ![9, 10, 13, 32, 44, 58, 93, 125].includes(raw[i + 1])) i++;
    }
    check(nodes <= limits.max_json_nodes, "JSON node limit");
  }
  check(depth === 0, "JSON structure");
  const value = parseNativeInspectionJson(raw, scope), stack = [value];
  while (stack.length) {
    const item = stack.pop();
    if (typeof item === "string") check(utf8(item, scope).length <= limits.max_string_bytes, "decoded JSON string limit");
    else if (item && typeof item === "object") {
      for (const [name, child] of Object.entries(item)) {
        check(utf8(name, scope).length <= limits.max_string_bytes, "decoded JSON key limit");
        stack.push(child);
      }
    }
  }
  return value;
}
function validateControl(control) {
  check(exact(control, ["abi_version", "scope", "context", "options", "policy_sha256",
    "verifier_executable_sha256", "verifier_build_sha256", "runtime_profile_sha256"]) &&
    control.abi_version === 1 && control.scope === "fusou-offline-fd-input-v1" &&
    ["policy_sha256", "verifier_executable_sha256", "verifier_build_sha256", "runtime_profile_sha256"]
      .every((name) => digest(control[name])), "control");
  const c = control.context, options = control.options;
  check(exact(c, ["repository", "source_sha", "workflow_sha", "run_id", "run_attempt"]) &&
    c.repository === "tsukasa-u/FUSOU" &&
    [c.source_sha, c.workflow_sha].every((sha) => typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha)) &&
    [c.run_id, c.run_attempt].every((n) => Number.isSafeInteger(n) && n > 0), "context");
  const flags = [...OFFLINE_SCALAR_FLAGS];
  if (Object.hasOwn(options ?? {}, "sparse-profile-sha256")) flags.push("sparse-profile-sha256");
  check(exact(options, flags) && flags.every((name) => typeof options[name] === "string" && options[name].length > 0),
    "scalar options");
}
function validateEntries(entries, limits, scope) {
  const paths = new Map(), byRole = new Map();
  for (const entry of entries) {
    const path = entry.path;
    check(/^[a-z][a-z0-9_]*$/.test(entry.role) && path.length > 0 && !path.startsWith("/") &&
      !/[\\:\0]/.test(path) && path.split("/").every((part) => part && part !== "." && part !== ".."),
    "logical path/role");
    let tree = paths;
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i], last = i === parts.length - 1;
      check(last ? !tree.has(part) : tree.get(part) !== null, "logical path collision");
      if (last) tree.set(part, null);
      else { if (!tree.has(part)) tree.set(part, new Map()); tree = tree.get(part); }
    }
    check(!byRole.has(key(entry)), "duplicate entry"); byRole.set(key(entry), entry);
    check(entry.kind >= 0 && entry.kind <= 3, "unknown kind");
    if (entry.kind === 0) check(entry.role === "control" && path === "control.json", "control role");
    if (entry.kind === 1) check(entry.role === "bundle" && path === "bundle.input", "manifest role");
    if (entry.kind === 2) check(externalRoles.includes(entry.role) && path === `${entry.role}.input`, "external role");
  }
  const controlEntry = byRole.get("0:control"), manifestEntry = byRole.get("1:bundle");
  check(controlEntry && manifestEntry && externalRoles.every((role) => byRole.has(`2:${role}`)), "missing entry");
  const control = json(controlEntry.bytes, limits, scope), manifest = json(manifestEntry.bytes, limits, scope);
  validateControl(control);
  check(manifest && typeof manifest === "object" && !Array.isArray(manifest) &&
    manifest.artifacts && typeof manifest.artifacts === "object" && !Array.isArray(manifest.artifacts) &&
    OFFLINE_BUNDLE_ARTIFACTS.every((role) => Object.hasOwn(manifest.artifacts, role)), "required artifacts");
  check(entries.length === add(Object.keys(manifest.artifacts).length, 8), "artifact inventory");
  const artifactDescriptors = scope.recordEntries(manifest.artifacts);
  check(artifactDescriptors.length <= limits.max_entries - 8, "entry count limit");
  for (const [role, descriptor] of artifactDescriptors) {
    const entry = byRole.get(`3:${role}`);
    check(entry && descriptor && typeof descriptor === "object" && !Array.isArray(descriptor) &&
      descriptor.path === entry.path && descriptor.byte_length === entry.bytes.length &&
      digest(descriptor.artifact_sha256) && descriptor.artifact_sha256 === entry.sha256, "artifact descriptor");
  }
  for (const entry of entries) {
    if ((entry.kind === 2 && entry.role !== "trust_anchor_der") ||
      (entry.kind === 3 && OFFLINE_BUNDLE_ARTIFACTS.includes(entry.role) &&
        !["presentation", "trust_root"].includes(entry.role))) json(entry.bytes, limits, scope);
  }
  for (const [external, artifact] of [["trusted_notary_registry", "notary_registry"],
    ["session_authority_registry", "session_authority_registry"], ["binding_authority_registry", "binding_authority_registry"],
    ["trust_anchor_der", "trust_root"]]) {
    check(byRole.get(`2:${external}`).bytes.equals(byRole.get(`3:${artifact}`).bytes), "external/bundle bytes");
  }
  return control;
}
function integer(raw, offset) {
  const n = raw.readBigUInt64LE(offset);
  check(n <= BigInt(Number.MAX_SAFE_INTEGER), "integer overflow");
  return Number(n);
}
export function parseOfflineFdFrameInScope(raw, limits, scope) {
  assertNativeResourceScope(scope); assertFdLimits(limits);
  check(raw instanceof Uint8Array && byteLength.call(raw) <= limits.max_frame_bytes, "frame size limit");
  const frame = scope.copy(raw);
  check(frame.length >= FD_HEADER_BYTES && frame.subarray(0, 8).equals(magic) &&
    frame.readUInt16LE(8) === 1 && frame.readUInt16LE(10) === 0 && frame.readUInt32LE(12) === FD_HEADER_BYTES &&
    frame.readUInt32LE(20) === 0, "header/version/flags");
  const count = frame.readUInt32LE(16), tableLength = integer(frame, 24), total = integer(frame, 32);
  const payload = integer(frame, 40);
  check(count >= 27 && count <= limits.max_entries && total === frame.length &&
    payload === add(FD_HEADER_BYTES, tableLength) && payload <= total &&
    tableLength >= count * FD_ENTRY_BYTES, "count/table/total length");
  scope.collection(count);
  const entries = []; let cursor = FD_HEADER_BYTES, end = payload, previous;
  for (let i = 0; i < count; i++) {
    check(cursor + FD_ENTRY_BYTES <= payload, "truncated table");
    const kind = frame.readUInt16LE(cursor), roleLength = frame.readUInt32LE(cursor + 4), pathLength = frame.readUInt32LE(cursor + 8);
    check(frame.readUInt16LE(cursor + 2) === 0 && frame.readUInt32LE(cursor + 12) === 0 &&
      roleLength > 0 && pathLength > 0 && roleLength <= limits.max_string_bytes && pathLength <= limits.max_string_bytes,
    "entry flags/strings");
    const offset = integer(frame, cursor + 16), length = integer(frame, cursor + 24);
    check(length <= limits.max_entry_bytes && offset === end && add(offset, length) <= total, "entry range/length");
    const strings = add(cursor, FD_ENTRY_BYTES), stringsEnd = add(add(strings, roleLength), pathLength), next = align(stringsEnd);
    check(next <= payload, "table strings");
    const decode = (start, stop) => {
      try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(frame.subarray(start, stop)); }
      catch (error) { if (!(error instanceof TypeError)) throw error; check(false, "invalid metadata UTF-8"); }
    };
    const role = decode(strings, strings + roleLength), path = decode(strings + roleLength, stringsEnd);
    check(frame.subarray(stringsEnd, next).every((n) => n === 0), "table padding");
    const bytes = scope.copy(frame.subarray(offset, offset + length)), actual = hash(bytes, scope);
    check(actual.equals(frame.subarray(cursor + 32, cursor + 64)), "entry digest");
    const entry = { kind, role, path, offset, bytes, sha256: actual.toString("base64url") };
    check(!previous || ordered(previous, entry) < 0, "entry order/duplicate");
    entries.push(entry); previous = entry; cursor = next; end = offset + length;
  }
  check(cursor === payload && end === total, "table/payload trailing bytes");
  const control = validateEntries(entries, limits, scope);
  scope.charge(tableLength);
  const inventory = createHash("sha256").update(inventoryDomain).update(frame.subarray(FD_HEADER_BYTES, payload)).digest("base64url");
  const binding = { abi_version: 1, frame_sha256: hash(frame, scope).toString("base64url"), frame_byte_length: total,
    control_sha256: entries[0].sha256, inventory_sha256: inventory,
    verifier_build_sha256: control.verifier_build_sha256, runtime_profile_sha256: control.runtime_profile_sha256 };
  return { frame, entries, control, binding };
}
export function encodeOfflineFdFrameInScope({ context, policy, inputs }, scope) {
  assertNativeResourceScope(scope); assertFdPolicy(policy);
  const limits = policy.fd_abi.limits;
  const control = { abi_version: 1, scope: "fusou-offline-fd-input-v1", context, options: policy.options,
    policy_sha256: hash(canonicalBytes(policy, scope), scope).toString("base64url"),
    verifier_executable_sha256: policy.executable_sha256, verifier_build_sha256: policy.fd_abi.verifier_build_sha256,
    runtime_profile_sha256: policy.fd_abi.runtime_profile_sha256 };
  validateControl(control);
  const entries = [{ kind: 0, role: "control", path: "control.json", bytes: canonicalBytes(control, scope) },
    { kind: 1, role: "bundle", path: "bundle.input", bytes: inputs.get("bundle") }];
  const manifest = json(entries[1].bytes, limits, scope);
  check(manifest?.artifacts && typeof manifest.artifacts === "object" && !Array.isArray(manifest.artifacts), "manifest artifacts");
  const descriptors = scope.recordEntries(manifest.artifacts);
  check(descriptors.length <= limits.max_entries - 8, "entry count limit");
  for (const role of externalRoles) entries.push({ kind: 2, role, path: `${role}.input`, bytes: inputs.get(role) });
  for (const [role, descriptor] of descriptors) {
    entries.push({ kind: 3, role, path: descriptor.path, bytes: inputs.get(`bundle_artifact_${role}`) });
  }
  check(entries.length <= limits.max_entries, "entry count limit"); scope.collection(entries.length);
  entries.sort(ordered);
  let tableLength = 0, total = FD_HEADER_BYTES;
  for (const entry of entries) {
    check(entry.bytes instanceof Uint8Array && entry.bytes.length <= limits.max_entry_bytes, "entry size limit");
    entry.roleBytes = utf8(entry.role, scope); entry.pathBytes = utf8(entry.path, scope);
    check(entry.roleBytes.length > 0 && entry.roleBytes.length <= limits.max_string_bytes &&
      entry.pathBytes.length > 0 && entry.pathBytes.length <= limits.max_string_bytes, "metadata string limit");
    entry.sha256 = hash(entry.bytes, scope).toString("base64url");
    tableLength = add(tableLength, align(add(FD_ENTRY_BYTES, add(entry.roleBytes.length, entry.pathBytes.length))));
    total = add(total, entry.bytes.length);
  }
  validateEntries(entries, limits, scope);
  total = add(total, tableLength); check(total <= limits.max_frame_bytes, "frame size limit");
  const frame = scope.allocate(total); frame.fill(0); magic.copy(frame);
  frame.writeUInt16LE(1, 8); frame.writeUInt32LE(FD_HEADER_BYTES, 12); frame.writeUInt32LE(entries.length, 16);
  frame.writeBigUInt64LE(BigInt(tableLength), 24); frame.writeBigUInt64LE(BigInt(total), 32);
  let cursor = FD_HEADER_BYTES, payload = FD_HEADER_BYTES + tableLength;
  frame.writeBigUInt64LE(BigInt(payload), 40);
  for (const entry of entries) {
    frame.writeUInt16LE(entry.kind, cursor); frame.writeUInt32LE(entry.roleBytes.length, cursor + 4);
    frame.writeUInt32LE(entry.pathBytes.length, cursor + 8); frame.writeBigUInt64LE(BigInt(payload), cursor + 16);
    frame.writeBigUInt64LE(BigInt(entry.bytes.length), cursor + 24);
    Buffer.from(entry.sha256, "base64url").copy(frame, cursor + 32);
    entry.roleBytes.copy(frame, cursor + FD_ENTRY_BYTES);
    entry.pathBytes.copy(frame, cursor + FD_ENTRY_BYTES + entry.roleBytes.length);
    cursor += align(FD_ENTRY_BYTES + entry.roleBytes.length + entry.pathBytes.length);
    frame.set(entry.bytes, payload); payload += entry.bytes.length;
  }
  return parseOfflineFdFrameInScope(frame, limits, scope);
}
export function inspectOfflineFdFrame(raw, { limits, resourceBudget }) {
  return withNativeInspectionBudgetSync(resourceBudget, (scope) => {
    scope.object(limits);
    return parseOfflineFdFrameInScope(raw, structuredClone(limits), scope);
  });
}
