import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { PolicyPanelComponent } from "../../components/policy/policy_panel";

const meta: Meta<typeof PolicyPanelComponent> = {
  title: "Components/Policy/PolicyPanel",
  component: PolicyPanelComponent,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    showBackLink: true,
  },
};

export default meta;
type Story = StoryObj<typeof PolicyPanelComponent>;

export const WithBackLink: Story = {
  args: {
    showBackLink: true,
  },
};

export const StandaloneModal: Story = {
  args: {
    showBackLink: false,
  },
};
