import Page from "../../../pages/docs/api-schema.astro";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/docs/api-schema",
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

export const EndpointCatalog = {
  args: {},
  parameters: pageState({ query: { mode: "endpoints" } }),
};

export const EndpointBaseline = {
  args: {},
  parameters: pageState({ query: { mode: "endpoints", version: "genesis" } }),
};

export const EarlierDatabaseVersion = {
  args: {},
  parameters: pageState({ query: { mode: "database", version: "v0_4" } }),
};
