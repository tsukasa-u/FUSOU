import { assertArchiveIdentityPolicy, isCanonicalGitHubId, transportRequire } from "./archive-http-contract.mjs";

// Claims must come from jwtVerify; this assertion authenticates neither JWTs nor policy registration.
export function assertVerifiedArchiveOidcClaims(payload, policy, nowMs) {
  assertArchiveIdentityPolicy(policy);
  transportRequire(payload !== null && typeof payload === "object" && !Array.isArray(payload) &&
    payload.aud === policy.audience && payload.repository === policy.repository &&
    isCanonicalGitHubId(payload.repository_id) && payload.repository_id === policy.repository_id &&
    isCanonicalGitHubId(payload.repository_owner_id) && payload.repository_owner_id === policy.repository_owner_id &&
    payload.repository_owner === policy.repository.split("/")[0] &&
    payload.workflow_ref === policy.workflow_ref && payload.event_name === policy.event_name && payload.ref === policy.ref &&
    typeof payload.workflow_sha === "string" && /^[0-9a-f]{40}$/.test(payload.workflow_sha) &&
    typeof payload.run_id === "string" && /^[1-9][0-9]*$/.test(payload.run_id) &&
    typeof payload.run_attempt === "string" && /^[1-9][0-9]*$/.test(payload.run_attempt) &&
    Number.isSafeInteger(Number(payload.run_id)) && Number.isSafeInteger(Number(payload.run_attempt)) &&
    Number.isFinite(payload.iat) && Number.isFinite(payload.exp) && payload.exp > payload.iat &&
    payload.iat <= nowMs / 1000 + policy.clock_skew_seconds &&
    (policy.job_workflow_ref === undefined ||
      payload.job_workflow_ref === policy.job_workflow_ref && payload.job_workflow_sha === policy.job_workflow_sha),
  "ARCHIVE_OIDC_CLAIMS_INVALID", 401);
}
