import { createHash } from "node:crypto";

const api = "https://api.cloudflare.com/client/v4";
const identifier = /^[0-9a-f]{32}$/;
const customDomainId = /^[A-Za-z0-9_-]{1,128}$/;
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function result(payload, description) {
  if (payload?.success !== true || !payload.result) {
    throw new Error(`Cloudflare ${description} response is invalid`);
  }
  return payload.result;
}

function proveDisjointWorkerRoutes(payload, routes, host, zoneName) {
  const page = payload.result_info;
  if (!Array.isArray(routes) || (page !== undefined && (
    !page || typeof page !== "object" || Array.isArray(page) ||
    (page.page !== undefined && page.page !== 1) ||
    (page.total_pages !== undefined && page.total_pages !== 1 && !(page.total_pages === 0 && routes.length === 0)) ||
    (page.total_count !== undefined && page.total_count !== routes.length) ||
    (page.count !== undefined && page.count !== routes.length) ||
    page.cursor || page.cursors?.after || page.cursors?.before
  ))) {
    throw new Error("Custom Domain Worker Routes inventory is incomplete");
  }
  const patterns = routes.map((route) => {
    // Only ignore a route when its literal hostname proves it cannot match
    // any path on this endpoint. Keep wildcard hosts and unknown forms closed.
    const pattern = route?.pattern;
    const match = typeof pattern === "string" && !/[^\x21-\x7e]/.test(pattern)
      ? /^(?:https?:\/\/)?([a-z0-9.-]+)(?:\/[^\\?#*]*\*?)?$/i.exec(pattern)
      : null;
    const routeHost = match?.[1].toLowerCase();
    if (!routeHost || routeHost.length > 253 || !routeHost.split(".").every((part) => label.test(part)) ||
        !(routeHost === zoneName || routeHost.endsWith(`.${zoneName}`)) || routeHost === host) {
      throw new Error("Custom Domain overriding Worker Routes cannot be ruled out");
    }
    return pattern;
  });
  if (patterns.length === 0) return { schema_version: 1, empty_worker_routes: true };
  return {
    schema_version: 2,
    no_overriding_worker_routes: true,
    worker_routes_sha256: createHash("sha256").update(JSON.stringify(patterns.sort())).digest("base64url"),
  };
}

export function assertWorkerEndpointMapping(mapping, origin, accountId, scriptName) {
  const host = new URL(origin).hostname;
  const common = ["schema_version", "kind", "origin", "account_id", "script_name", "sources"];
  let fields;
  let sources;
  if (mapping?.kind === "workers_dev") {
    fields = [...common, "account_subdomain", "enabled"];
    if (!label.test(mapping.account_subdomain ?? "") || mapping.enabled !== true ||
        host !== `${scriptName}.${mapping.account_subdomain}.workers.dev`) {
      throw new Error("approved origin does not match enabled account/script workers.dev mapping");
    }
    sources = [
      `${api}/accounts/${accountId}/workers/subdomain`,
      `${api}/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
    ];
  } else if (mapping?.kind === "custom_domain") {
    fields = [...common, "domain_id", "zone_id", "zone_name", "cloudflare_environment"];
    if (typeof mapping.domain_id !== "string" || !customDomainId.test(mapping.domain_id) ||
        !identifier.test(mapping.zone_id ?? "") ||
        typeof mapping.zone_name !== "string" || !mapping.zone_name.split(".").every((part) => label.test(part)) ||
        !(host === mapping.zone_name || host.endsWith(`.${mapping.zone_name}`)) ||
        mapping.cloudflare_environment !== "production") {
      throw new Error("Custom Domain mapping requires the default script environment and an active matching zone");
    }
    if (mapping.schema_version === 1 && mapping.empty_worker_routes === true) {
      fields.push("empty_worker_routes");
    } else if (mapping.schema_version === 2 && mapping.no_overriding_worker_routes === true &&
        typeof mapping.worker_routes_sha256 === "string" && /^[A-Za-z0-9_-]{43}$/.test(mapping.worker_routes_sha256) &&
        Buffer.from(mapping.worker_routes_sha256, "base64url").toString("base64url") === mapping.worker_routes_sha256) {
      fields.push("no_overriding_worker_routes", "worker_routes_sha256");
    } else {
      throw new Error("Custom Domain mapping is missing a valid Worker Routes observation");
    }
    sources = [
      `${api}/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(host)}`,
      `${api}/zones/${mapping.zone_id}`,
      `${api}/zones/${mapping.zone_id}/workers/routes`,
    ];
  } else {
    throw new Error("verified endpoint/script mapping is missing or unsupported");
  }
  if ((mapping.kind === "workers_dev" && mapping.schema_version !== 1) || mapping.origin !== origin ||
      mapping.account_id !== accountId || mapping.script_name !== scriptName ||
      JSON.stringify(mapping.sources) !== JSON.stringify(sources) ||
      JSON.stringify(Object.keys(mapping).sort()) !== JSON.stringify(fields.sort())) {
    throw new Error("endpoint/script mapping does not match the approved origin/account/script contract");
  }
  return mapping;
}

export async function observeWorkerEndpointMapping({ get, origin, accountId, scriptName }) {
  const host = new URL(origin).hostname;
  let mapping;
  if (host.endsWith(".workers.dev")) {
    const accountPath = `/accounts/${accountId}/workers/subdomain`;
    const scriptPath = `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`;
    const account = result(await get(accountPath), "account subdomain");
    const script = result(await get(scriptPath), "script subdomain");
    mapping = {
      schema_version: 1, kind: "workers_dev", origin, account_id: accountId, script_name: scriptName,
      sources: [`${api}${accountPath}`, `${api}${scriptPath}`],
      account_subdomain: account.subdomain, enabled: script.enabled,
    };
  } else {
    const domainPath = `/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(host)}`;
    const payload = await get(domainPath);
    const domains = result(payload, "Custom Domain");
    // A hostname-filtered response must be complete; never infer mapping from a partial page.
    if (!Array.isArray(domains) || domains.length !== 1 ||
        (payload.result_info?.total_pages !== undefined && payload.result_info.total_pages !== 1)) {
      throw new Error("approved endpoint requires one complete Custom Domain mapping; Route-only is unsupported");
    }
    const domain = domains[0];
    if (domain.hostname !== host || domain.service !== scriptName || !identifier.test(domain.zone_id ?? "") ||
        (domain.enabled !== undefined && domain.enabled !== true)) {
      throw new Error("Custom Domain does not map the approved origin to the expected script");
    }
    const zonePath = `/zones/${domain.zone_id}`;
    const routePath = `${zonePath}/workers/routes`;
    const zone = result(await get(zonePath), "zone");
    const routesPayload = await get(routePath);
    const routes = result(routesPayload, "Worker Routes");
    if (zone.id !== domain.zone_id || zone.account?.id !== accountId || zone.status !== "active" ||
        zone.name !== domain.zone_name) {
      throw new Error("Custom Domain account or active zone cannot be verified");
    }
    mapping = {
      ...proveDisjointWorkerRoutes(routesPayload, routes, host, zone.name),
      kind: "custom_domain", origin, account_id: accountId, script_name: scriptName,
      sources: [`${api}${domainPath}`, `${api}${zonePath}`, `${api}${routePath}`],
      domain_id: domain.id, zone_id: domain.zone_id, zone_name: domain.zone_name,
      cloudflare_environment: domain.environment,
    };
  }
  return assertWorkerEndpointMapping(mapping, origin, accountId, scriptName);
}
