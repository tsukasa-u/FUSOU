import { Hono } from "hono";
import {
  processVerificationCompletion,
  decodeBase64Url,
  readRawBody,
  readRawBytes,
  verificationCompletionContextFromHono,
  type Bindings,
  type TestDirectFault,
  TlsnBindingAuthorityDurableObject,
} from "./index.js";

const MAX_INTERNAL_CALLBACK_JSON_BYTES = 64 * 1024;
const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
const DIRECT_METADATA_HEADER = "X-FUSOU-TLSN-Direct-Metadata";

const app = new Hono<{ Bindings: Bindings }>();

async function delayTestDirectVerifier(env: Bindings): Promise<void> {
  if (env.TLSN_ENVIRONMENT !== "test") return;
  const delayMs = Number(env.TLSN_TEST_DIRECT_VERIFIER_DELAY_MS);
  if (!Number.isInteger(delayMs) || delayMs <= 0 || delayMs > 5_000) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

app.post("/internal/tlsn/verification-complete", async (c) => {
  const requestedMode = c.req.header("X-FUSOU-TLSN-Test-Fault")?.trim();
  const configuredMode = c.env.TLSN_TEST_DIRECT_VERIFIER_MODE?.trim();
  const mode: TestDirectFault | undefined = requestedMode === "failure" || requestedMode === "timeout" || requestedMode === "late_success" || requestedMode === "pause_before_result_commit" || requestedMode === "pause_after_result_commit"
    ? requestedMode
    : configuredMode === "failure" || configuredMode === "timeout" || configuredMode === "late_success" || configuredMode === "pause_before_result_commit" || configuredMode === "pause_after_result_commit"
      ? configuredMode
      : undefined;
  if (c.env.TLSN_ENVIRONMENT === "test") {
    if (mode === "failure") {
      return new Response(null, { status: 503 });
    }
    if (mode === "timeout" || mode === "late_success") {
      await delayTestDirectVerifier(c.env);
    }
  }
  const executionStartedAt = Date.now();
  const encodedMetadata = c.req.header(DIRECT_METADATA_HEADER);
  let rawBody: string | null = null;
  let presentationBytes: Uint8Array | undefined;
  let presentationReadTiming: {
    readStartedAt: number;
    readCompletedAt: number;
    readDurationMilliseconds: number;
  } | undefined;
  if (encodedMetadata) {
    const presentationReadStartedAt = performance.now();
    const presentationReadStartedWallClock = Date.now();
    presentationBytes = await readRawBytes(c.req.raw, MAX_PRESENTATION_BYTES).catch(() => undefined);
    const presentationReadCompletedAt = performance.now();
    const presentationReadCompletedWallClock = Date.now();
    try {
      rawBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        decodeBase64Url(encodedMetadata, MAX_INTERNAL_CALLBACK_JSON_BYTES),
      );
      presentationReadTiming = {
        readStartedAt: presentationReadStartedWallClock,
        readCompletedAt: presentationReadCompletedWallClock,
        readDurationMilliseconds: presentationReadCompletedAt - presentationReadStartedAt,
      };
    } catch {
      rawBody = null;
    }
  } else {
    rawBody = await readRawBody(c.req.raw, MAX_INTERNAL_CALLBACK_JSON_BYTES).catch(() => null);
  }
  const jobId = c.req.header("X-FUSOU-TLSN-Job-Id") ?? "";
  const signature = c.req.header("X-FUSOU-TLSN-Signature") ?? null;
  const synchronousCandidate = c.env.TLSN_ENVIRONMENT === "test"
    && c.req.header("X-FUSOU-TLSN-Synchronous-Candidate") === "true";
  if (rawBody === null || (encodedMetadata && !presentationBytes) || !jobId || !signature) {
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
    mode,
    presentationBytes,
    presentationReadTiming,
    synchronousCandidate,
  );
});

export { app, TlsnBindingAuthorityDurableObject };
export default { fetch: app.fetch };
