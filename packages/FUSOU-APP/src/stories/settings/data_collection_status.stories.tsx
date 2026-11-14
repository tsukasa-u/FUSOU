import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { DataCollectionStatusComponent } from "../../components/settings/data_collection_status";

const meta: Meta<typeof DataCollectionStatusComponent> = {
  title: "Components/Settings/DataCollectionStatus",
  component: DataCollectionStatusComponent,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof DataCollectionStatusComponent>;

export const Default: Story = {
  render: () => <DataCollectionStatusComponent />,
};

export const UniformButtonsAndInlineSummaries: Story = {
  render: () => <DataCollectionStatusComponent />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    expect(canvasElement.querySelector(".toast")).toBeNull();

    await waitFor(() => {
      expect(canvasElement.querySelectorAll("button").length).toBe(5);
    });

    const buttons = Array.from(canvasElement.querySelectorAll("button"));
    const firstRect = buttons[0].getBoundingClientRect();
    expect(firstRect.width).toBeGreaterThan(0);
    expect(firstRect.height).toBeCloseTo(32, 0);
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      expect(rect.width).toBeCloseTo(firstRect.width, 0);
      expect(rect.height).toBeCloseTo(firstRect.height, 0);
      expect(btn.scrollWidth).toBeLessThanOrEqual(btn.clientWidth);
    }

    const refreshStatusBtn = buttons.find(
      (b) => b.textContent?.trim() === "Refresh Status",
    )!;
    const suppressionBtns = buttons.filter(
      (b) => b.textContent?.trim() === "Refresh Suppression",
    );
    expect(suppressionBtns.length).toBe(3);

    refreshStatusBtn.click();
    for (const btn of suppressionBtns) {
      btn.click();
    }

    await waitFor(() => {
      const statuses = canvasElement.querySelectorAll('[role="status"]');
      expect(statuses.length).toBe(4);
      const text = canvasElement.textContent ?? "";
      expect(text).toContain("Pending retry status");
      expect(text).toContain("Ship growth suppression");
      expect(text).toContain("Quest tree suppression");
      expect(text).toContain("Remodel suppression");
      expect(text).toContain("Desktop runtime required");
    });

    const retryPendingBtn = buttons.find(
      (b) => b.textContent?.trim() === "Retry Pending Now",
    )!;
    retryPendingBtn.click();

    await waitFor(() => {
      const modal = canvasElement.querySelector("dialog.modal");
      expect(modal).toBeTruthy();
      const cancelBtn = Array.from(modal!.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Cancel",
      );
      const runBtn = Array.from(modal!.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Run Retry",
      );
      expect(cancelBtn).toBeTruthy();
      expect(runBtn).toBeTruthy();
      const cancelRect = cancelBtn!.getBoundingClientRect();
      const runRect = runBtn!.getBoundingClientRect();
      expect(runRect.width).toBeCloseTo(cancelRect.width, 0);
      expect(runRect.height).toBeCloseTo(cancelRect.height, 0);
      expect(cancelBtn!.scrollWidth).toBeLessThanOrEqual(
        cancelBtn!.clientWidth,
      );
      expect(runBtn!.scrollWidth).toBeLessThanOrEqual(runBtn!.clientWidth);
      runBtn!.click();
    });

    await waitFor(() => {
      expect(canvasElement.querySelector("dialog.modal")).toBeNull();
      expect(canvasElement.textContent).toContain("Retry pending uploads");
    });

    expect(canvasElement.querySelector(".toast")).toBeNull();
  },
};
