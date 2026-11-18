import { createStorybookResolvedRouteOverlay } from "../../../../../storybook-fixtures";
import { fn } from "storybook/test";
import MapSvgCanvas from "../../../../../../components/features/map-flow/solid/battle-map-flow/MapSvgCanvas";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/map-flow/solid/battle-map-flow/MapSvgCanvas",
  component: MapSvgCanvas,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "selectedCellFilter": () => (null),
    "toggleCellFilter": fn(),
    "overlay": createStorybookResolvedRouteOverlay(),
    "theme": () => ("light")
  },
};

export const BranchToC = {
  args: {
    "selectedCellFilter": () => (null),
    "toggleCellFilter": fn(),
    "overlay": createStorybookResolvedRouteOverlay(3),
    "theme": () => ("light")
  },
};
