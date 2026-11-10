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
    <div class="h-screen w-full bg-base-100 flex flex-col pt-2">
      <LogViewerComponent />
    </div>
  ),
};
