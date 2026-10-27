import { createRemoteJWKSet, customFetch, decodeProtectedHeader, errors, jwtVerify } from "jose";
import { ArchiveTransportError, assertArchiveIdentityPolicy, boundedBody, GITHUB_OIDC_ISSUER, transportRequire } from "./archive-http-contract.mjs";
import { assertVerifiedArchiveOidcClaims } from "./archive-oidc-claims.mjs";

export const GITHUB_OIDC_JWKS = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
export function createArchiveOidcVerifier({ fetchKeys = fetch, cooldownDuration = 30_000 } = {}) {
  const keys = createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS), {
    timeoutDuration: 5000, cooldownDuration, cacheMaxAge: 600_000,
    [customFetch]: async (url, options) => {
      transportRequire(url === GITHUB_OIDC_JWKS, "ARCHIVE_OIDC_KEY_SOURCE_INVALID", 503);
      let response;
      try { response = await fetchKeys(url, { ...options, redirect: "error" }); }
      catch { throw new ArchiveTransportError("ARCHIVE_OIDC_KEYS_UNAVAILABLE", 503); }
      transportRequire(response.status === 200 && !response.redirected, "ARCHIVE_OIDC_KEYS_UNAVAILABLE", 503);
      return new Response(await boundedBody(response, 64 * 1024), { headers: { "content-type": "application/json" } });
    },
  });
  return async (token, policy, nowMs) => {
    assertArchiveIdentityPolicy(policy);
    transportRequire(typeof token === "string" && token.length <= 16_384, "ARCHIVE_OIDC_TOKEN_INVALID", 401);
    try {
      const header = decodeProtectedHeader(token);
      transportRequire(header.alg === "RS256" && typeof header.kid === "string" && header.kid.length > 0 && header.kid.length <= 256 &&
        (header.typ === undefined || header.typ === "JWT") && Object.keys(header).every((key) => ["alg", "kid", "typ"].includes(key)),
      "ARCHIVE_OIDC_HEADER_INVALID", 401);
      const { payload } = await jwtVerify(token, keys, { algorithms: ["RS256"], issuer: GITHUB_OIDC_ISSUER,
        audience: policy.audience, requiredClaims: ["exp", "iat", "repository", "repository_id", "repository_owner",
          "repository_owner_id", "workflow_ref", "workflow_sha", "event_name", "ref", "run_id", "run_attempt",
          ...(policy.job_workflow_ref === undefined ? [] : ["job_workflow_ref", "job_workflow_sha"])],
        currentDate: new Date(nowMs),
        clockTolerance: policy.clock_skew_seconds, maxTokenAge: policy.max_token_age_seconds });
      assertVerifiedArchiveOidcClaims(payload, policy, nowMs);
      return payload;
    } catch (error) {
      if (error instanceof errors.JOSEError) throw new ArchiveTransportError("ARCHIVE_OIDC_VERIFICATION_FAILED", 401);
      throw error;
    }
  };
}
