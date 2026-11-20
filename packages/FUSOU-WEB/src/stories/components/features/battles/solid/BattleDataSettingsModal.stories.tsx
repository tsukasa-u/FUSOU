import { previewStorybookDialogContents } from "../../../../storybook-fixtures";
import { fn } from "storybook/test";
import BattleDataSettingsModal from "../../../../../components/features/battles/solid/BattleDataSettingsModal";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battles/solid/BattleDataSettingsModal",
  component: BattleDataSettingsModal,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "ref": previewStorybookDialogContents,
    "source": "r2",
    "localStatus": "idle",
    "localDirectoryName": () => (""),
    "permission": () => ("granted"),
    "scanResult": () => (null),
    "scanProgress": () => (null),
    "localError": () => (""),
    "hasStoredHandle": () => (false),
    "rememberSource": false,
    "onSourceChange": "local-avro",
    "onPickLocalDirectory": fn(),
    "onRequestLocalPermission": fn(),
    "onRescanLocalDirectory": fn(),
    "onReleaseLocalAccess": fn(),
    "onRememberSourceChange": fn(),
    "periodLabel": "2026-02-13",
    "masterDataMeta": () => (null),
    "items": () => ([{"name":"艦娘マスターデータ","status":"success"},{"name":"装備マスターデータ","status":"pending"}]),
    "progress": () => (null),
    "loading": () => (false),
    "onLocalLimitsChange": fn(),
    "localLimits": {
      "maxManifestBytes": 2147483648,
      "maxQueryRecords": 20000
    }
  },
};
