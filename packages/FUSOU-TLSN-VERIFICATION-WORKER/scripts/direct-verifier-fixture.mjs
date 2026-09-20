function decodeBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/internal/tlsn/direct-control") {
      if (request.headers.get("X-FUSOU-TLSN-Benchmark-Control") !== "direct-service-binding-v1") {
        return new Response(null, { status: 404 });
      }
      const receivedBytes = (await request.arrayBuffer()).byteLength;
      return Response.json({ ok: true, control: "direct-service-binding-v1", received_bytes: receivedBytes });
    }
    const requestedMode = request.headers.get("X-FUSOU-TLSN-Test-Fault");
    const mode = requestedMode === "failure" || requestedMode === "timeout" || requestedMode === "late_success" || requestedMode === "pause_before_result_commit" || requestedMode === "pause_after_result_commit"
      ? requestedMode
      : env.TLSN_DIRECT_FIXTURE_MODE;
    const traceOrigin = env.TLSN_DIRECT_TRACE_ORIGIN;
    if (traceOrigin) {
      await fetch(`${traceOrigin}/direct-call`, { method: "POST" });
    }
    if (mode === "failure") {
      return new Response(null, { status: 503 });
    }
    if (mode === "timeout" || mode === "late_success") {
      const delayMs = Number(env.TLSN_DIRECT_FIXTURE_TIMEOUT_MS ?? "200");
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delayMs) ? delayMs : 200));
    }
    const callbackOrigin = env.TLSN_DIRECT_CALLBACK_ORIGIN;
    if (!callbackOrigin) {
      return new Response(null, { status: 500 });
    }
    const metadata = request.headers.get("X-FUSOU-TLSN-Direct-Metadata");
    const presentationBody = await request.arrayBuffer();
    const callbackHeaders = new Headers(request.headers);
    if (metadata) {
      callbackHeaders.set("Content-Type", "application/octet-stream");
    }
    const callbackResponse = await fetch(
      `${callbackOrigin}/internal/tlsn/verification-complete`,
      {
        method: request.method,
        headers: callbackHeaders,
        body: presentationBody,
      },
    );
      return callbackResponse;
  },
};
