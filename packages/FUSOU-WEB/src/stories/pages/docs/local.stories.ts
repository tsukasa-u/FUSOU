import Page from "../../../pages/docs/local.astro";

export default {
  title: "Pages/docs/local",
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
