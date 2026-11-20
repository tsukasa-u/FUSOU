import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import {
  TlsnCaptureReadinessComponent,
  type TlsnCaptureReadiness,
} from "../../components/settings/tlsn_capture_readiness";

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
  browser_proxy_traffic: "not_checked",
  notary_connection: "not_checked",
  observed_server_identity: "not_checked",
  evidence: "not_checked",
  gameplay_authorization: "not_checked",
};

const meta = {
  title: "Settings/TLSN Capture Readiness",
  component: TlsnCaptureReadinessComponent,
} satisfies Meta<typeof TlsnCaptureReadinessComponent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ClearsPreviousReadyWhenTheNextReadFails: Story = {
  play: async ({ canvasElement }) => {
    type TauriInternals = Record<string, unknown> & {
      invoke?: (...args: unknown[]) => Promise<unknown>;
    };
    const storyWindow = window as Window & {
      __TAURI_INTERNALS__?: TauriInternals;
    };
    const previousInternals = storyWindow.__TAURI_INTERNALS__;
    let queryCount = 0;
    let rejectSecondQuery: (() => void) | undefined;

    storyWindow.__TAURI_INTERNALS__ = {
      ...previousInternals,
      invoke: async (...args: unknown[]) => {
        if (args[0] !== "get_tlsn_capture_readiness") {
          throw new Error("unexpected synthetic Tauri command");
        }
        queryCount += 1;
        if (queryCount === 1) {
          return readyReport;
        }
        return new Promise<never>((_resolve, reject) => {
          rejectSecondQuery = () => reject(new Error("synthetic IPC failure"));
        });
      },
    };

    const canvas = within(canvasElement);
    try {
      const readButton = canvas.getByRole("button", {
        name: "Read current readiness",
      });
      await userEvent.click(readButton);
      await waitFor(() => {
        expect(canvas.getByText("Overall: ready")).toBeTruthy();
      });
      expect(canvas.getByText(/^Confirmed at:/)).toBeTruthy();

      await userEvent.click(readButton);
      await waitFor(() => {
        expect(canvas.getByRole("status").textContent).toContain(
          "Checking current readiness",
        );
      });
      expect(canvas.queryByText("Overall: ready")).toBeNull();
      expect(canvas.queryByText(/^Confirmed at:/)).toBeNull();

      if (!rejectSecondQuery) {
        throw new Error("second synthetic readiness query did not start");
      }
      rejectSecondQuery();
      await waitFor(() => {
        expect(canvas.getByRole("alert").textContent).toBe(
          "Overall: unavailable (tlsn_capture_readiness_query_failed)",
        );
      });
      expect(canvas.queryByText("Overall: ready")).toBeNull();
    } finally {
      if (previousInternals) {
        storyWindow.__TAURI_INTERNALS__ = previousInternals;
      } else {
        delete storyWindow.__TAURI_INTERNALS__;
      }
    }
  },
};
