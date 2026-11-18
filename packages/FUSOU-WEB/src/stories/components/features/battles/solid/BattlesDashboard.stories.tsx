import { createStorybookBattleRepository } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import BattlesDashboard from "../../../../../components/features/battles/solid/BattlesDashboard";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battles/solid/BattlesDashboard",
  component: BattlesDashboard,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "source": "r2",
    "localStatus": "idle",
    "localDirectoryName": () => (null),
    "permission": () => ("granted"),
    "scanResult": () => (null),
    "scanProgress": () => (null),
    "localError": () => (null),
    "hasStoredHandle": () => (false),
    "rememberSource": false,
    "onSourceChange": fn(),
    "onPickLocalDirectory": fn(),
    "onRequestLocalPermission": fn(),
    "onRescanLocalDirectory": fn(),
    "onReleaseLocalAccess": fn(),
    "onRefreshDataSource": fn(),
    "onRememberSourceChange": fn(),
    "onLocalLimitsChange": fn(),
    "repository": createStorybookBattleRepository(),
    "onOpenLocalDirectorySettings": fn(),
    "localLimits": {
      "maxManifestBytes": 2147483648,
      "maxQueryRecords": 20000
    }
  },
};
