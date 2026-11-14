import { expect, waitFor } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  LogViewerComponent,
  type LogEntry,
} from "../../components/logger/log-viewer";

const SAMPLE_LOGS: LogEntry[] = [
  {
    datetime: "2026-11-15T02:50:16.123",
    level: "INFO",
    target: "runtime",
    message: "Proxy server listening on 127.0.0.1:8080",
  },
  {
    datetime: "2026-11-15T02:50:17.456",
    level: "WARN",
    target: "network",
    message: "[GET] /kcsapi/api_start2/getData slow response (420ms)",
  },
  {
    datetime: "2026-11-15T02:50:18.789",
    level: "ERROR",
    target: "storage",
    message: "Temporary retry queued for local snapshot write",
  },
];

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

export const WithTableHeaderAndLogs: Story = {
  render: () => (
    <div class="h-screen w-full bg-base-100 flex flex-col pt-2 min-h-0">
      <LogViewerComponent initialLogs={SAMPLE_LOGS} />
    </div>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const header = canvasElement.querySelector(
      "[data-log-header]",
    ) as HTMLDivElement;
    expect(header).not.toBeNull();

    const headerCells = Array.from(header.children) as HTMLElement[];
    expect(headerCells.map((el) => el.textContent?.trim())).toEqual([
      "Timestamp",
      "Level",
      "Target / Message",
    ]);

    await waitFor(() => {
      const firstRow = canvasElement.querySelector(
        "[data-log-entry]",
      ) as HTMLDivElement | null;
      expect(firstRow).not.toBeNull();

      const rowCells = Array.from(firstRow!.children) as HTMLElement[];
      expect(rowCells.length).toBe(3);

      // Timestamp fits without truncation/clipping
      expect(rowCells[0].scrollWidth).toBeLessThanOrEqual(
        rowCells[0].clientWidth,
      );

      // Header columns align vertically with log row columns
      for (let i = 0; i < 3; i++) {
        expect(
          Math.abs(
            headerCells[i].getBoundingClientRect().left -
              rowCells[i].getBoundingClientRect().left,
          ),
        ).toBeLessThanOrEqual(1);
      }
    });
  },
};
