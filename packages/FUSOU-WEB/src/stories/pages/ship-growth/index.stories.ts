import Page from "../../../pages/ship-growth/index.astro";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/ship-growth",
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: {},
  parameters: pageState({
    query: { master_id: "1", period_tag: "2026-02-13", table_version: "0.7.0" },
  }),
};

export const AnotherShip = {
  args: {},
  parameters: pageState({
    query: { master_id: "2", period_tag: "2026-02-13", table_version: "0.7.0" },
  }),
};

export const Cumulative = {
  args: {},
  parameters: pageState({ query: { master_id: "1", cumulative: "1" } }),
};

export const AllPeriods = {
  args: {},
  parameters: pageState({ query: { master_id: "1", all_periods: "1" } }),
};

export const Empty = {
  args: {},
  parameters: pageState({
    query: { master_id: "1" },
    scenario: "empty",
  }),
};

export const RequestError = {
  args: {},
  parameters: pageState({
    query: { master_id: "1" },
    scenario: "error",
  }),
};
