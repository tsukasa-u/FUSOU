import Page from "../../../../pages/auth/local/signin.astro";
import { pageState } from "../../../storybook-page-state";

export default {
  title: "Pages/auth/local/signin",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {},
  parameters: pageState(),
};

export const ReturnToApiKeys = {
  args: {},
  parameters: pageState({
    query: {
      app_origin: "tauri",
      return_to: "/dashboard/api-keys",
    },
  }),
};
