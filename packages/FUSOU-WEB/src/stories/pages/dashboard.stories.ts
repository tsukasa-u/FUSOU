import Page from "../../pages/dashboard.astro";

export default {
  title: "Pages/dashboard",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {
    "storybook": true
  },
};
