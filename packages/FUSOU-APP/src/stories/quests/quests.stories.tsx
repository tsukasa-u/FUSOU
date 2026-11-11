import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { QuestsComponent } from "../../components/quests/quests";
import { QuestsContext } from "../../utility/provider";
import type { QuestCacheState } from "../../utility/quest_cache";

const mockQuestsData: QuestCacheState = {
  timestamp: Date.now(),
  page_no: 0,
  count: 5,
  completed_kind: 0,
  exec_count: 2,
  exec_type: 0,
  quests: {
    201: {
      no: 201,
      category: 2,
      quest_type: 1,
      label_type: 2,
      state: 2, // Accepted
      title: "敵艦隊を撃破せよ！",
      detail: "艦隊を出撃させ、敵艦隊を捕捉、これを撃破せよ！",
      voice_id: 0,
      get_material: [],
      progress_flag: 1, // 50%
      invalid_flag: 0,
      bonus_flag: 0,
      lost_badges: null,
    },
    216: {
      no: 216,
      category: 2,
      quest_type: 2,
      label_type: 3,
      state: 2, // Accepted
      title: "敵艦隊主力を撃滅せよ！",
      detail: "敵艦隊主力との交戦を敢行、これを撃滅せよ！",
      voice_id: 0,
      get_material: [],
      progress_flag: 2, // 80%
      invalid_flag: 0,
      bonus_flag: 0,
      lost_badges: null,
    },
    303: {
      no: 303,
      category: 3,
      quest_type: 1,
      label_type: 2,
      state: 1, // Available
      title: "「演習」で練度向上！",
      detail: "本日中に他の司令官の艦隊と3回以上「演習」を行え！",
      voice_id: 0,
      get_material: [],
      progress_flag: 0, // 0%
      invalid_flag: 0,
      bonus_flag: 0,
      lost_badges: null,
    },
    402: {
      no: 402,
      category: 4,
      quest_type: 3,
      label_type: 6,
      state: 3, // Achieved / Claimable -> Completed list
      title: "「遠征」を3回成功させよう！",
      detail: "艦隊を遠征に出航させ、本日中に遠征を3回以上成功させよ！",
      voice_id: 0,
      get_material: [],
      progress_flag: 3, // 100%
      invalid_flag: 0,
      bonus_flag: 0,
      lost_badges: null,
    },
  },
  completed: {},
  clearedQuests: {
    503: {
      completedAt: Date.now(),
      quest: {
        no: 503,
        category: 5,
        quest_type: 1,
        label_type: 2,
        state: 3,
        title: "艦隊大整備！",
        detail: "各艦隊から複数の艦を「入渠」させ、艦隊の整備を行え！",
        voice_id: 0,
        get_material: [],
        progress_flag: 3,
        invalid_flag: 0,
        bonus_flag: 0,
        lost_badges: null,
      },
    },
  },
  periodTimestamps: {},
};

const emptyQuestsData: QuestCacheState = {
  timestamp: Date.now(),
  page_no: 0,
  count: 0,
  completed_kind: 0,
  exec_count: 0,
  exec_type: 0,
  quests: {},
  completed: {},
  clearedQuests: {},
  periodTimestamps: {},
};

const meta: Meta<typeof QuestsComponent> = {
  title: "Components/Quests",
  component: QuestsComponent,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof QuestsComponent>;

export const ActiveQuests: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-xl p-3">
      <QuestsContext.Provider value={[mockQuestsData, (() => {}) as any]}>
        <QuestsComponent />
      </QuestsContext.Provider>
    </ul>
  ),
};

export const EmptyQuests: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-xl p-3">
      <QuestsContext.Provider value={[emptyQuestsData, (() => {}) as any]}>
        <QuestsComponent />
      </QuestsContext.Provider>
    </ul>
  ),
};
