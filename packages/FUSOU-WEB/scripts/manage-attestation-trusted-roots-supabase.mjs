#!/usr/bin/env node

import { X509Certificate, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");

const TABLE_NAME = "attestation_trusted_roots";

const KEYLIME_MAJOR_TPM_ROOT_CERTS = [
  {
    manufacturer: "infineon",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/INF_RSA_010RT.pem",
    description: "Infineon OPTIGA TPM RSA Root CA",
  },
  {
    manufacturer: "infineon",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/INF_ECC_010RT.pem",
    description: "Infineon OPTIGA TPM ECC Root CA",
  },
  {
    manufacturer: "intel",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/INTEL_RT.pem",
    description: "Intel TPM EK Root",
  },
  {
    manufacturer: "stmicroelectronics",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/STM_ECC_01RT.pem",
    description: "STMicroelectronics TPM ECC Root",
  },
  {
    manufacturer: "st+globalsign",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/GS_TPM_RT.pem",
    description: "GlobalSign Trusted Platform Module Root",
  },
  {
    manufacturer: "nuvoton",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/NUVO_0100.pem",
    description: "Nuvoton TPM Root CA 0100",
  },
  {
    manufacturer: "nuvoton",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/NUVO_1110.pem",
    description: "Nuvoton TPM Root CA 1110",
  },
  {
    manufacturer: "nuvoton",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/NUVO_1111.pem",
    description: "Nuvoton TPM Root CA 1111",
  },
  {
    manufacturer: "nuvoton",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/NUVO_2110.pem",
    description: "Nuvoton TPM Root CA 2110",
  },
  {
    manufacturer: "nuvoton",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/NUVO_2111.pem",
    description: "Nuvoton TPM Root CA 2111",
  },
  {
    manufacturer: "nuvoton",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/NTC1.pem",
    description: "Nuvoton NTC TPM EK Root CA 01",
  },
  {
    manufacturer: "nuvoton",
    source:
      "https://raw.githubusercontent.com/keylime/keylime/master/tpm_cert_store/NTC2.pem",
    description: "Nuvoton NTC TPM EK Root CA 02",
  },
];

function usage() {
  console.log("Usage:");
  console.log("  pnpm run manage-attestation-trusted-roots-supabase -- <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  status [--json]");
  console.log("  apply-file --file <@json-or-path> [--confirm] [--json]");
  console.log("  seed-major-tpm [--confirm] [--json]");
  console.log("");
  console.log("Auth (env fallback):");
  console.log("  --supabase-url or SUPABASE_URL / PUBLIC_SUPABASE_URL");
  console.log("  service role key: SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY");
  console.log("");
  console.log("Safety:");
  console.log("  default: dry-run");
  console.log("  --confirm: apply writes");
}

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eq = token.indexOf("=");
    if (eq !== -1) {
      values[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      values[key] = next;
      i += 1;
    } else {
      flags.add(key);
    }
  }

  return { values, flags, positionals };
}

function resolveAuth(parsed) {
  const supabaseUrl =
    parsed.values["supabase-url"] ||
    process.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  const errors = [];
  if (!supabaseUrl) {
    errors.push(
      "Supabase URL is missing (--supabase-url or SUPABASE_URL/PUBLIC_SUPABASE_URL).",
    );
  }
  if (!serviceRoleKey) {
    errors.push(
      "Service role key is missing (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  return { supabaseUrl, serviceRoleKey, errors };
}

function parseRootHash(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function parseInputFile(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error("--file is required");
  }

  const filePath = raw.startsWith("@")
    ? resolve(WEB_ROOT, raw.slice(1))
    : resolve(WEB_ROOT, raw);
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("input file must be an array of rows");
  }

  const rows = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const hash = parseRootHash(item.root_sha256);
    if (!hash) continue;

    const platform = item.platform === "secure_enclave" ? "secure_enclave" : "tpm";
    rows.push({
      platform,
      root_sha256: hash,
      status: item.status === "staged" ? "staged" : "active",
      manufacturer: String(item.manufacturer || "unknown"),
      source: String(item.source || "manual"),
      description: item.description ? String(item.description) : null,
      valid_from: item.valid_from ? String(item.valid_from) : null,
      valid_to: item.valid_to ? String(item.valid_to) : null,
    });
  }

  return dedupeRows(rows);
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.platform}:${row.root_sha256}`, row);
  }
  return Array.from(map.values()).sort((a, b) =>
    `${a.platform}:${a.root_sha256}`.localeCompare(`${b.platform}:${b.root_sha256}`),
  );
}

function computeRootHashFromPem(pemText) {
  const cert = new X509Certificate(pemText);
  return createHash("sha256").update(cert.raw).digest("hex");
}

async function fetchMajorTpmSeedRows() {
  const rows = [];
  for (const item of KEYLIME_MAJOR_TPM_ROOT_CERTS) {
    const response = await fetch(item.source);
    if (!response.ok) {
      throw new Error(`failed to fetch cert: ${item.source} (${response.status})`);
    }

    const pemText = (await response.text()).trim();
    if (!pemText.includes("BEGIN CERTIFICATE")) {
      throw new Error(`unsupported cert format (no PEM block): ${item.source}`);
    }

    const rootSha256 = computeRootHashFromPem(pemText);
    rows.push({
      platform: "tpm",
      root_sha256: rootSha256,
      status: "active",
      manufacturer: item.manufacturer,
      source: item.source,
      description: item.description,
      valid_from: null,
      valid_to: null,
    });
  }

  return dedupeRows(rows);
}

async function cmdStatus(client, asJson) {
  const { data, error } = await client
    .from(TABLE_NAME)
    .select("platform, root_sha256, status, manufacturer, source, valid_from, valid_to")
    .order("platform", { ascending: true })
    .order("root_sha256", { ascending: true })
    .limit(5000);

  if (error) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
      return false;
    }
    console.error("[attestation-trusted-roots-supabase] status error:", error.message);
    return false;
  }

  const payload = {
    ok: true,
    total: (data ?? []).length,
    active: (data ?? []).filter((row) => row.status === "active").length,
    staged: (data ?? []).filter((row) => row.status === "staged").length,
    rows: data ?? [],
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return true;
  }

  console.log("[attestation-trusted-roots-supabase] status");
  console.log(`- total: ${payload.total}`);
  console.log(`- active: ${payload.active}`);
  console.log(`- staged: ${payload.staged}`);
  return true;
}

async function applyRows(client, rows, confirm, asJson) {
  const payload = {
    ok: true,
    mode: confirm ? "applied" : "dry-run",
    count: rows.length,
    rows,
  };

  if (!confirm) {
    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log("[attestation-trusted-roots-supabase] dry-run");
      console.log(`- rows: ${rows.length}`);
    }
    return true;
  }

  const { error } = await client.from(TABLE_NAME).upsert(rows, {
    onConflict: "platform,root_sha256",
    ignoreDuplicates: false,
  });

  if (error) {
    if (asJson) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            mode: "applied",
            count: rows.length,
            error: error.message,
          },
          null,
          2,
        ),
      );
      return false;
    }

    console.error("[attestation-trusted-roots-supabase] apply error:", error.message);
    return false;
  }

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("[attestation-trusted-roots-supabase] applied");
    console.log(`- rows: ${rows.length}`);
  }
  return true;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0];

  if (!command || command === "help" || parsed.flags.has("help")) {
    usage();
    process.exit(command ? 0 : 1);
  }

  const { supabaseUrl, serviceRoleKey, errors } = resolveAuth(parsed);
  if (errors.length > 0) {
    console.error("[attestation-trusted-roots-supabase] invalid args:");
    for (const message of errors) {
      console.error(`- ${message}`);
    }
    console.error("");
    usage();
    process.exit(1);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const asJson = parsed.flags.has("json");
  const confirm = parsed.flags.has("confirm");

  if (command === "status") {
    const ok = await cmdStatus(client, asJson);
    process.exit(ok ? 0 : 1);
  }

  if (command === "apply-file") {
    try {
      const rows = parseInputFile(parsed.values.file);
      const ok = await applyRows(client, rows, confirm, asJson);
      process.exit(ok ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (asJson) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
      } else {
        console.error("[attestation-trusted-roots-supabase]", message);
      }
      process.exit(1);
    }
  }

  if (command === "seed-major-tpm") {
    try {
      const rows = await fetchMajorTpmSeedRows();
      const ok = await applyRows(client, rows, confirm, asJson);
      process.exit(ok ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (asJson) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
      } else {
        console.error("[attestation-trusted-roots-supabase]", message);
      }
      process.exit(1);
    }
  }

  console.error(`[attestation-trusted-roots-supabase] unknown command: ${command}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error("[attestation-trusted-roots-supabase] unexpected error:", err);
  process.exit(1);
});
