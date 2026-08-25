#!/usr/bin/env node

/**
 * Purge the pre-cutover Fleet namespace from the fixed R2 bucket.
 *
 * The command keeps object keys in memory only while deleting. It reports
 * counts, never writes an inventory file, and never prints object metadata.
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID";
const API_TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const BUCKET = "dev-kc-fleets";
const PREFIX = "fleets/";
const PAGE_SIZE = 1000;
const DELETE_CONCURRENCY = 20;

function usage() {
  console.log(`Usage:
  node scripts/purge-r2-fleet-data.mjs --plan
  node scripts/purge-r2-fleet-data.mjs --remote
  node scripts/purge-r2-fleet-data.mjs --remote --apply

The default operation is a dry-run. --remote is required for R2 inventory;
--apply additionally deletes every object under the fixed fleets/ prefix in
the fixed dev-kc-fleets bucket. Set ${ACCOUNT_ID_ENV} and ${API_TOKEN_ENV}
in the environment. Object keys, metadata, and checksums are not recorded.`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    help: false,
    json: false,
    plan: false,
    remote: false,
  };

  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--plan") args.plan = true;
    else if (arg === "--remote") args.remote = true;
    else if (arg === "--dry-run") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.help) return args;
  if (!args.plan && !args.remote) {
    throw new Error("R2 inventory requires --remote (or use --plan)");
  }
  if (args.plan && args.apply) {
    throw new Error("--plan cannot be combined with --apply");
  }
  if (args.apply && !args.remote) {
    throw new Error("--apply requires --remote");
  }

  return args;
}

function getCredentials() {
  const accountId = String(process.env[ACCOUNT_ID_ENV] || "").trim();
  const apiToken = String(process.env[API_TOKEN_ENV] || "").trim();
  if (!accountId || !apiToken) {
    throw new Error(
      `Missing ${ACCOUNT_ID_ENV} and/or ${API_TOKEN_ENV}; no R2 request was made`,
    );
  }
  return { accountId, apiToken };
}

function bucketUrl(accountId) {
  return `${API_BASE}/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(BUCKET)}`;
}

function objectUrl(accountId, key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${bucketUrl(accountId)}/objects/${encodedKey}`;
}

async function requestJson(url, apiToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
      ...(options.headers ?? {}),
    },
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Cloudflare R2 API returned non-JSON status ${response.status}`);
  }
  if (!response.ok || body?.success !== true) {
    throw new Error(`Cloudflare R2 API request failed with status ${response.status}`);
  }
  return body;
}

async function listFleetKeys(accountId, apiToken, collectKeys) {
  const keys = collectKeys ? [] : null;
  let cursor = "";
  let count = 0;

  while (true) {
    const url = new URL(`${bucketUrl(accountId)}/objects`);
    url.searchParams.set("prefix", PREFIX);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);

    const body = await requestJson(url, apiToken);
    const objects = Array.isArray(body.result) ? body.result : [];
    for (const object of objects) {
      const key = typeof object?.key === "string" ? object.key : "";
      if (!key.startsWith(PREFIX)) {
        throw new Error("R2 list returned an object outside the fixed prefix");
      }
      count += 1;
      if (keys) keys.push(key);
    }

    const resultInfo = body.result_info ?? {};
    if (resultInfo.is_truncated !== true) break;
    const nextCursor = String(resultInfo.cursor || "");
    if (!nextCursor || nextCursor === cursor) {
      throw new Error("R2 list pagination returned an invalid cursor");
    }
    cursor = nextCursor;
  }

  return { count, keys };
}

async function deleteFleetKeys(accountId, apiToken, keys) {
  let deleted = 0;
  for (let offset = 0; offset < keys.length; offset += DELETE_CONCURRENCY) {
    const chunk = keys.slice(offset, offset + DELETE_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((key) =>
        requestJson(objectUrl(accountId, key), apiToken, { method: "DELETE" }),
      ),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      throw new Error("R2 deletion failed; rerun the idempotent purge after investigation");
    }
    deleted += chunk.length;
  }
  return deleted;
}

function printReport(phase, report, json) {
  if (json) {
    console.log(JSON.stringify({ phase, ...report }, null, 2));
    return;
  }
  console.log(`=== R2 Fleet purge ${phase} ===`);
  console.log(`bucket=${report.bucket}`);
  console.log(`prefix=${report.prefix}`);
  if (report.listed !== undefined) console.log(`listed=${report.listed}`);
  if (report.deleted !== undefined) console.log(`deleted=${report.deleted}`);
  if (report.remaining !== undefined) console.log(`remaining=${report.remaining}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (args.plan) {
    printReport(
      "plan",
      { bucket: BUCKET, prefix: PREFIX, mode: "count-only, no request" },
      args.json,
    );
    return;
  }

  const { accountId, apiToken } = getCredentials();
  const listed = await listFleetKeys(accountId, apiToken, args.apply);
  printReport(
    args.apply ? "preflight" : "dry-run",
    { bucket: BUCKET, prefix: PREFIX, listed: listed.count },
    args.json,
  );

  if (!args.apply) return;

  const deleted = await deleteFleetKeys(accountId, apiToken, listed.keys ?? []);
  const postflight = await listFleetKeys(accountId, apiToken, false);
  if (postflight.count !== 0) {
    throw new Error(`R2 postflight failed: ${postflight.count} objects remain`);
  }
  printReport(
    "postflight",
    {
      bucket: BUCKET,
      prefix: PREFIX,
      listed: listed.count,
      deleted,
      remaining: postflight.count,
    },
    args.json,
  );
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});