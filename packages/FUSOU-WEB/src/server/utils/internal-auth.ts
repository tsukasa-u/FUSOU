import type { Bindings } from "../types";
import { createEnvContext, getEnv, timingSafeEqual } from "../utils";

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Verify Trigger.dev -> FUSOU-WEB internal calls using the shared
 * `INTERNAL_COMPACTION_TOKEN` passed via the `X-INTERNAL-TOKEN` header.
 */
export function verifyInternalToken(c: {
  env: Bindings;
  req: { header: (name: string) => string | undefined };
}): InternalAuthResult {
  const env = createEnvContext(c);
  const expected = getEnv(env, "INTERNAL_COMPACTION_TOKEN");
  if (!expected) {
    return {
      ok: false,
      status: 403,
      error: "Endpoint disabled (INTERNAL_COMPACTION_TOKEN not set)",
    };
  }

  const provided = c.req.header("X-INTERNAL-TOKEN") ?? "";
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
