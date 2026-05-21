import { createClient } from "@supabase/supabase-js";

function printUsage() {
  console.log("Usage:");
  console.log(
    "  pnpm run manage-anon-sync-vault -- <command> [options]",
  );
  console.log("");
  console.log("Commands:");
  console.log("  status");
  console.log("  bootstrap-pepper   --initial-version v<N> [--secret-env ENV] [--description TEXT] [--confirm] [--json]");
  console.log("  bootstrap-recovery --initial-version v<N> [--secret-env ENV] [--description TEXT] [--confirm] [--json]");
  console.log("  rotate-pepper      --target-version v<N>  [--secret-env ENV] [--description TEXT] [--confirm] [--json]");
  console.log("  rotate-recovery    --target-version v<N>  [--secret-env ENV] [--description TEXT] [--confirm] [--json]");
  console.log("  finalize-pepper    --keep-version v<N>    [--retire-others] [--confirm] [--json]");
  console.log("  finalize-recovery  --keep-version v<N>    [--retire-others] [--confirm] [--json]");
  console.log("");
  console.log("Auth (env fallback):");
  console.log("  --supabase-url or SUPABASE_URL / PUBLIC_SUPABASE_URL");
  console.log("  service role key: SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY");
  console.log("");
  console.log("Safety:");
  console.log("  default: dry-run (no write)");
  console.log("  --confirm: apply changes");
  console.log("  secret env (default or --secret-env) must exist in env (fail-fast if unset)");
  console.log("  --secret / --service-role-key are intentionally disabled");
}

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex !== -1) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      values[key] = value;
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

function ensureVersion(raw) {
  if (!raw) return null;
  const normalized = String(raw).trim().toLowerCase();
  return /^v[0-9]+$/.test(normalized) ? normalized : null;
}

function ensureStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}

function resolveAuth(parsed) {
  const supabaseUrl =
    parsed.values["supabase-url"] ||
    process.env.SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  const errors = [];
  if (
    Object.prototype.hasOwnProperty.call(parsed.values, "service-role-key") ||
    parsed.flags.has("service-role-key")
  ) {
    errors.push("--service-role-key is disabled for safety. Use SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.");
  }
  if (!supabaseUrl) {
    errors.push("Supabase URL is missing (--supabase-url or SUPABASE_URL/PUBLIC_SUPABASE_URL).",
    );
  }
  if (!serviceRoleKey) {
    errors.push("Service role key is missing (SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  return { supabaseUrl, serviceRoleKey, errors };
}

function resolveSecret(options) {
  const explicitSecretEnv =
    typeof options.parsed.values["secret-env"] === "string";
  const secretEnvName = explicitSecretEnv
    ? String(options.parsed.values["secret-env"])
    : options.defaultEnv;

  const hasSecretEnv = Object.prototype.hasOwnProperty.call(
    process.env,
    secretEnvName,
  );
  const secretFromEnv = hasSecretEnv
    ? String(process.env[secretEnvName] ?? "")
    : "";
  const secret = secretFromEnv;
  const secretSource = hasSecretEnv ? `env:${secretEnvName}` : "missing";

  return {
    secretEnvName,
    hasSecretEnv,
    secret,
    secretSource,
    explicitSecretEnv,
  };
}

async function loadRuntime(client, tableName) {
  const { data, error } = await client
    .from(tableName)
    .select("current_version, accept_versions, version_epoch")
    .eq("singleton", true)
    .maybeSingle();

  return { data, error };
}

async function runStatus(client, asJson) {
  const pepperRuntime = await loadRuntime(client, "anon_sync_pepper_runtime");
  const recoveryRuntime = await loadRuntime(client, "anon_sync_recovery_runtime");

  const pepperVersions = await client
    .from("anon_sync_pepper_versions")
    .select("version, retired_at")
    .order("version", { ascending: true });

  const recoveryVersions = await client
    .from("anon_sync_recovery_versions")
    .select("version, retired_at")
    .order("version", { ascending: true });

  const payload = {
    pepper: {
      runtime: pepperRuntime.error ? null : pepperRuntime.data,
      runtime_error: pepperRuntime.error ? pepperRuntime.error.message : null,
      versions: pepperVersions.error ? [] : (pepperVersions.data ?? []),
      versions_error: pepperVersions.error ? pepperVersions.error.message : null,
    },
    recovery: {
      runtime: recoveryRuntime.error ? null : recoveryRuntime.data,
      runtime_error: recoveryRuntime.error ? recoveryRuntime.error.message : null,
      versions: recoveryVersions.error ? [] : (recoveryVersions.data ?? []),
      versions_error: recoveryVersions.error ? recoveryVersions.error.message : null,
    },
  };

  const hasErrors =
    Boolean(payload.pepper.runtime_error) ||
    Boolean(payload.pepper.versions_error) ||
    Boolean(payload.recovery.runtime_error) ||
    Boolean(payload.recovery.versions_error) ||
    !payload.pepper.runtime ||
    !payload.recovery.runtime;

  const result = {
    ok: !hasErrors,
    ...payload,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return { ok: !hasErrors };
  }

  console.log("[anon-sync-vault] status");
  if (payload.pepper.runtime_error) {
    console.log(`- pepper runtime error: ${payload.pepper.runtime_error}`);
  } else if (!payload.pepper.runtime) {
    console.log("- pepper runtime: missing");
  } else {
    console.log(
      `- pepper runtime: current=${payload.pepper.runtime.current_version} accept=${ensureStringArray(payload.pepper.runtime.accept_versions).join(",")} epoch=${payload.pepper.runtime.version_epoch}`,
    );
  }

  if (payload.recovery.runtime_error) {
    console.log(`- recovery runtime error: ${payload.recovery.runtime_error}`);
  } else if (!payload.recovery.runtime) {
    console.log("- recovery runtime: missing");
  } else {
    console.log(
      `- recovery runtime: current=${payload.recovery.runtime.current_version} accept=${ensureStringArray(payload.recovery.runtime.accept_versions).join(",")} epoch=${payload.recovery.runtime.version_epoch}`,
    );
  }

  if (payload.pepper.versions_error) {
    console.log(`- pepper versions error: ${payload.pepper.versions_error}`);
  } else {
    console.log(`- pepper versions: ${payload.pepper.versions.length}`);
  }

  if (payload.recovery.versions_error) {
    console.log(`- recovery versions error: ${payload.recovery.versions_error}`);
  } else {
    console.log(`- recovery versions: ${payload.recovery.versions.length}`);
  }

  if (!result.ok) {
    console.log("- status: degraded");
  }

  return { ok: !hasErrors };
}

function printInvalidArgs(errors) {
  console.error("[anon-sync-vault] Invalid arguments:");
  for (const message of errors) {
    console.error(`- ${message}`);
  }
  console.error("");
  printUsage();
}

async function runBootstrap(options) {
  const { client, parsed, asJson, confirm, command } = options;
  const initialVersion = ensureVersion(parsed.values["initial-version"]);
  const description = parsed.values.description
    ? String(parsed.values.description)
    : undefined;

  const secret = resolveSecret({
    parsed,
    defaultEnv: command === "bootstrap-pepper"
      ? "ANON_SYNC_PEPPER_SECRET"
      : "ANON_SYNC_RECOVERY_SECRET",
  });

  const errors = [];
  if (
    Object.prototype.hasOwnProperty.call(parsed.values, "secret") ||
    parsed.flags.has("secret")
  ) {
    errors.push("--secret is disabled for safety. Use --secret-env.");
  }
  if (!initialVersion) {
    errors.push("--initial-version is required and must match ^v[0-9]+$.");
  }
  if (!secret.hasSecretEnv) {
    errors.push(`required secret env ${secret.secretEnvName} is not set.`);
  }
  if (secret.secret.length < 32) {
    errors.push(`secret must be at least 32 chars (env ${secret.secretEnvName}).`);
  }
  if (errors.length > 0) {
    printInvalidArgs(errors);
    process.exit(1);
  }

  const plan = {
    command,
    initial_version: initialVersion,
    secret_length: secret.secret.length,
    secret_source: secret.secretSource,
    mode: confirm ? "apply" : "dry-run",
  };

  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log("[anon-sync-vault] Preflight:");
    console.log(`- command: ${plan.command}`);
    console.log(`- initial_version: ${plan.initial_version}`);
    console.log(`- secret_length: ${plan.secret_length}`);
    console.log(`- secret_source: ${plan.secret_source}`);
    console.log(`- mode: ${plan.mode}`);
  }

  if (!confirm) {
    if (!asJson) {
      console.log("[anon-sync-vault] Dry-run only. Re-run with --confirm to apply.");
    }
    process.exit(0);
  }

  const rpcName = command === "bootstrap-pepper"
    ? "ensure_anon_sync_pepper_runtime"
    : "ensure_anon_sync_recovery_runtime";

  const versionArg = { p_initial_version: initialVersion };
  const { data, error } = await client.rpc(rpcName, {
    ...versionArg,
    p_secret: secret.secret,
    p_description: description,
  });

  if (error) {
    console.error("[anon-sync-vault] RPC failed:");
    console.error(error.message);
    if (typeof error.message === "string" && error.message.includes(rpcName)) {
      console.error("[anon-sync-vault] Hint: apply 20260521010000_anon_sync_vault_ops_rpc.sql first.");
    }
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`[anon-sync-vault] Applied (${rpcName})`);
    console.log(JSON.stringify(data, null, 2));
  }
}

async function runRotate(options) {
  const { client, parsed, asJson, confirm, command } = options;
  const targetVersion = ensureVersion(parsed.values["target-version"]);
  const description = parsed.values.description
    ? String(parsed.values.description)
    : undefined;

  const secret = resolveSecret({
    parsed,
    defaultEnv: command === "rotate-pepper"
      ? "ANON_SYNC_PEPPER_SECRET"
      : "ANON_SYNC_RECOVERY_SECRET",
  });

  const runtimeTable = command === "rotate-pepper"
    ? "anon_sync_pepper_runtime"
    : "anon_sync_recovery_runtime";
  const runtime = await loadRuntime(client, runtimeTable);

  const errors = [];
  if (
    Object.prototype.hasOwnProperty.call(parsed.values, "secret") ||
    parsed.flags.has("secret")
  ) {
    errors.push("--secret is disabled for safety. Use --secret-env.");
  }
  if (!targetVersion) {
    errors.push("--target-version is required and must match ^v[0-9]+$.");
  }
  if (!secret.hasSecretEnv) {
    errors.push(`required secret env ${secret.secretEnvName} is not set.`);
  }
  if (secret.secret.length < 32) {
    errors.push(`secret must be at least 32 chars (env ${secret.secretEnvName}).`);
  }
  if (runtime.error) {
    errors.push(`${runtimeTable} read failed: ${runtime.error.message}`);
  }
  if (!runtime.error && (!runtime.data || typeof runtime.data.current_version !== "string")) {
    errors.push(`${runtimeTable} singleton row is missing or invalid.`);
  }

  if (errors.length > 0) {
    printInvalidArgs(errors);
    process.exit(1);
  }

  const runtimeAccept = ensureStringArray(runtime.data.accept_versions);
  if (runtime.data.current_version === targetVersion) {
    console.error(`[anon-sync-vault] Refusing to rotate: target version ${targetVersion} is already current.`);
    process.exit(1);
  }
  if (runtimeAccept.includes(targetVersion)) {
    console.error(`[anon-sync-vault] Refusing to rotate: target version ${targetVersion} is already in accept_versions.`);
    process.exit(1);
  }

  const plan = {
    command,
    current_version: runtime.data.current_version,
    target_version: targetVersion,
    planned_accept_versions: [
      targetVersion,
      ...runtimeAccept.filter((v) => v !== targetVersion),
    ],
    planned_version_epoch: Number(runtime.data.version_epoch ?? 0) + 1,
    secret_length: secret.secret.length,
    secret_source: secret.secretSource,
    mode: confirm ? "apply" : "dry-run",
  };

  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log("[anon-sync-vault] Preflight:");
    console.log(`- command: ${plan.command}`);
    console.log(`- current_version: ${plan.current_version}`);
    console.log(`- target_version: ${plan.target_version}`);
    console.log(`- planned_accept_versions: ${plan.planned_accept_versions.join(", ")}`);
    console.log(`- planned_version_epoch: ${plan.planned_version_epoch}`);
    console.log(`- secret_length: ${plan.secret_length}`);
    console.log(`- secret_source: ${plan.secret_source}`);
    console.log(`- mode: ${plan.mode}`);
  }

  if (!confirm) {
    if (!asJson) {
      console.log("[anon-sync-vault] Dry-run only. Re-run with --confirm to apply.");
    }
    process.exit(0);
  }

  const rpcName = command === "rotate-pepper"
    ? "rotate_anon_sync_pepper"
    : "rotate_anon_sync_recovery_key";

  const { data, error } = await client.rpc(rpcName, {
    p_target_version: targetVersion,
    p_secret: secret.secret,
    p_description: description,
  });

  if (error) {
    console.error("[anon-sync-vault] RPC failed:");
    console.error(error.message);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`[anon-sync-vault] Applied (${rpcName})`);
    console.log(JSON.stringify(data, null, 2));
  }
}

async function runFinalize(options) {
  const { client, parsed, asJson, confirm, command } = options;
  const keepVersion = ensureVersion(parsed.values["keep-version"]);
  const retireOthers = parsed.flags.has("retire-others");

  const runtimeTable = command === "finalize-pepper"
    ? "anon_sync_pepper_runtime"
    : "anon_sync_recovery_runtime";
  const versionsTable = command === "finalize-pepper"
    ? "anon_sync_pepper_versions"
    : "anon_sync_recovery_versions";

  const runtime = await loadRuntime(client, runtimeTable);
  const keepVersionQuery = keepVersion
    ? await client
      .from(versionsTable)
      .select("version, retired_at")
      .eq("version", keepVersion)
      .maybeSingle()
    : { data: null, error: null };

  const errors = [];
  if (!keepVersion) {
    errors.push("--keep-version is required and must match ^v[0-9]+$.");
  }
  if (runtime.error) {
    errors.push(`${runtimeTable} read failed: ${runtime.error.message}`);
  }
  if (!runtime.error && (!runtime.data || typeof runtime.data.current_version !== "string")) {
    errors.push(`${runtimeTable} singleton row is missing or invalid.`);
  }
  if (keepVersionQuery.error) {
    errors.push(`${versionsTable} read failed: ${keepVersionQuery.error.message}`);
  }
  if (!keepVersionQuery.error && !keepVersionQuery.data && keepVersion) {
    errors.push(`--keep-version ${keepVersion} is not found in ${versionsTable}.`);
  }
  if (
    !keepVersionQuery.error &&
    keepVersionQuery.data &&
    keepVersionQuery.data.retired_at
  ) {
    errors.push(`--keep-version ${keepVersion} is already retired in ${versionsTable}.`);
  }
  if (errors.length > 0) {
    printInvalidArgs(errors);
    process.exit(1);
  }

  const runtimeAccept = ensureStringArray(runtime.data.accept_versions);
  const plan = {
    command,
    current_version: runtime.data.current_version,
    current_accept_versions: runtimeAccept,
    keep_version: keepVersion,
    retire_others: retireOthers,
    mode: confirm ? "apply" : "dry-run",
  };

  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log("[anon-sync-vault] Preflight:");
    console.log(`- command: ${plan.command}`);
    console.log(`- current_version: ${plan.current_version}`);
    console.log(`- current_accept_versions: ${plan.current_accept_versions.join(", ")}`);
    console.log(`- keep_version: ${plan.keep_version}`);
    console.log(`- retire_others: ${plan.retire_others}`);
    console.log(`- mode: ${plan.mode}`);
  }

  if (!confirm) {
    if (!asJson) {
      console.log("[anon-sync-vault] Dry-run only. Re-run with --confirm to apply.");
    }
    process.exit(0);
  }

  const rpcName = command === "finalize-pepper"
    ? "finalize_anon_sync_pepper_accept"
    : "finalize_anon_sync_recovery_accept";

  const { data, error } = await client.rpc(rpcName, {
    p_keep_version: keepVersion,
    p_retire_others: retireOthers,
  });

  if (error) {
    console.error("[anon-sync-vault] RPC failed:");
    console.error(error.message);
    process.exit(1);
  }

  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`[anon-sync-vault] Applied (${rpcName})`);
    console.log(JSON.stringify(data, null, 2));
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = (parsed.positionals[0] || "status").toLowerCase();

  if (
    command === "help" ||
    command === "-h" ||
    command === "--help" ||
    parsed.flags.has("help") ||
    parsed.flags.has("h")
  ) {
    printUsage();
    process.exit(0);
  }

  const asJson = parsed.flags.has("json");
  const confirm = parsed.flags.has("confirm");

  const auth = resolveAuth(parsed);
  if (auth.errors.length > 0) {
    printInvalidArgs(auth.errors);
    process.exit(1);
  }

  const client = createClient(auth.supabaseUrl, auth.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  if (command === "status") {
    const statusResult = await runStatus(client, asJson);
    process.exit(statusResult.ok ? 0 : 1);
  }

  if (command === "bootstrap-pepper" || command === "bootstrap-recovery") {
    await runBootstrap({ client, parsed, asJson, confirm, command });
    process.exit(0);
  }

  if (command === "rotate-pepper" || command === "rotate-recovery") {
    await runRotate({ client, parsed, asJson, confirm, command });
    process.exit(0);
  }

  if (command === "finalize-pepper" || command === "finalize-recovery") {
    await runFinalize({ client, parsed, asJson, confirm, command });
    process.exit(0);
  }

  printInvalidArgs([`unknown command: ${command}`]);
  process.exit(1);
}

main().catch((err) => {
  console.error("[anon-sync-vault] unexpected error:", err);
  process.exit(1);
});
