import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { LogViewerComponent } from "../../components/logger/log-viewer";

const meta: Meta<typeof LogViewerComponent> = {
  title: "Components/Logger/LogViewer",
  component: LogViewerComponent,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof LogViewerComponent>;

export const Default: Story = {
  render: () => (
    <div class="h-screen w-full bg-base-100 flex flex-col pt-2 min-h-0">
      <LogViewerComponent />
    </div>
  ),
};

export const ResponsiveWrappedToolbar: Story = {
  render: () => (
    <div
      data-testid="log-viewer-host"
      class="h-dvh bg-base-100 flex flex-col pt-2 min-h-0 overflow-y-auto"
      style={{ width: "480px" }}
    >
      <LogViewerComponent />
    </div>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const host = canvasElement.querySelector(
      '[data-testid="log-viewer-host"]',
    ) as HTMLDivElement;
    const levelSelect = canvasElement.querySelector(
      'select[aria-label="Filter logs by level"]',
    ) as HTMLSelectElement;
    const listBox = canvasElement.querySelector(
      ".rounded-box.border",
    ) as HTMLDivElement;

    await waitFor(() => {
      expect(levelSelect.getBoundingClientRect().width).toBeLessThanOrEqual(
        120,
      );
      expect(host.scrollHeight).toBeLessThanOrEqual(host.clientHeight);
      expect(listBox.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        host.getBoundingClientRect().bottom,
      );
    });

    const wrappedHeight = listBox.getBoundingClientRect().height;
    host.style.width = "920px";

    await waitFor(() => {
      expect(host.scrollHeight).toBeLessThanOrEqual(host.clientHeight);
      expect(listBox.getBoundingClientRect().height).toBeGreaterThan(
        wrappedHeight,
      );
    });
  },
};
