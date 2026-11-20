import Page from "../../pages/index.astro";

export default {
  title: "Pages/Home",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {},
};
