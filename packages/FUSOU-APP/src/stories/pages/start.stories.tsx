import { expect, waitFor } from "storybook/test";
import Start, { StartPage } from "../../pages/start.tsx";

const findButtonByLabel = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll("button")).find(
    (btn) => btn.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

const findTabByLabel = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll('[role="tab"]')).find(
    (tab) => tab.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

export default {
  title: "pages/start",
  component: Start,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  render: function Render() {
    return <Start />;
  },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return <Story {...context.args} />;
    },
  ],
};

export const TabsAndStartModeSettings = {
  render: () => <Start />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(() => {
      expect(findTabByLabel(canvasElement, "Start")).toBeTruthy();
      expect(findTabByLabel(canvasElement, "Settings")).toBeTruthy();
      expect(findTabByLabel(canvasElement, "Logs")).toBeTruthy();
      expect(findTabByLabel(canvasElement, "Policy")).toBeTruthy();
    });

    const startH1 = canvasElement.querySelector("h1") as HTMLElement;
    expect(startH1.textContent?.trim()).toBe("Launch Options");
    const startH1Rect = startH1.getBoundingClientRect();
    expect(canvasElement.querySelector("#open-kancolle-target")).toBeNull();
    expect(canvasElement.textContent).not.toContain("Native browser");
    expect(canvasElement.querySelector("#check-server-status-btn")).toBeNull();
    expect(canvasElement.textContent).not.toContain("Already running");
    expect(canvasElement.textContent).not.toContain("State mismatch");

    // Switch to Settings tab and verify heading position & disabled auth/session buttons
    findTabByLabel(canvasElement, "Settings")!.click();
    await waitFor(() => {
      const settingsBtn = findButtonByLabel(
        canvasElement,
        "Check Session Health",
      );
      expect(settingsBtn).toBeTruthy();
      expect(settingsBtn!.disabled).toBe(true);
      expect(
        findButtonByLabel(canvasElement, "Force Local Sign Out")!.disabled,
      ).toBe(true);
      expect(findButtonByLabel(canvasElement, "Sync Snapshot")!.disabled).toBe(
        true,
      );
      expect(findButtonByLabel(canvasElement, "Load All Data")!.disabled).toBe(
        true,
      );
      // Reload UI and config editor controls remain enabled on Start screen
      expect(findButtonByLabel(canvasElement, "Reload UI")!.disabled).toBe(
        false,
      );
      const themeSelect = canvasElement.querySelector(
        'select[id="cfg-app.theme.theme"]',
      ) as HTMLSelectElement | null;
      expect(themeSelect).toBeTruthy();
      expect(themeSelect!.disabled).toBe(false);
    });

    const settingsH1 = Array.from(canvasElement.querySelectorAll("h1")).find(
      (h) => h.textContent?.trim() === "Settings",
    ) as HTMLElement;
    const settingsH1Rect = settingsH1.getBoundingClientRect();
    expect(settingsH1Rect.top).toBeCloseTo(startH1Rect.top, 0);
    expect(settingsH1Rect.left).toBeCloseTo(startH1Rect.left, 0);

    // Switch to Policy tab and verify unified heading position (no divider mismatch)
    findTabByLabel(canvasElement, "Policy")!.click();
    await waitFor(() => {
      const policyH1 = Array.from(canvasElement.querySelectorAll("h1")).find(
        (h) => h.textContent?.trim() === "通信保全基準",
      ) as HTMLElement | undefined;
      expect(policyH1).toBeTruthy();
      const policyRect = policyH1!.getBoundingClientRect();
      expect(policyRect.top).toBeCloseTo(startH1Rect.top, 0);
      expect(policyRect.left).toBeCloseTo(startH1Rect.left, 0);
    });

    // Switch to Logs tab
    findTabByLabel(canvasElement, "Logs")!.click();
    await waitFor(() => {
      expect(
        findTabByLabel(canvasElement, "Logs")!.getAttribute("aria-selected"),
      ).toBe("true");
    });
  },
};

export const ServersRunning = {
  render: () => <StartPage previewHealth={{ proxy: 1, pac: 1 }} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(() => {
      expect(canvasElement.textContent).toContain("Already running");
      expect(
        canvasElement.querySelector("#check-server-status-btn"),
      ).toBeNull();
      const proxyToggle = canvasElement.querySelector(
        '#run-proxy-server-section input[type="checkbox"]',
      ) as HTMLInputElement | null;
      expect(proxyToggle).toBeTruthy();
      expect(proxyToggle!.disabled).toBe(true);
    });
  },
};

export const ServerStateMismatch = {
  render: () => <StartPage previewHealth={{ proxy: 1, pac: 0 }} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(() => {
      expect(canvasElement.textContent).toContain("State mismatch");
      expect(canvasElement.textContent).toContain("Proxy State Mismatch");
      expect(canvasElement.textContent).toContain(
        "Proxy server is running, but PAC server is stopped.",
      );
      const recheckBtn = canvasElement.querySelector(
        "#check-server-status-btn",
      ) as HTMLButtonElement | null;
      expect(recheckBtn).toBeTruthy();
      expect(recheckBtn!.textContent?.trim()).toBe("Recheck status");
      const startBtn = canvasElement.querySelector(
        "#start-button button",
      ) as HTMLButtonElement | null;
      expect(startBtn).toBeTruthy();
      expect(startBtn!.disabled).toBe(true);
    });
  },
};
