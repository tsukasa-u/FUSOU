import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  buildApprovedApp, entryInputSha256, ENTRY_INPUT_CONTRACT, runPublicBuildCommand, sha256,
} from "./app-build-handoff.mjs";
import { createAppWorkerReference } from "./app-worker-deployment-reference.mjs";
import { account, controls, customMapping, now, release, version1, version2 } from "./app-worker-reference-fixture.mjs";
import {
  APP_CONFIGURATION_FINGERPRINT_CONTRACT, appConfigurationProjectionSha256,
} from "./candidate-artifact-identity.mjs";
import { writeDotenvxFixture } from "./app-dotenvx-fixture.mjs";
import { publicAppConfigurationSha256 } from "./app-public-configuration.mjs";

function reference(version = version1) {
  const input = controls(release, version);
  return createAppWorkerReference(release, input.deployment, input.version, account, now, customMapping(release));
}

async function withBuild(action, initialReference = reference()) {
  const root = await mkdtemp(join(tmpdir(), "fusou-approved-app-build-test-"));
  try {
    const app = join(root, "repository/packages/FUSOU-APP/src-tauri");
    await mkdir(app, { recursive: true });
    await writeDotenvxFixture(dirname(app));
    await writeFile(join(app, "Cargo.lock"), "locked-public-dependencies");
    await writeFile(join(app, "tauri.conf.json"), '{"mainBinaryName":"fusou"}');
    const raw = `${JSON.stringify(initialReference)}\n`;
    const referencePath = join(root, "reference.json");
    await writeFile(referencePath, raw);
    const options = {
      referencePath, expectedReferenceSha256: sha256(raw), expectedWorkerSha: "a".repeat(40),
      expectedAppSha: "b".repeat(40), outputDirectory: join(root, "output"),
      repositoryDirectory: join(root, "repository"), toolchain: "1.95.0", profile: "debug",
      environment: {},
    };
    const state = { reference: initialReference, options, sourceSha: options.expectedAppSha, dirty: false, commands: [] };
    function run(command, args, context) {
      state.commands.push({ command, args, env: context.env });
      if (command === "git") return args[0] === "rev-parse" ? state.sourceSha : state.dirty ? " M src/main.rs\n" : "";
      if (command === "rustc") return "rustc 1.95.0 (public-test)\nrelease: 1.95.0";
      if (command === "cargo") return "cargo 1.95.0 (public-test)";
      if (command === "pnpm") {
        assert.deepEqual(args, ["exec", "tauri", "build", "--ci", "--no-bundle", "--features", "tlsn-production,custom-protocol", "--debug", "--", "--locked"]);
        const artifact = join(context.env.CARGO_TARGET_DIR, "debug", process.platform === "win32" ? "fusou.exe" : "fusou");
        mkdirSync(dirname(artifact), { recursive: true });
        writeFileSync(artifact, "public APP fixture artifact");
        if (state.duringBuild) state.duringBuild(context.env);
        return "";
      }
      if (args[0] === "--app-compiled-public-configuration") {
        const report = {
          schema_version: 1, scope: "fusou-app-compiled-public-configuration-report",
          public_app_configuration_sha256: publicAppConfigurationSha256({
            DISCORD_CLIENT_ID: context.env.DISCORD_CLIENT_ID ?? null,
            PUBLIC_SUPABASE_PUBLISHABLE_KEY: context.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            PUBLIC_SUPABASE_URL: context.env.PUBLIC_SUPABASE_URL,
          }),
          discord_client_id_present: context.env.DISCORD_CLIENT_ID !== undefined,
          authority_status: "UNVERIFIED",
        };
        if (state.changePublicReport) state.changePublicReport(report);
        return JSON.stringify(report);
      }
      const inputs = Object.fromEntries(ENTRY_INPUT_CONTRACT.compile_inputs.map((name) => [name, context.env[name]]));
      const report = {
        schema_version: 1, scope: "fusou-tlsn-app-compiled-worker-entry-report",
        entry_input_sha256: entryInputSha256(inputs),
        worker_source_sha: context.env.FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA,
        active_version_id: context.env.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID,
        app_source_sha: context.env.FUSOU_APP_BUILD_SOURCE_SHA,
        build_profile: "debug", tlsn_production_feature: true, custom_protocol_feature: true, authority_status: "UNVERIFIED",
      };
      if (state.changeReport) state.changeReport(report);
      return JSON.stringify(report);
    }
    state.build = () => buildApprovedApp(options, { run });
    await action(state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("entry digest rotates with the active pin while historical v2 fixed projection/vector stays unchanged", () => {
  const vector = ENTRY_INPUT_CONTRACT.test_vector;
  const vectorInputs = Object.fromEntries(ENTRY_INPUT_CONTRACT.compile_inputs.map((name) => [name, vector.uniform_input_value]));
  assert.equal(entryInputSha256(vectorInputs), vector.entry_input_sha256);
  assert.notEqual(entryInputSha256(reference(version1).compile_inputs), entryInputSha256(reference(version2).compile_inputs));
  const v2 = APP_CONFIGURATION_FINGERPRINT_CONTRACT;
  assert.ok(!v2.projection_fields.compile_time.includes("expected_active_version_id"));
  assert.equal(appConfigurationProjectionSha256("compile_time", v2.test_vector.compile_time_fields), v2.test_vector.compile_time_sha256);
  const inputs = reference().compile_inputs;
  for (const name of ENTRY_INPUT_CONTRACT.compile_inputs) {
    const changed = { ...inputs, [name]: `${inputs[name]}\n` };
    assert.notEqual(entryInputSha256(inputs), entryInputSha256(changed), name);
    delete changed[name];
    assert.throws(() => entryInputSha256(changed), /field inventory/, name);
  }
});

test("reference inputs populate an empty build environment exactly and bind the actual binary report to an immutable record", async () => {
  await withBuild(async ({ options, reference, commands, build }) => {
    const result = await build();
    const actual = JSON.parse(await readFile(result.recordPath, "utf8"));
    assert.equal(actual.compiled_input_comparison, "VERIFIED");
    assert.equal(actual.authority_status, "UNVERIFIED");
    assert.equal(actual.reference_sha256, options.expectedReferenceSha256);
    assert.equal(actual.worker_source_sha, options.expectedWorkerSha);
    assert.equal(actual.app_source_sha, options.expectedAppSha);
    assert.notEqual(actual.worker_source_sha, actual.app_source_sha);
    assert.equal(actual.active_version_id, version1);
    assert.equal(actual.entry_input_sha256, entryInputSha256(reference.compile_inputs));
    const buildCommand = commands.find((entry) => entry.command === "pnpm");
    for (const [name, value] of Object.entries(reference.compile_inputs)) assert.equal(buildCommand.env[name], value, name);
    assert.equal(actual.artifact.sha256, sha256(await readFile(result.artifactPath)));
    await assert.rejects(build(), /EEXIST/);
  });
});

test("independent hash rejects an old/substituted reference and absent/partial/mixed-role/endpoint/version references", async () => {
  const mutations = [
    (r) => { delete r.compile_inputs.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID; },
    (r) => { delete r.compile_inputs.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID; },
    (r) => { delete r.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT; },
    (r) => { r.compile_inputs = {}; },
    (r) => { r.compile_inputs.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID = version2; },
    (r) => { r.compile_inputs.FUSOU_TLSN_EXPECTED_BINDING_MODE = "fixed_canary"; },
    (r) => { r.compile_inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT = "https://other-worker.example.com/verify/tlsn"; },
    (r) => { delete r.endpoint_mapping; },
    (r) => { r.schema_version = 1; delete r.endpoint_mapping; },
  ];
  for (const mutate of mutations) {
    const changed = reference(); mutate(changed);
    await withBuild(async ({ build, commands }) => {
      await assert.rejects(build());
      assert.equal(commands.length, 0);
    }, changed);
  }
  await withBuild(async ({ options, build }) => {
    options.expectedReferenceSha256 = sha256(JSON.stringify(reference(version2)));
    await assert.rejects(build(), /raw SHA-256/);
  });
});

test("stale/injected build pins, compiler wrappers, intermediate overrides and missing/wrong compiled inputs fail closed", async () => {
  await withBuild(async ({ options, build }) => {
    options.environment.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID = version2;
    await assert.rejects(build(), /inherited TLSN compile input/);
  });
  await withBuild(async (state) => {
    state.duringBuild = (env) => { env.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID = version2; };
    await assert.rejects(state.build(), /actual APP binary/);
  });
  for (const [name, value] of [
    ["active_version_id", version2], ["entry_input_sha256", "a".repeat(43)],
    ["worker_source_sha", "c".repeat(40)], ["app_source_sha", "c".repeat(40)],
    ["build_profile", "release"], ["tlsn_production_feature", false], ["custom_protocol_feature", false],
    ["active_version_id", undefined],
  ]) {
    await withBuild(async (state) => {
      state.changeReport = (report) => { report[name] = value; };
      await assert.rejects(state.build(), /compiled APP report|actual APP binary/);
      await assert.rejects(readFile(join(state.options.outputDirectory, "app-build-record.json")), /ENOENT/);
    });
  }
});

test("changed/replaced references and changed APP checkout cannot produce a build record", async () => {
  for (const change of [
    (state) => writeFileSync(state.options.referencePath, JSON.stringify(reference(version2))),
    (state) => writeFileSync(state.options.referencePath, JSON.stringify(state.reference)),
    (state) => {
      const replacement = `${state.options.referencePath}.replacement`;
      writeFileSync(replacement, readFileSync(state.options.referencePath));
      renameSync(replacement, state.options.referencePath);
    },
    (state) => { state.dirty = true; },
    (state) => { state.sourceSha = "c".repeat(40); },
  ]) {
    await withBuild(async (state) => {
      state.duringBuild = () => change(state);
      await assert.rejects(state.build(), /reference changed|approved clean checkout/);
      await assert.rejects(readFile(join(state.options.outputDirectory, "app-build-record.json")), /ENOENT/);
    });
  }
});

test("credential contamination is rejected in reference fields, omitted from child environments/records and absent from command errors", async () => {
  const secrets = {
    CLOUDFLARE_API_TOKEN: "private-cloudflare-token",
    TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY: "private-worker-key",
    TAURI_SIGNING_PRIVATE_KEY: "private-updater-key",
    DOTENV_PRIVATE_KEY: "private-dotenv-key",
    NODE_OPTIONS: "private-node-injection",
    RUSTC_WRAPPER: "private-compiler-wrapper",
    RUSTFLAGS: "private-compiler-flag",
    CARGO_HTTP_TOKEN: "private-cargo-token",
  };
  await withBuild(async ({ options, commands, build }) => {
    options.environment = { ...secrets, PUBLIC_SUPABASE_URL: "https://auth.example.com", PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public_value" };
    const result = await build();
    for (const command of commands) for (const name of Object.keys(secrets)) assert.equal(command.env[name], undefined, name);
    const raw = await readFile(result.recordPath, "utf8");
    for (const value of Object.values(secrets)) assert.ok(!raw.includes(value));
  });
  for (const mutate of [
    (r) => { r.CLOUDFLARE_API_TOKEN = secrets.CLOUDFLARE_API_TOKEN; },
    (r) => { r.compile_inputs.TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY = secrets.TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY; },
    (r) => { r.cloudflare.checked_public_bindings.PRIVATE_KEY = "private-test-key"; },
  ]) {
    const changed = reference(); mutate(changed);
    await withBuild(async ({ build }) => { await assert.rejects(build(), /field inventory/); }, changed);
  }
  await withBuild(async ({ options, build }) => {
    await writeFile(join(options.repositoryDirectory, "packages/FUSOU-APP/src-tauri/.env"),
      'PUBLIC_SUPABASE_URL="https://auth.example.com"\nPUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_secret_private_value"\n');
    await assert.rejects(build(), /not private credentials/);
  });
  assert.throws(() => runPublicBuildCommand(process.execPath,
    ["-e", "process.stderr.write('private-command-output');process.exit(1)"], { env: {} }), (error) => {
    assert.match(error.message, /APP build command failed/);
    assert.ok(!error.message.includes("private-command-output"));
    return true;
  });
});

test("unavailable independent pins/toolchain and in-checkout output cannot start a build", async () => {
  for (const name of ["expectedReferenceSha256", "expectedAppSha", "expectedWorkerSha", "toolchain"]) {
    await withBuild(async ({ options, commands, build }) => {
      options[name] = undefined;
      await assert.rejects(build());
      assert.equal(commands.length, 0);
    });

  }
  await withBuild(async ({ options, build }) => {
    options.toolchain = "1.94.0";
    await assert.rejects(build(), /actual Rust\/Cargo toolchain/);
  });
  await withBuild(async ({ options, build }) => {
    options.outputDirectory = join(options.repositoryDirectory, "build");
    await assert.rejects(build(), /outside the approved source/);
  });
});

test("Auth inputs must originate from canonical dotenvx files even when parent environment supplies them", async () => {
  await withBuild(async ({ options, build }) => {
    options.environment.PUBLIC_SUPABASE_URL = "https://ambient.example.com";
    options.environment.PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ambient_fixture";
    await writeFile(join(options.repositoryDirectory, "packages/FUSOU-APP/.env"), "# no Auth inputs\n");
    await writeFile(join(options.repositoryDirectory, "packages/FUSOU-APP/src-tauri/.env"), "# no Auth inputs\n");
    await assert.rejects(build(), /required dotenvx APP public input/);
  });
});

test("public input/secret environment overwrites, file changes and mismatched actual public reports cannot produce a record", async () => {
  for (const mutate of [
    (env) => { env.PUBLIC_SUPABASE_URL = "https://substituted.example.com"; },
    (env) => { env.PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_substituted"; },
    (env) => { env.DISCORD_CLIENT_ID = "999"; },
    (env) => { env.TAURI_SIGNING_PRIVATE_KEY = "private-injected-fixture"; },
    (env) => { env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "private-injected-password"; },
    (env) => { env.NODE_OPTIONS = "--inspect"; },
  ]) {
    await withBuild(async (state) => {
      state.duringBuild = mutate;
      await assert.rejects(state.build(), /changed after input isolation/);
      await assert.rejects(readFile(join(state.options.outputDirectory, "app-build-record.json")), /ENOENT/);
    });
  }
  await withBuild(async (state) => {
    state.duringBuild = () => writeFileSync(join(state.options.repositoryDirectory, "packages/FUSOU-APP/src-tauri/.env"), "# replaced\n");
    await assert.rejects(state.build(), /dotenvx files changed/);
  });
  for (const changeReport of [
    (report) => { report.public_app_configuration_sha256 = "a".repeat(43); },
    (report) => { report.discord_client_id_present = false; },
    (report) => { delete report.public_app_configuration_sha256; },
  ]) {
    await withBuild(async (state) => {
      state.changePublicReport = changeReport;
      await assert.rejects(state.build(), /compiled APP public configuration|actual APP binary public configuration/);
      await assert.rejects(readFile(join(state.options.outputDirectory, "app-build-record.json")), /ENOENT/);
    });
  }
});
