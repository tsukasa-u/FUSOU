const api = "https://api.cloudflare.com/client/v4";
const identifier = /^[0-9a-f]{32}$/;
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function result(payload, description) {
  if (payload?.success !== true || !payload.result) {
    throw new Error(`Cloudflare ${description} response is invalid`);
  }
  return payload.result;
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
    fields = [...common, "domain_id", "zone_id", "zone_name", "cloudflare_environment", "empty_worker_routes"];
    if (!identifier.test(mapping.domain_id ?? "") || !identifier.test(mapping.zone_id ?? "") ||
        typeof mapping.zone_name !== "string" || !mapping.zone_name.split(".").every((part) => label.test(part)) ||
        !(host === mapping.zone_name || host.endsWith(`.${mapping.zone_name}`)) ||
        mapping.cloudflare_environment !== "production" || mapping.empty_worker_routes !== true) {
      throw new Error("Custom Domain mapping requires the default script environment and a route-free active zone");
    }
    sources = [
      `${api}/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(host)}`,
      `${api}/zones/${mapping.zone_id}`,
      `${api}/zones/${mapping.zone_id}/workers/routes`,
    ];
  } else {
    throw new Error("verified endpoint/script mapping is missing or unsupported");
  }
  if (mapping.schema_version !== 1 || mapping.origin !== origin ||
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
    if (domain.hostname !== host || domain.service !== scriptName || !identifier.test(domain.zone_id ?? "")) {
      throw new Error("Custom Domain does not map the approved origin to the expected script");
    }
    const zonePath = `/zones/${domain.zone_id}`;
    const routePath = `${zonePath}/workers/routes`;
    const zone = result(await get(zonePath), "zone");
    const routes = result(await get(routePath), "Worker Routes");
    if (zone.id !== domain.zone_id || zone.account?.id !== accountId || zone.status !== "active" ||
        zone.name !== domain.zone_name || !Array.isArray(routes) || routes.length !== 0) {
      throw new Error("Custom Domain account/active zone or overriding Worker Routes cannot be verified");
    }
    mapping = {
      schema_version: 1, kind: "custom_domain", origin, account_id: accountId, script_name: scriptName,
      sources: [`${api}${domainPath}`, `${api}${zonePath}`, `${api}${routePath}`],
      domain_id: domain.id, zone_id: domain.zone_id, zone_name: domain.zone_name,
      cloudflare_environment: domain.environment, empty_worker_routes: true,
    };
  }
  return assertWorkerEndpointMapping(mapping, origin, accountId, scriptName);
}
