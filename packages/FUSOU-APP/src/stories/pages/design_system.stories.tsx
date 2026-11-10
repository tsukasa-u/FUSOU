import type { Meta, StoryObj } from "storybook-solidjs-vite";
import DesignSystemPage from "../../pages/design-system";

const meta: Meta = {
  title: "Pages/DesignSystemCatalog",
  component: DesignSystemPage,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj;

export const FullCatalogPage: Story = {
  render: () => <DesignSystemPage />,
};
