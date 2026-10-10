import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { APP_PUBLIC_CONFIGURATION_CONTRACT } from "./app-public-configuration.mjs";
import { publicToolEnvironment } from "./app-dotenvx-inputs.mjs";
import { runPublicBuildCommand } from "./app-build-handoff.mjs";

const require = createRequire(import.meta.url);
export const dotenvxCliPath = join(dirname(require.resolve("@dotenvx/dotenvx/package.json")), "src/cli/dotenvx.js");
export const publicFixtureInputs = Object.freeze({
  DISCORD_CLIENT_ID: "123456789",
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public_fixture",
  PUBLIC_SUPABASE_URL: "https://auth.example.com",
});
export const fixtureSecrets = Object.freeze({
  TAURI_SIGNING_PRIVATE_KEY: "private-updater-fixture",
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "private-updater-password-fixture",
  CLOUDFLARE_API_TOKEN: "private-cloudflare-fixture",
  TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY: "private-worker-fixture",
  APP_SIGNING_PRIVATE_KEY: "private-app-fixture",
});

export async function writeDotenvxFixture(appDirectory, { encrypted = false, discord = true } = {}) {
  await mkdir(join(appDirectory, "src-tauri"), { recursive: true });
  await writeFile(join(appDirectory, "package.json"), JSON.stringify({
    scripts: { tauri: APP_PUBLIC_CONFIGURATION_CONTRACT.dotenvx.normal_script },
  }));
  await writeFile(resolve(appDirectory, "../.env.keys"), "# Test-only dotenvx decryption keys\n", { mode: 0o600 });
  const first = {
    PUBLIC_SUPABASE_URL: "https://overridden.example.com",
    PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_overridden_fixture",
    ...(discord ? { DISCORD_CLIENT_ID: "987654321" } : {}),
    ...fixtureSecrets,
  };
  const second = { ...publicFixtureInputs };
  if (!discord) delete second.DISCORD_CLIENT_ID;
  const serialize = (values) => Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n";
  await writeFile(join(appDirectory, ".env"), serialize(first), { mode: 0o600 });
  await writeFile(join(appDirectory, "src-tauri/.env"), serialize(second), { mode: 0o600 });
  if (encrypted) {
    runPublicBuildCommand(process.execPath, [dotenvxCliPath, "encrypt", "--no-create",
      "-fk", "../.env.keys", "-f", ".env", "-f", "src-tauri/.env"], {
      cwd: appDirectory, env: publicToolEnvironment(process.env),
    });
  }
  return publicFixtureInputs;
}
