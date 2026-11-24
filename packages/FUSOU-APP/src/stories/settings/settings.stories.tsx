import { expect, fn, waitFor } from "storybook/test";

import { SettingsComponent } from "../../components/settings/settings.tsx";

const SETTING_ROW_BUTTON_LABELS = [
  "Sync Snapshot",
  "Reload UI",
  "Check Session Health",
  "Force Local Sign Out",
  "Load All Data",
];

const findButtonByLabel = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll("button")).find(
    (btn) => btn.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

export default {
  title: "components/settings/settings",
  component: SettingsComponent,
  tags: ["autodocs"],
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onClick: fn() },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return <Story {...context.args} />;
    },
  ],
};

export const UniformButtonSizing = {
  render: () => <SettingsComponent />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(() => {
      for (const label of SETTING_ROW_BUTTON_LABELS) {
        expect(findButtonByLabel(canvasElement, label)).toBeTruthy();
      }
    });

    const rowButtons = SETTING_ROW_BUTTON_LABELS.map((label) => {
      const btn = findButtonByLabel(canvasElement, label);
      if (!btn) {
        throw new Error(`Missing button: ${label}`);
      }
      return btn;
    });

    const firstRect = rowButtons[0].getBoundingClientRect();
    expect(firstRect.width).toBeGreaterThan(0);
    expect(firstRect.height).toBeCloseTo(32, 0);
    for (const btn of rowButtons) {
      const rect = btn.getBoundingClientRect();
      expect(rect.width).toBeCloseTo(firstRect.width, 0);
      expect(rect.height).toBeCloseTo(firstRect.height, 0);
      expect(btn.scrollWidth).toBeLessThanOrEqual(btn.clientWidth);
    }

    const signOutBtn = findButtonByLabel(
      canvasElement,
      "Force Local Sign Out",
    )!;
    signOutBtn.click();

    await waitFor(() => {
      expect(findButtonByLabel(canvasElement, "Cancel")).toBeTruthy();
      expect(findButtonByLabel(canvasElement, "Confirm Sign Out")).toBeTruthy();
    });

    const cancelBtn = findButtonByLabel(canvasElement, "Cancel")!;
    const confirmBtn = findButtonByLabel(canvasElement, "Confirm Sign Out")!;
    const cancelRect = cancelBtn.getBoundingClientRect();
    const confirmRect = confirmBtn.getBoundingClientRect();
    expect(confirmRect.width).toBeCloseTo(cancelRect.width, 0);
    expect(confirmRect.height).toBeCloseTo(cancelRect.height, 0);
    expect(cancelBtn.scrollWidth).toBeLessThanOrEqual(cancelBtn.clientWidth);
    expect(confirmBtn.scrollWidth).toBeLessThanOrEqual(confirmBtn.clientWidth);

    const loaderDetails = canvasElement.querySelector(
      '[data-testid="individual-dataset-loaders"]',
    );
    const summary = loaderDetails?.querySelector(":scope > summary");
    if (!loaderDetails || !summary) {
      throw new Error("Missing Individual Dataset Loaders summary");
    }
    (summary as HTMLElement).click();

    await waitFor(() => {
      const loadButtons = Array.from(loaderDetails.querySelectorAll("button"));
      expect(loadButtons.length).toBe(14);
      const firstLoadRect = loadButtons[0].getBoundingClientRect();
      expect(firstLoadRect.width).toBeCloseTo(80, 0);
      expect(firstLoadRect.height).toBeCloseTo(24, 0);
      for (const btn of loadButtons) {
        const rect = btn.getBoundingClientRect();
        expect(rect.width).toBeCloseTo(firstLoadRect.width, 0);
        expect(rect.height).toBeCloseTo(firstLoadRect.height, 0);
        expect(btn.scrollWidth).toBeLessThanOrEqual(btn.clientWidth);
      }
    });
  },
};

export const InlineResultSummaries = {
  render: () => <SettingsComponent />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    expect(canvasElement.querySelector(".toast")).toBeNull();

    await waitFor(() => {
      expect(findButtonByLabel(canvasElement, "Sync Snapshot")).toBeTruthy();
    });

    findButtonByLabel(canvasElement, "Sync Snapshot")!.click();
    findButtonByLabel(canvasElement, "Check Session Health")!.click();
    findButtonByLabel(canvasElement, "Load All Data")!.click();

    findButtonByLabel(canvasElement, "Force Local Sign Out")!.click();
    await waitFor(() => {
      expect(findButtonByLabel(canvasElement, "Confirm Sign Out")).toBeTruthy();
    });
    findButtonByLabel(canvasElement, "Confirm Sign Out")!.click();

    const loaderDetails = canvasElement.querySelector(
      '[data-testid="individual-dataset-loaders"]',
    )!;
    (loaderDetails.querySelector(":scope > summary") as HTMLElement).click();
    await waitFor(() => {
      expect(loaderDetails.querySelector("button")).toBeTruthy();
    });
    (loaderDetails.querySelector("button") as HTMLButtonElement).click();

    await waitFor(() => {
      const text = canvasElement.textContent ?? "";
      expect(text).toContain("Snapshot sync");
      expect(text).toContain("Session check");
      expect(text).toContain("Local sign out");
      expect(text).toContain("Cached data");
      expect(text).toContain("mst_ships");
      expect(text).toContain("Desktop runtime required");
      expect(canvasElement.querySelectorAll('[role="status"]').length).toBe(5);
      expect(canvasElement.querySelectorAll('[role="alert"]').length).toBe(0);
    });

    expect(canvasElement.querySelector(".toast")).toBeNull();
  },
};

export const ConfigRestartChoiceModal = {
  render: () => {
    const onRestart = fn();
    return (
      <SettingsComponent
        configPreview={{
          configPath:
            "C:/Users/example/AppData/Roaming/FUSOU/user/configs.toml",
          onRestart,
        }}
      />
    );
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-testid="config-editor"]'),
      ).toBeTruthy();
    });

    // Toggle a restart-required setting (Local Filesystem Storage)
    const localStorageToggle = canvasElement.querySelector(
      'input[id="cfg-app.database.allow_data_to_local"]',
    ) as HTMLInputElement | null;
    expect(localStorageToggle).toBeTruthy();
    localStorageToggle!.click();

    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-testid="config-save-bar"]'),
      ).toBeTruthy();
      expect(findButtonByLabel(canvasElement, "Save Changes")).toBeTruthy();
    });

    findButtonByLabel(canvasElement, "Save Changes")!.click();

    // Restart choice modal should appear with Restart Later & Restart Now
    await waitFor(() => {
      const modal = canvasElement.querySelector(
        '[data-testid="restart-required-modal"]',
      );
      expect(modal).toBeTruthy();
      expect(
        findButtonByLabel(modal as HTMLElement, "Restart Later"),
      ).toBeTruthy();
      expect(
        findButtonByLabel(modal as HTMLElement, "Restart Now"),
      ).toBeTruthy();
      expect(modal!.textContent).toContain("Local Filesystem Storage");
    });

    // Choosing Restart Later closes the modal and shows the persistent pending banner
    findButtonByLabel(canvasElement, "Restart Later")!.click();

    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-testid="restart-required-modal"]'),
      ).toBeNull();
      const banner = canvasElement.querySelector(
        '[data-testid="pending-restart-banner"]',
      );
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toContain("Local Filesystem Storage");
    });
  },
};

export const ImmediateConfigSaveWithoutRestart = {
  render: () => (
    <SettingsComponent
      configPreview={{
        configPath: "C:/Users/example/AppData/Roaming/FUSOU/user/configs.toml",
      }}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    await waitFor(() => {
      expect(
        canvasElement.querySelector(
          'input[id="cfg-app.browser.external_screenshot_directory"]',
        ),
      ).toBeTruthy();
    });

    const screenshotInput = canvasElement.querySelector(
      'input[id="cfg-app.browser.external_screenshot_directory"]',
    ) as HTMLInputElement;
    screenshotInput.value = "C:/Users/example/Pictures/FUSOU/custom";
    screenshotInput.dispatchEvent(new Event("input", { bubbles: true }));

    await waitFor(() => {
      expect(findButtonByLabel(canvasElement, "Save Changes")).toBeTruthy();
    });

    findButtonByLabel(canvasElement, "Save Changes")!.click();

    await waitFor(() => {
      expect(canvasElement.textContent).toContain("Applied immediately");
      expect(
        canvasElement.querySelector('[data-testid="restart-required-modal"]'),
      ).toBeNull();
    });
  },
};
