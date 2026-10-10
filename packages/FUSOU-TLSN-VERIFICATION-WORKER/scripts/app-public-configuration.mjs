import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "./production-trust-contract.mjs";

export const APP_PUBLIC_CONFIGURATION_CONTRACT = JSON.parse(await readFile(
  new URL("./app-public-configuration-contract-v1.json", import.meta.url), "utf8",
));

export function validatePublicAppInputs(values) {
  const inputs = Object.fromEntries(APP_PUBLIC_CONFIGURATION_CONTRACT.compile_inputs.map((name) => [name, values[name] ?? null]));
  for (const name of APP_PUBLIC_CONFIGURATION_CONTRACT.required_inputs) {
    if (typeof inputs[name] !== "string" || !inputs[name].trim() || inputs[name].includes("\0")) {
      throw new Error(`required dotenvx APP public input is missing or invalid: ${name}`);
    }
  }
  let url;
  try {
    url = new URL(inputs.PUBLIC_SUPABASE_URL);
  } catch {
    throw new Error("public APP Supabase endpoint is invalid");
  }
  if (inputs.PUBLIC_SUPABASE_URL !== inputs.PUBLIC_SUPABASE_URL.trim() ||
      url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("public APP Supabase endpoint is invalid");
  }
  const key = inputs.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let anonymousJwt = false;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    } catch {
      throw new Error("public Supabase key payload is invalid");
    }
    anonymousJwt = payload?.role === "anon";
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && !anonymousJwt) {
    throw new Error("APP build accepts only a public Supabase publishable/anon key, not private credentials");
  }
  if (inputs.DISCORD_CLIENT_ID !== null &&
      (typeof inputs.DISCORD_CLIENT_ID !== "string" || !/^\d+$/.test(inputs.DISCORD_CLIENT_ID))) {
    throw new Error("public APP Discord client ID is invalid");
  }
  return Object.freeze(inputs);
}

export function publicAppConfigurationSha256(inputs) {
  const fields = APP_PUBLIC_CONFIGURATION_CONTRACT.compile_inputs;
  if (!inputs || JSON.stringify(Object.keys(inputs).sort()) !== JSON.stringify(fields)) {
    throw new Error("APP public configuration field inventory is invalid");
  }
  const checked = validatePublicAppInputs(inputs);
  return createHash("sha256").update(canonicalJson({
    schema_version: APP_PUBLIC_CONFIGURATION_CONTRACT.schema_version,
    scope: APP_PUBLIC_CONFIGURATION_CONTRACT.scope,
    compile_inputs: checked,
  })).digest("base64url");
}

export function publicAppEnvironment(inputs) {
  return Object.fromEntries(Object.entries(validatePublicAppInputs(inputs)).filter(([, value]) => value !== null));
}
