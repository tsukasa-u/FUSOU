import { ArchiveCatalogError, createAuthorityCatalogReadback } from "./archive-catalog.mjs";
import { createArchiveOidcVerifier } from "./archive-oidc.mjs";
import { ArchiveReadbackError } from "./archive-readback.mjs";
import { ARCHIVE_HTTP_PATH, ArchiveTransportError, archiveAuthorization, archivePolicyBytes, archiveTransportGrant,
  assertCatalogGrant, boundedBody, encodeArchiveBytes, parseArchiveJson, transportRequire, validateArchiveTransportSpec } from "./archive-http-contract.mjs";

const verifyOidc = createArchiveOidcVerifier();
export async function handleArchiveHttp(request, { policyRaw, policySha256, authority, bucket },
  { verifyToken = verifyOidc, now = () => Date.now() } = {}) {
  const headers = { "cache-control": "no-store", "content-type": "application/json", "x-content-type-options": "nosniff" };
  try {
    transportRequire(typeof policyRaw === "string" && policyRaw.length <= 128 * 1024, "ARCHIVE_HTTP_POLICY_NOT_REGISTERED", 503);
    const spec = { policy: parseArchiveJson(new TextEncoder().encode(policyRaw)), policy_sha256: policySha256 };
    transportRequire(new TextDecoder().decode(archivePolicyBytes(spec.policy)) === policyRaw, "ARCHIVE_HTTP_POLICY_NONCANONICAL", 503);
    const policy = await validateArchiveTransportSpec(spec), url = new URL(request.url), nowMs = now();
    transportRequire(url.href === policy.endpoint && url.pathname === ARCHIVE_HTTP_PATH, "ARCHIVE_HTTP_ENDPOINT_MISMATCH", 400);
    const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
    transportRequire(bearer, "ARCHIVE_OIDC_TOKEN_MISSING", 401);
    const claims = await verifyToken(bearer, policy, nowMs);
    transportRequire(request.method === "POST", "ARCHIVE_HTTP_READ_ONLY_METHOD", 405);
    transportRequire(request.headers.get("content-type") === "application/json", "ARCHIVE_HTTP_CONTENT_TYPE_INVALID", 400);
    const input = parseArchiveJson(await boundedBody(request, 4096)), grant = archiveTransportGrant(policy, input, nowMs);
    transportRequire(claims.workflow_sha === grant.workflow_sha && claims.run_id === String(grant.run_id) &&
      claims.run_attempt === String(grant.run_attempt), "ARCHIVE_OIDC_EXECUTION_MISMATCH", 403);
    transportRequire(typeof bucket?.get === "function", "ARCHIVE_HTTP_BINDING_NOT_REGISTERED", 503);
    const backend = await createAuthorityCatalogReadback({ authority, captureId: grant.capture_id, sourceSha: grant.source_sha,
      lookup: grant.lookup, backendId: policy.endpoint, bucket: { get: async (key) => {
        let object;
        try { object = await bucket.get(key); } catch { throw new ArchiveTransportError("ARCHIVE_HTTP_READBACK_UNAVAILABLE", 502); }
        transportRequire(object && Number.isSafeInteger(object.size) && object.size > 0 && object.size <= policy.max_object_bytes,
          "ARCHIVE_HTTP_OBJECT_MISSING_OR_TOO_LARGE", 502);
        return { version: object.version, customMetadata: object.customMetadata, arrayBuffer: async () => {
          try { return await object.arrayBuffer(); }
          catch { throw new ArchiveTransportError("ARCHIVE_HTTP_READBACK_UNAVAILABLE", 502); }
        } };
      } } });
    assertCatalogGrant(backend.catalog, grant, policy, nowMs);
    let observed;
    try { observed = await backend.get({ role: input.role, object_key: backend.catalog.objects[input.role].object_key }); }
    catch (error) {
      if (!(error instanceof ArchiveCatalogError || error instanceof ArchiveReadbackError || error instanceof ArchiveTransportError)) throw error;
      throw new ArchiveTransportError("ARCHIVE_HTTP_READBACK_MISMATCH", 502);
    }
    return new Response(archivePolicyBytes({ schema_version: 1, scope: "fusou-archive-http-response-v1",
      authorization: archiveAuthorization(policy, spec.policy_sha256, input), observed_at_ms: nowMs,
      catalog: backend.catalog, bytes: encodeArchiveBytes(observed.bytes) }), { headers });
  } catch (error) {
    if (error instanceof ArchiveCatalogError) return new Response(JSON.stringify({ error: "ARCHIVE_HTTP_CATALOG_UNAVAILABLE" }), { status: 404, headers });
    if (!(error instanceof ArchiveTransportError)) throw error;
    return new Response(JSON.stringify({ error: error.code }), { status: error.status, headers });
  }
}
