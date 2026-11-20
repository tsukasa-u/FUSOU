import Page from "../../../../pages/auth/local/callback.astro";
import { pageState } from "../../../storybook-page-state";

export default {
  title: "Pages/auth/local/callback",
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

export const AssociationFailure = {
  args: {
    association_error: "1",
    app_origin: "tauri",
    return_to: "/dashboard/api-keys",
  },
  parameters: pageState({
    query: {
      association_error: "1",
      app_origin: "tauri",
      return_to: "/dashboard/api-keys",
    },
  }),
};
