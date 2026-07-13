#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { tasks } from "@trigger.dev/sdk/v3";

function parseArgs(argv) {
  const out = {
    payloadPath: "",
    taskId: "backfill-compaction",
    tier: "",
    sourceTier: "",
    start: "",
    end: "",
    tableNames: "",
    chunkLimit: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--payload") {
      out.payloadPath = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--task") {
      out.taskId = String(argv[i + 1] || "").trim() || out.taskId;
      i += 1;
      continue;
    }
    if (arg === "--tier") {
      out.tier = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--source-tier") {
      out.sourceTier = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--start") {
      out.start = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--end") {
      out.end = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--tables") {
      out.tableNames = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (arg === "--chunk-limit") {
      out.chunkLimit = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
  }

  return out;
}

function parseTime(value, name) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error(`Missing --${name}`);
  }

  if (/^\d+$/.test(raw)) {
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) return Math.trunc(ms);
  }

  // Treat plain dates as UTC midnight so terminal usage is stable across locales.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsedDateOnly = Date.parse(`${raw}T00:00:00Z`);
    if (Number.isFinite(parsedDateOnly)) return parsedDateOnly;
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`Invalid --${name} value: ${raw}`);
}

function buildPayloadFromArgs(args) {
  const tier = String(args.tier || "").trim();
  if (!tier) return null;

  const payload = { tier };

  if (args.start || args.end) {
    payload.start_ms = parseTime(args.start, "start");
    payload.end_ms = parseTime(args.end, "end");
  }

  if (args.sourceTier) payload.source_tier = String(args.sourceTier).trim();
  if (args.tableNames) {
    const tableNames = String(args.tableNames)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (tableNames.length > 0) payload.table_names = tableNames;
  }
  if (args.chunkLimit) {
    const chunkLimit = Number(args.chunkLimit);
    if (!Number.isFinite(chunkLimit) || chunkLimit <= 0) {
      throw new Error(`Invalid --chunk-limit value: ${args.chunkLimit}`);
    }
    payload.chunk_limit = Math.trunc(chunkLimit);
  }

  return payload;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Backfill payload must be a JSON object");
  }

  const tier = String(payload.tier || "").trim();
  if (!tier) {
    throw new Error("Backfill payload requires tier");
  }

  const hasStart = Number.isFinite(Number(payload.start_ms));
  const hasEnd = Number.isFinite(Number(payload.end_ms));
  if (hasStart !== hasEnd) {
    throw new Error("Backfill payload requires start_ms and end_ms together");
  }
  if (hasStart && hasEnd) {
    const start = Number(payload.start_ms);
    const end = Number(payload.end_ms);
    if (end <= start) {
      throw new Error("Backfill payload requires end_ms > start_ms");
    }
  }
}

function sanitizeHandle(handle) {
  if (!handle || typeof handle !== "object") {
    return handle;
  }

  const next = { ...handle };
  if (typeof next.publicAccessToken === "string" && next.publicAccessToken.length > 0) {
    next.publicAccessToken = "[redacted]";
  }
  return next;
}

async function main() {
  const args = parseArgs(process.argv);

  let payload = buildPayloadFromArgs(args);
  let payloadFile = "";

  if (!payload) {
    if (!args.payloadPath) {
      throw new Error("Provide either --payload <json-file> or --tier/--start/--end arguments");
    }
    payloadFile = path.resolve(process.cwd(), args.payloadPath);
    const raw = await readFile(payloadFile, "utf8");
    payload = JSON.parse(raw);
  }

  if (!process.env.TRIGGER_SECRET_KEY) {
    throw new Error("Missing TRIGGER_SECRET_KEY in environment. This is only required when enqueueing backfill from the terminal.");
  }

  validatePayload(payload);

  const handle = await tasks.trigger(args.taskId, payload);

  console.log(
    JSON.stringify(
      {
        taskId: args.taskId,
        payloadFile: payloadFile || null,
        payload,
        handle: sanitizeHandle(handle),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
