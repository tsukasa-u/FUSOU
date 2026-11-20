import { MasterDataLoadStatusAlert } from "../../../../components/common/solid/MasterDataLoadStatusAlert";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/MasterDataLoadStatusAlert",
  component: MasterDataLoadStatusAlert,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "items": [
      {
        "name": "艦娘",
        "status": "success",
        "detail": "19件"
      },
      {
        "name": "装備",
        "status": "success",
        "detail": "12件"
      }
    ],
    "value": 1,
    "max": 1,
    "title": "マスターデータ読込状況",
    "subtitle": "Storybook fixture",
    "progress": {
      "value": 2,
      "max": 2,
      "label": "2 / 2"
    },
    "alwaysShow": true
  },
};
