import Page from "../../../pages/auth/error.astro";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/auth/error",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {},
  parameters: pageState({ query: { reason: "unknown" } }),
};

export const MissingCode = {
  args: {},
  parameters: pageState({ query: { reason: "no_code" } }),
};

export const CodeExchangeFailed = {
  args: {},
  parameters: pageState({ query: { reason: "exchange_failed" } }),
};

export const ServerMisconfiguration = {
  args: {},
  parameters: pageState({ query: { reason: "server_misconfiguration" } }),
};
