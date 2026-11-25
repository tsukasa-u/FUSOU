import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";

import type { TlsnCaptureReadiness } from "./tlsn_capture_readiness";
import { TlsnCaptureReadinessComponent } from "./tlsn_capture_readiness";

type InvokeMock = (command: string) => Promise<TlsnCaptureReadiness>;

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<InvokeMock>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const readyReport: TlsnCaptureReadiness = {
  status: "ready",
  diagnostic_code: null,
  proxy_listener: { status: "verified", diagnostic_code: null },
  pac_server: { status: "verified", diagnostic_code: null },
  pac_application: { status: "verified", diagnostic_code: null },
  runtime_config_freshness: { status: "verified", diagnostic_code: null },
  worker_health: { status: "verified", diagnostic_code: null },
  forwarder_initialization: { status: "verified", diagnostic_code: null },
  candidate_capture: { status: "verified", diagnostic_code: null },
  session_grant: { status: "ready", diagnostic_code: null },
  capture: { status: "ready", diagnostic_code: null },
  capture_execution_state: "notary_failed",
  browser_proxy_traffic: "not_checked",
  notary_connection: "not_checked",
  observed_server_identity: "not_checked",
  evidence: "not_checked",
  gameplay_authorization: "not_checked",
};

afterEach(() => {
  invokeMock.mockReset();
});

it("clears the previous ready snapshot while refresh is pending and shows IPC failure", async () => {
  let queryCount = 0;
  let rejectSecondQuery: (() => void) | undefined;

  invokeMock.mockImplementation(() => {
    queryCount += 1;
    if (queryCount === 1) {
      return Promise.resolve(readyReport);
    }

    return new Promise<TlsnCaptureReadiness>((_resolve, reject) => {
      rejectSecondQuery = () => reject(new Error("synthetic IPC failure"));
    });
  });

  const container = document.createElement("div");
  document.body.append(container);
  let dispose: (() => void) | undefined;

  try {
    dispose = render(() => <TlsnCaptureReadinessComponent />, container);
    const readButton = container.querySelector("button");
    if (!readButton) {
      throw new Error("readiness button was not rendered");
    }

    readButton.click();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Overall: ready");
      expect(container.textContent).toContain("Confirmed at:");
      expect(container.textContent).toContain(
        "Latest capture state: notary_failed",
      );
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "get_tlsn_capture_readiness",
    );

    readButton.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "Checking current readiness",
      );
    });
    expect(container.textContent).not.toContain("Overall: ready");
    expect(container.textContent).not.toContain("Confirmed at:");
    expect(container.textContent).not.toContain("Latest capture state:");

    if (!rejectSecondQuery) {
      throw new Error("second synthetic readiness query did not start");
    }
    rejectSecondQuery();

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "Overall: unavailable (tlsn_capture_readiness_query_failed)",
      );
    });
    expect(container.textContent).not.toContain("Overall: ready");
  } finally {
    dispose?.();
    container.remove();
  }
});
