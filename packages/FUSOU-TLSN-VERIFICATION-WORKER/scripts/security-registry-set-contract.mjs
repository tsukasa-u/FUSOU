import { createHash } from "node:crypto";
import { canonicalNotaryRegistryJson } from "./production-trust-contract.mjs";
import {
  canonicalJson,
  PROFILE_CONTRACT_SPEC,
  productionSecurityRegistrySetPayload,
  securityRegistrySetPayload as sharedSecurityRegistrySetPayload,
} from "../src/origin-trust-contract.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";
import { assertTargetApprovalResolved } from "./target-approval-contract.mjs";

export const SECURITY_REGISTRY_SET_CONTRACT = {
  schema_version: 2,
  source_of_truth: "scripts/security-registry-set-contract.mjs",
  roles: {
    canary: {
      schema_version: 1,
      canonicalization: "canonicalJson",
      encoding: "UTF-8",
      whitespace: "none",
      hash_algorithm: "SHA-256",
      digest_encoding: "base64url without padding",
      fields: ["notary_key_id", "notary_registry", "profile_sha256", "server_identity", "sparse_profile_sha256"],
      profile_hash_semantics: "supplied canonical profile hashes bound to this Canary deployment target",
    },
    production: {
      schema_version: 3,
      canonicalization: "canonicalJson",
      encoding: "UTF-8",
      whitespace: "none",
      hash_algorithm: "SHA-256",
      digest_encoding: "base64url without padding",
      fields: ["notary_key_id", "notary_registry", "origin_inventory_sha256", "target_approval_artifact_sha256", "profile_policy_sha256"],
      origin_inventory_semantics: "byte-level SHA-256 of the shipped 20-host HTTPS Origin inventory",
      profile_policy_semantics: "SHA-256 of the canonical complete/sparse profile policy; per-host profile hashes are derived at verification time",
    },
  },
  notary_key_id_semantics: "selected trust-anchor key ID; it must be present in the canonical Notary registry and is independently bound into the payload",
  notary_registry_semantics: "validated JSON object canonicalized with canonicalJson inside the security registry set payload; runtime receives the normalized registry string separately",
  exclusions: ["deployment_id", "response_mode", "worker_name", "signing keys", "private keys", "callback secrets", "access tokens"],
};

export function securityRegistrySetPayload(inputs = {}) {
  const canonicalNotaryRegistryRaw = canonicalNotaryRegistryJson(
    inputs.notaryRegistryRaw,
    "security registry set Notary registry",
  );
  return sharedSecurityRegistrySetPayload({ ...inputs, notaryRegistryRaw: canonicalNotaryRegistryRaw });
}

export function securityRegistrySetHash(inputs) {
  const payload = securityRegistrySetPayload(inputs);
  const canonical = canonicalJson(payload);
  return {
    payload,
    canonical,
    utf8_bytes: Buffer.from(canonical, "utf8"),
    sha256: createHash("sha256").update(canonical, "utf8").digest("base64url"),
  };
}

export function productionSecurityRegistrySetHash({ notaryKeyId, notaryRegistryRaw, targetApprovalArtifactSha256 } = {}) {
  const canonicalNotaryRegistryRaw = canonicalNotaryRegistryJson(
    notaryRegistryRaw,
    "Production security registry set Notary registry",
  );
  const originInventory = loadOriginInventoryContract();
  const targetApproval = assertTargetApprovalResolved();
  const profilePolicySha256 = createHash("sha256")
    .update(canonicalJson(PROFILE_CONTRACT_SPEC), "utf8")
    .digest("base64url");
  const payload = productionSecurityRegistrySetPayload({
    notaryKeyId,
    notaryRegistryRaw: canonicalNotaryRegistryRaw,
    originInventorySha256: originInventory.sha256,
    targetApprovalArtifactSha256: targetApprovalArtifactSha256 ?? targetApproval.approval_artifact_sha256,
    profilePolicySha256,
  });
  const canonical = canonicalJson(payload);
  return {
    payload,
    canonical,
    utf8_bytes: Buffer.from(canonical, "utf8"),
    sha256: createHash("sha256").update(canonical, "utf8").digest("base64url"),
  };
}