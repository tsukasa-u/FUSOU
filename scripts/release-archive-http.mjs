import { isDeepStrictEqual } from "node:util";
import { sha256 } from "./release-bytes.mjs";
import { requireRelease } from "./release-build-proof.mjs";
import { ArchiveTransportError, archiveReadRequest, archiveTransportGrant, boundedBody, parseArchiveJson,
  transportRequire, validateArchiveTransportSpec, verifyArchiveHttpResponse } from "../packages/FUSOU-TLSN-VERIFICATION-WORKER/src/archive-http-contract.mjs";

export async function requestActionsArchiveToken(audience, { environment = process.env, fetchToken = fetch } = {}) {
  const rawUrl = environment.ACTIONS_ID_TOKEN_REQUEST_URL, credential = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  transportRequire(rawUrl && credential, "ACTIONS_ARCHIVE_OIDC_CREDENTIALS_MISSING", 503);
  let url;
  try { url = new URL(rawUrl); } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ArchiveTransportError("ACTIONS_ARCHIVE_OIDC_URL_INVALID", 503);
  }
  transportRequire(url.protocol === "https:" && !url.username && !url.password && !url.hash &&
    url.hostname.endsWith(".actions.githubusercontent.com"), "ACTIONS_ARCHIVE_OIDC_URL_INVALID", 503);
  url.searchParams.set("audience", audience);
  let response;
  try { response = await fetchToken(url.href, { headers: { authorization: `Bearer ${credential}` }, redirect: "error",
    signal: AbortSignal.timeout(10_000) }); }
  catch { throw new ArchiveTransportError("ACTIONS_ARCHIVE_OIDC_REQUEST_FAILED", 502); }
  transportRequire(response.status === 200 && !response.redirected, "ACTIONS_ARCHIVE_OIDC_REQUEST_FAILED", 502);
  const token = parseArchiveJson(await boundedBody(response, 32 * 1024)).value;
  transportRequire(typeof token === "string" && token.length <= 16_384 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token),
    "ACTIONS_ARCHIVE_OIDC_RESPONSE_INVALID", 502);
  return token;
}

export async function acquireArchiveHttp({ spec, context, expected }, {
  getToken = (audience) => requestActionsArchiveToken(audience), fetchArchive = fetch, now = () => Date.now(),
} = {}) {
  const policy = await validateArchiveTransportSpec(spec), requests = new Map(), sourceBytes = new Map(), responses = new Map(), observations = new Map();
  for (const role of ["presentation", "result"]) {
    const request = archiveReadRequest(context, expected, role);
    archiveTransportGrant(policy, request, now()); requests.set(role, request);
  }
  const token = await getToken(policy.audience);
  transportRequire(typeof token === "string" && token.length <= 16_384 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token),
    "ACTIONS_ARCHIVE_OIDC_TOKEN_INVALID", 401);
  for (const [role, request] of requests) {
    let response;
    try { response = await fetchArchive(policy.endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`,
      "content-type": "application/json" }, body: JSON.stringify(request), redirect: "error", signal: AbortSignal.timeout(30_000) }); }
    catch { throw new ArchiveTransportError("ARCHIVE_HTTP_REQUEST_FAILED", 502); }
    transportRequire(response.status === 200 && !response.redirected &&
      response.headers.get("content-type")?.startsWith("application/json"), "ARCHIVE_HTTP_REQUEST_FAILED", 502);
    const raw = await boundedBody(response, Math.ceil(policy.max_object_bytes * 4 / 3) + 64 * 1024);
    const observation = await verifyArchiveHttpResponse(raw, { spec, policy, request, expected, nowMs: now() });
    observations.set(role, observation); sourceBytes.set(role, Buffer.from(observation.bytes)); responses.set(role, Buffer.from(raw));
  }
  return { sourceBytes, httpTransport: { spec, responses }, backend: { get: async (identity) => {
    const observed = observations.get(identity.role);
    requireRelease(observed && Object.entries(identity).every(([key, value]) => observed[key] === value),
      "HTTP archive capture independent identity mismatch");
    return { ...observed, bytes: Uint8Array.from(observed.bytes) };
  } } };
}

export async function verifyArchiveHttpExecution({ inputs, receipt, expected, spec, context, nowMs }) {
  const policy = await validateArchiveTransportSpec(spec), summaries = {}, catalogs = [];
  for (const role of ["presentation", "result"]) {
    const raw = inputs.get(`http_${role}`), request = archiveReadRequest(context, expected, role);
    requireRelease(raw instanceof Uint8Array, "HTTP archive raw response is missing");
    const observed = await verifyArchiveHttpResponse(raw, { spec, policy, request, expected, nowMs });
    requireRelease(Buffer.from(observed.bytes).equals(inputs.get(`readback_${role}`)), "HTTP archive response/readback bytes mismatch");
    summaries[role] = sha256(raw); catalogs.push(parseArchiveJson(raw).catalog);
  }
  requireRelease(isDeepStrictEqual(catalogs[0], catalogs[1]), "HTTP archive responses use different authority catalog snapshots");
  requireRelease(isDeepStrictEqual(receipt.output.transport, { kind: "TRUSTED_PRODUCER_HTTPS_FETCH",
    policy_sha256: spec.policy_sha256, responses_sha256: summaries }), "HTTP archive acquisition receipt/policy mismatch");
}
