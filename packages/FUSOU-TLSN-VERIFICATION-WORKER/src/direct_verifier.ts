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

app.post("/internal/tlsn/verification-complete", async (c) => {
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
