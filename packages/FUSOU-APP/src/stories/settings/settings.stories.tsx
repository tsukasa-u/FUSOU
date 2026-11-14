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

    const summary = canvasElement.querySelector("details > summary");
    if (!summary) {
      throw new Error("Missing Individual Dataset Loaders summary");
    }
    (summary as HTMLElement).click();

    await waitFor(() => {
      const loadButtons = Array.from(
        canvasElement.querySelectorAll("details button"),
      );
      expect(loadButtons.length).toBe(12);
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

    (canvasElement.querySelector("details > summary") as HTMLElement).click();
    await waitFor(() => {
      expect(canvasElement.querySelector("details button")).toBeTruthy();
    });
    (
      canvasElement.querySelector("details button") as HTMLButtonElement
    ).click();

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
