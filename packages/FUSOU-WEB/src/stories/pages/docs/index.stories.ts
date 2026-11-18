import Page from "../../../pages/docs/index.astro";

export default {
  title: "Pages/docs",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {},
};
