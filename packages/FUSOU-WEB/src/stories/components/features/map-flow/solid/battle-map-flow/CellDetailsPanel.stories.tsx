import CellDetailsPanel from "../../../../../../components/features/map-flow/solid/battle-map-flow/CellDetailsPanel";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/map-flow/solid/battle-map-flow/CellDetailsPanel",
  component: CellDetailsPanel,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "displayedSortieRoutesCount": 1,
    "details": {
      "key": "1-1:1",
      "mapKey": "1-1",
      "label": "A",
      "cellIds": [
        1
      ],
      "passCount": 1,
      "routeCount": 1,
      "battleCount": 1,
      "topEnemyLabels": [
        [
          "駆逐イ級 / 駆逐ロ級 / 軽巡ホ級",
          1
        ]
      ],
      "resultCounts": [
        [
          "S",
          1
        ]
      ],
      "dropCounts": [
        [
          "吹雪",
          1
        ]
      ],
      "outgoingCounts": [
        [
          "A → B",
          1
        ]
      ],
      "recentBattles": [
        {
          "uuid": "storybook-battle-001",
          "timestamp": "2026-02-13 08:30 UTC",
          "enemy": "駆逐イ級 / 駆逐ロ級 / 軽巡ホ級",
          "result": {
            "win_rank": "S",
            "drop_ship_id": 9,
            "drop_ship_name": "吹雪"
          }
        }
      ]
    }
  },
};
