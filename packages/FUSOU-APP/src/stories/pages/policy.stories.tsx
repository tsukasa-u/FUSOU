import type { Meta, StoryObj } from "storybook-solidjs-vite";
import Policy from "../../pages/policy";

const meta: Meta = {
  title: "Pages/Policy",
  component: Policy,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <Policy />,
};
