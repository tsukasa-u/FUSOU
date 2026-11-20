import Page from "../../../pages/simulator/fleets.astro";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/simulator/fleets",
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
  parameters: pageState(),
};

export const Empty = {
  args: {
    storybook: true,
  },
  parameters: pageState({ scenario: "empty" }),
};

export const RequestError = {
  args: {
    storybook: true,
  },
  parameters: pageState({ scenario: "error" }),
};
