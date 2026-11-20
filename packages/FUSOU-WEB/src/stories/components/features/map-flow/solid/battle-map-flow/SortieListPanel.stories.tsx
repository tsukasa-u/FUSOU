import { fn } from "storybook/test";
import SortieListPanel from "../../../../../../components/features/map-flow/solid/battle-map-flow/SortieListPanel";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/map-flow/solid/battle-map-flow/SortieListPanel",
  component: SortieListPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "routes": [],
    "selectedCellFilter": () => (null),
    "onSelectById": fn(),
    "isRouteListTruncated": () => (false),
    "filteredRouteCount": () => (0),
    "cellLabel": fn()
  },
};
