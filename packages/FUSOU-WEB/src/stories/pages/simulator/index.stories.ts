import Page from "../../../pages/simulator/index.astro";
import { pageState } from "../../storybook-page-state";

export default {
  title: "Pages/simulator",
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
  parameters: pageState({
    query: { tab: "fleet" },
    simulatorPayload: "fleet",
  }),
};

export const Workspace = {
  args: {
    storybook: true,
  },
  parameters: pageState({
    query: { tab: "workspace" },
    viewerWorkspace: "sample",
  }),
};

export const ShipCatalog = {
  args: {
    storybook: true,
  },
  parameters: pageState({
    query: { tab: "ship" },
    simulatorPayload: "fleet",
  }),
};

export const EquipmentCatalog = {
  args: {
    storybook: true,
  },
  parameters: pageState({
    query: { tab: "equip" },
    simulatorPayload: "fleet",
  }),
};

export const SharedFleetLink = {
  args: {
    storybook: true,
  },
  parameters: pageState({
    query: { fleet: "storybook-sample-fleet" },
  }),
};

export const EmptyFleet = {
  args: {
    storybook: true,
  },
  parameters: pageState({
    query: { tab: "fleet" },
    scenario: "empty",
  }),
};

export const LegacyShipDetailsRoute = {
  args: {
    storybook: true,
  },
  parameters: {
    ...pageState({
      query: { tab: "ship" },
      simulatorPayload: "fleet",
    }),
    docs: {
      description: {
        story: "The legacy /simulator/details route resolves to the ship catalog state.",
      },
    },
  },
};
