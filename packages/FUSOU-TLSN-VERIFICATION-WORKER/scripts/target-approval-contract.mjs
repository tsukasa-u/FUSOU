export const TARGET_APPROVAL_AUTHORITY = Object.freeze({
  status: "UNRESOLVED",
  owner: "UNKNOWN",
  evidence_contract: "UNRESOLVED",
  next_action: "A human must decide whether the repository-managed inventory/configuration or a separate approval process authorizes target selection, and define its owner, review, publication, integrity, and lifecycle. No active target-approval evidence contract exists; until then a valid target is UNAPPROVED.",
});

export function targetApprovalStatus(candidateStatus) {
  return candidateStatus === "PRESENT_UNVERIFIED" ? "UNAPPROVED" : candidateStatus;
}

export function assertTargetApprovalResolved() {
  if (TARGET_APPROVAL_AUTHORITY.status !== "RESOLVED" || TARGET_APPROVAL_AUTHORITY.owner === "UNKNOWN" || TARGET_APPROVAL_AUTHORITY.evidence_contract === "UNRESOLVED") {
    throw new Error("Target Approval Authority is unresolved; hostname configuration, deployment-manifest matching, and Origin inventory membership do not authorize deployment");
  }
}
