import type { Meta, StoryObj } from "storybook-solidjs-vite";
import Debug from "../../pages/debug";

const meta: Meta = {
  title: "Pages/Debug",
  component: Debug,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <Debug />,
};
