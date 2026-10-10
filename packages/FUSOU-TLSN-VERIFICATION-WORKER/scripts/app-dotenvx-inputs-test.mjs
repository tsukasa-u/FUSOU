import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadCanonicalAppDotenvx, publicToolEnvironment } from "./app-dotenvx-inputs.mjs";
import {
  APP_PUBLIC_CONFIGURATION_CONTRACT, publicAppConfigurationSha256, publicAppEnvironment,
} from "./app-public-configuration.mjs";
import { approvedBuildEnvironment, runPublicBuildCommand } from "./app-build-handoff.mjs";
import { dotenvxCliPath, fixtureSecrets, publicFixtureInputs, writeDotenvxFixture } from "./app-dotenvx-fixture.mjs";
import { release } from "./app-worker-reference-fixture.mjs";

async function fixture(action, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "fusou-app-dotenvx-test-"));
  const app = join(root, "packages/FUSOU-APP");
  try {
    await writeDotenvxFixture(app, options);
    await action(app);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("canonical dotenvx engine decrypts both files and preserves normal --overload precedence without ambient bootstrap", async () => {
  await fixture(async (app) => {
    const ambient = {
      PUBLIC_SUPABASE_URL: "https://ambient.example.com", PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ambient",
      DISCORD_CLIENT_ID: "444", ...fixtureSecrets,
    };
    const loaded = await loadCanonicalAppDotenvx(app, ambient);
    assert.deepEqual(loaded.inputs, publicFixtureInputs);
    const normal = JSON.parse(runPublicBuildCommand(process.execPath, [dotenvxCliPath, "run",
      "-fk", "../.env.keys", "-f", ".env", "-f", "src-tauri/.env", "--overload", "--strict", "--quiet",
      "--", process.execPath, "-e",
      `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(APP_PUBLIC_CONFIGURATION_CONTRACT.compile_inputs)}.map(name=>[name,process.env[name]??null]))))`,
    ], { cwd: app, env: { ...publicToolEnvironment(process.env), ...ambient } }));
    assert.deepEqual(loaded.inputs, normal);
    assert.match(await readFile(join(app, "src-tauri/.env"), "utf8"), /encrypted:/);
    const buildEnv = approvedBuildEnvironment(ambient, { compile_inputs: release.compile_inputs }, "a".repeat(40), "/public/target", loaded.inputs);
    for (const name of Object.keys(fixtureSecrets)) assert.equal(buildEnv[name], undefined);
    assert.equal(buildEnv.DOTENV_PRIVATE_KEY, undefined);
    assert.equal(Object.keys(publicAppEnvironment(loaded.inputs)).length, 3);
    assert.ok(!JSON.stringify(loaded.reference).includes(loaded.inputs.PUBLIC_SUPABASE_URL));
  }, { encrypted: true });
});

test("missing canonical files and missing Auth cannot fall back to parent env or .env.local", async () => {
  for (const path of ["../.env.keys", ".env", "src-tauri/.env"]) {
    await fixture(async (app) => {
      await rm(resolve(app, path));
      await assert.rejects(loadCanonicalAppDotenvx(app, publicFixtureInputs), /canonical dotenvx input file/);
    });
  }
  await fixture(async (app) => {
    await writeFile(join(app, ".env"), "# missing required inputs\n");
    await writeFile(join(app, "src-tauri/.env"), "# missing required inputs\n");
    await writeFile(join(app, ".env.local"), "PUBLIC_SUPABASE_URL=https://unapproved.example.com\nPUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_unapproved\n");
    await assert.rejects(loadCanonicalAppDotenvx(app, publicFixtureInputs), /required dotenvx APP public input/);
  });
});

test("missing/wrong decryption keys, malformed ciphertext and normal-script drift fail without secret diagnostics", async () => {
  for (const mutate of [
    async (app) => writeFile(resolve(app, "../.env.keys"), "# no decryption key\n"),
    async (app) => writeFile(resolve(app, "../.env.keys"), `DOTENV_PRIVATE_KEY=${"a".repeat(64)}\n`),
    async (app) => writeFile(join(app, "src-tauri/.env"), 'PUBLIC_SUPABASE_URL="encrypted:private-malformed-marker"\n'),
  ]) {
    await fixture(async (app) => {
      await mutate(app);
      await assert.rejects(loadCanonicalAppDotenvx(app, {}), (error) => {
        assert.match(error.message, /dotenvx loading\/decryption failed/);
        for (const secret of [...Object.values(fixtureSecrets), "private-malformed-marker"]) assert.ok(!error.message.includes(secret));
        return true;
      });
    }, { encrypted: true });
  }
  await fixture(async (app) => {
    await assert.rejects(loadCanonicalAppDotenvx(app, { DOTENV_PRIVATE_KEY: "a".repeat(64) }), /loading\/decryption failed/);
  }, { encrypted: true });
  await fixture(async (app) => {
    await writeFile(join(app, "package.json"), JSON.stringify({ scripts: { tauri: "dotenvx run -f src-tauri/.env -f .env -- tauri" } }));
    await assert.rejects(loadCanonicalAppDotenvx(app, {}), /precedence contract changed/);
  });
});

test("public digest binds every actual option_env input; optional Discord absence is explicit and files cannot change in-flight", async () => {
  const vector = APP_PUBLIC_CONFIGURATION_CONTRACT.test_vector;
  assert.equal(publicAppConfigurationSha256(vector.compile_inputs), vector.sha256);
  for (const name of APP_PUBLIC_CONFIGURATION_CONTRACT.required_inputs) {
    assert.throws(() => publicAppConfigurationSha256({ ...publicFixtureInputs, [name]: null }), /required dotenvx APP public input/);
    assert.throws(() => publicAppConfigurationSha256({ ...publicFixtureInputs, [name]: "" }), /required dotenvx APP public input/);
  }
  await fixture(async (app) => {
    const loaded = await loadCanonicalAppDotenvx(app, {});
    const baseline = publicAppConfigurationSha256(loaded.inputs);
    for (const [name, value] of [
      ["PUBLIC_SUPABASE_URL", "https://changed.example.com"],
      ["PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_changed"],
      ["DISCORD_CLIENT_ID", "333"],
    ]) assert.notEqual(publicAppConfigurationSha256({ ...loaded.inputs, [name]: value }), baseline);
    assert.throws(() => publicAppConfigurationSha256({ ...loaded.inputs, EXTRA_SECRET: "private-fixture" }), /field inventory/);
    await writeFile(join(app, ".env"), "# changed\n");
    await assert.rejects(loaded.assertUnchanged(), /dotenvx files changed/);
  });
  await fixture(async (app) => {
    const loaded = await loadCanonicalAppDotenvx(app, { DISCORD_CLIENT_ID: "ambient-discord-not-authority" });
    assert.equal(loaded.inputs.DISCORD_CLIENT_ID, null);
    assert.equal(publicAppEnvironment(loaded.inputs).DISCORD_CLIENT_ID, undefined);
  }, { discord: false });
  await fixture(async (app) => {
    const loaded = await loadCanonicalAppDotenvx(app, {});
    await writeFile(resolve(app, "../.env.keys"), "# decryption-key file replaced\n");
    await assert.rejects(loaded.assertUnchanged(), /dotenvx files changed/);
  });
});
