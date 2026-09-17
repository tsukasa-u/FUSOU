import { Hono } from "hono";
import {
  processVerificationCompletion,
  readRawBody,
  verificationCompletionContextFromHono,
  type Bindings,
  TlsnBindingAuthorityDurableObject,
} from "./index.js";

const MAX_INTERNAL_CALLBACK_JSON_BYTES = 64 * 1024;

const app = new Hono<{ Bindings: Bindings }>();

async function delayTestDirectVerifier(env: Bindings): Promise<void> {
  if (env.TLSN_ENVIRONMENT !== "test") return;
  const delayMs = Number(env.TLSN_TEST_DIRECT_VERIFIER_DELAY_MS);
  if (!Number.isInteger(delayMs) || delayMs <= 0 || delayMs > 5_000) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

app.post("/internal/tlsn/verification-complete", async (c) => {
  if (c.env.TLSN_ENVIRONMENT === "test") {
    const requestedMode = c.req.header("X-FUSOU-TLSN-Test-Fault")?.trim();
    const mode = requestedMode === "failure" || requestedMode === "timeout" || requestedMode === "late_success"
      ? requestedMode
      : c.env.TLSN_TEST_DIRECT_VERIFIER_MODE?.trim();
    if (mode === "failure") {
      return new Response(null, { status: 503 });
    }
    if (mode === "timeout" || mode === "late_success") {
      await delayTestDirectVerifier(c.env);
    }
  }
  const executionStartedAt = Date.now();
  const rawBody = await readRawBody(c.req.raw, MAX_INTERNAL_CALLBACK_JSON_BYTES).catch(() => null);
  const jobId = c.req.header("X-FUSOU-TLSN-Job-Id") ?? "";
  const signature = c.req.header("X-FUSOU-TLSN-Signature") ?? null;
  if (rawBody === null || !jobId || !signature) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return processVerificationCompletion(
    verificationCompletionContextFromHono(c),
    rawBody,
    jobId,
    signature,
    "direct",
    false,
    executionStartedAt,
  );
});

export { app, TlsnBindingAuthorityDurableObject };
export default { fetch: app.fetch };
