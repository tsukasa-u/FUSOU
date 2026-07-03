import { Hono } from "hono";
import type { Bindings } from "../types";
import { createEnvContext, getEnv } from "../utils";
import {
  canonicalizeAttestationConfig,
  signAttestationConfig,
} from "../utils/attestation-config-sign";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/config", async (c) => {
  const env = createEnvContext(c);
  const rawConfig = getEnv(env, "ATTESTATION_CONFIG_JSON")?.trim();
  const signingPrivateKey = getEnv(env, "ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY")?.trim();

  if (!rawConfig) {
    return c.json(
      {
        error: true,
        message: "ATTESTATION_CONFIG_JSON is not configured",
      },
      503,
    );
  }

  if (!signingPrivateKey) {
    return c.json(
      {
        error: true,
        message: "ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY is not configured",
      },
      503,
    );
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch {
    return c.json(
      {
        error: true,
        message: "ATTESTATION_CONFIG_JSON is not valid JSON",
      },
      500,
    );
  }

  if (!parsedConfig || typeof parsedConfig !== "object" || Array.isArray(parsedConfig)) {
    return c.json(
      {
        error: true,
        message: "ATTESTATION_CONFIG_JSON must be a JSON object",
      },
      500,
    );
  }

  const canonical = canonicalizeAttestationConfig(parsedConfig as any);
  const signature = await signAttestationConfig(canonical, signingPrivateKey);

  c.header("X-FUSOU-Config-Signature", signature);
  c.header("Cache-Control", "public, max-age=300, must-revalidate");
  c.header("Content-Type", "application/json; charset=utf-8");
  return c.body(canonical);
});

export default app;
