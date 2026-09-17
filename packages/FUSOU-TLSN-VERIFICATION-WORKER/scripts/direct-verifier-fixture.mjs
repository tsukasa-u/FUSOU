export default {
  async fetch(request, env) {
    const requestedMode = request.headers.get("X-FUSOU-TLSN-Test-Fault");
    const mode = requestedMode === "failure" || requestedMode === "timeout" || requestedMode === "late_success"
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
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const callbackOrigin = env.TLSN_DIRECT_CALLBACK_ORIGIN;
    if (!callbackOrigin) {
      return new Response(null, { status: 500 });
    }
    const callbackResponse = await fetch(
      `${callbackOrigin}/internal/tlsn/verification-complete`,
      {
        method: request.method,
        headers: request.headers,
        body: request.body,
      },
    );
    return new Response(null, { status: callbackResponse.status });
  },
};
