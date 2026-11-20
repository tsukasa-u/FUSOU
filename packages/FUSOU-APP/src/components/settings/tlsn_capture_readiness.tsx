import { createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

type ReadinessStage = {
  status: string;
  diagnostic_code: string | null;
};

export type TlsnCaptureReadiness = {
  status: string;
  diagnostic_code: string | null;
  proxy_listener: ReadinessStage;
  pac_server: ReadinessStage;
  pac_application: ReadinessStage;
  runtime_config_freshness: ReadinessStage;
  worker_health: ReadinessStage;
  forwarder_initialization: ReadinessStage;
  candidate_capture: ReadinessStage;
  session_grant: ReadinessStage;
  capture: ReadinessStage;
  browser_proxy_traffic: string;
  notary_connection: string;
  observed_server_identity: string;
  evidence: string;
  gameplay_authorization: string;
};

type ReadinessSnapshot = {
  report: TlsnCaptureReadiness;
  checkedAt: string;
};

const STAGES: Array<
  [
    string,
    keyof Pick<
      TlsnCaptureReadiness,
      | "proxy_listener"
      | "pac_server"
      | "pac_application"
      | "runtime_config_freshness"
      | "worker_health"
      | "forwarder_initialization"
      | "candidate_capture"
      | "session_grant"
      | "capture"
    >,
  ]
> = [
  ["Proxy listener", "proxy_listener"],
  ["PAC server", "pac_server"],
  ["PAC application", "pac_application"],
  ["Runtime Config / Freshness", "runtime_config_freshness"],
  ["Worker health", "worker_health"],
  ["Forwarder initialization", "forwarder_initialization"],
  ["Candidate evidence saving", "candidate_capture"],
  ["Session grant", "session_grant"],
  ["Current capture", "capture"],
];

export function TlsnCaptureReadinessComponent() {
  const [readiness, setReadiness] = createSignal<ReadinessSnapshot | null>(
    null,
  );
  const [loading, setLoading] = createSignal(false);
  const [errorCode, setErrorCode] = createSignal<string | null>(null);

  const readReadiness = async () => {
    setReadiness(null);
    setErrorCode(null);
    setLoading(true);
    try {
      const report = await invoke<TlsnCaptureReadiness>(
        "get_tlsn_capture_readiness",
      );
      setReadiness({ report, checkedAt: new Date().toISOString() });
    } catch {
      setErrorCode("tlsn_capture_readiness_query_failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section>
      <div class="font-semibold">TLSN Capture Readiness</div>
      <p class="mt-1 text-xs">
        Read-only snapshot. It does not refresh configuration, contact services,
        consume a grant, connect to the Notary, or contact a game server.
      </p>
      <p class="mt-1 text-xs">
        The APP-start marker and LOCAL_APP_PREFLIGHT_PASS indicate
        startup/static checks only; neither means capture is ready.
      </p>
      <div class="mt-2">
        <button
          class="btn btn-sm btn-outline"
          onClick={readReadiness}
          disabled={loading()}
        >
          {loading() ? "Reading..." : "Read current readiness"}
        </button>
      </div>
      <Show when={errorCode()}>
        {(code) => (
          <div class="mt-2 text-warning" role="alert">
            Overall: unavailable ({code()})
          </div>
        )}
      </Show>
      <Show when={loading()}>
        <div class="mt-2 text-xs" role="status" aria-live="polite">
          Checking current readiness...
        </div>
      </Show>
      <Show when={readiness()}>
        {(snapshot) => (
          <div class="mt-2 space-y-1 text-xs">
            <div class="font-semibold">
              Overall: {snapshot().report.status}
              <Show when={snapshot().report.diagnostic_code}>
                {(code) => <> ({code()})</>}
              </Show>
            </div>
            <div>
              Confirmed at: {new Date(snapshot().checkedAt).toLocaleString()}
            </div>
            <For each={STAGES}>
              {([label, key]) => {
                const stage = () => snapshot().report[key];
                return (
                  <div>
                    {label}: {stage().status}
                    <Show when={stage().diagnostic_code}>
                      {(code) => <> ({code()})</>}
                    </Show>
                  </div>
                );
              }}
            </For>
            <div>
              Separate checks — browser traffic via PAC:{" "}
              {snapshot().report.browser_proxy_traffic}; Notary connection:{" "}
              {snapshot().report.notary_connection}; observed server identity:{" "}
              {snapshot().report.observed_server_identity}; evidence:{" "}
              {snapshot().report.evidence}; gameplay authorization:{" "}
              {snapshot().report.gameplay_authorization}
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}
