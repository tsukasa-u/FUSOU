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
  render: () => (
    <div class="bg-base-100 min-h-screen p-6">
      <DataCollectionStatusComponent />
    </div>
  ),
};
