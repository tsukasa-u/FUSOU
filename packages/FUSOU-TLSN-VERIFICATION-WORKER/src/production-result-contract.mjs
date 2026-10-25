import { assertCanonicalServerIdentity, parseOriginInventory, parseTargetApproval, sha256Base64Url } from "./origin-trust-contract.mjs";

const digest = /^[A-Za-z0-9_-]{43}$/;
export async function resolvePinnedProductionTargets({ inventoryRaw, approvalRaw, inventoryPin, approvalPin }) {
  if (!digest.test(inventoryPin ?? "") || !digest.test(approvalPin ?? "")) {
    throw new Error("independent Production Inventory/Target Approval pins are required");
  }
  const inventorySha256 = await sha256Base64Url(new TextEncoder().encode(inventoryRaw));
  const approvalSha256 = await sha256Base64Url(new TextEncoder().encode(approvalRaw));
  if (inventoryPin !== inventorySha256 || approvalPin !== approvalSha256) {
    throw new Error("Production target raw bytes do not match independent pins");
  }
  const inventory = parseOriginInventory(inventoryRaw);
  const approval = parseTargetApproval(approvalRaw, inventory, inventorySha256);
  return { inventorySha256, approvalSha256, targets: approval.targets };
}
export async function assertPreparedResultContract(result, {
  profile, serverIdentity, profileSha256, presentationBytes, production,
  inventorySha256 = null, approvalSha256 = null,
}) {
  if (profile !== "complete" && profile !== "sparse") throw new Error("unknown Result profile");
  if (production) assertCanonicalServerIdentity(serverIdentity);
  const sparse = profile === "sparse";
  if (!result || result.version !== (sparse ? 3 : 2) ||
      result.profile_id !== (sparse ? "fusou-require-info-v2-sparse" : "fusou-require-info-v1") ||
      result.profile_sha256 !== profileSha256 || result.server_identity !== serverIdentity ||
      (sparse ? result.disclosure_mode !== "sparse" ||
        Object.hasOwn(result, "request_transcript_sha256") || Object.hasOwn(result, "response_transcript_sha256") :
        Object.hasOwn(result, "disclosure_mode"))) {
    throw new Error("current Complete v2/Sparse v3 Result profile is required");
  }
  if (production && (!digest.test(inventorySha256 ?? "") || !digest.test(approvalSha256 ?? ""))) {
    throw new Error("Production Result requires both target digests");
  }
  if (result.presentation_sha256 !== await sha256Base64Url(presentationBytes) ||
      result.origin_inventory_sha256 !== inventorySha256 || result.target_approval_artifact_sha256 !== approvalSha256) {
    throw new Error("Result provenance does not match exact Presentation and target inputs");
  }
}
