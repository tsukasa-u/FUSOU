import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { QuestsComponent } from "../../components/quests/quests";
import { QuestsContext } from "../../utility/provider";

const mockQuestsData = {
  timestamp: Date.now(),
  page_no: 1,
  count: 4,
  completed_kind: 0,
  exec_count: 2,
  exec_type: 0,
  quests: {
    "1": {
      no: 201,
      category: 2,
      type: 1,
      state: 2, // Accepted
      title: "敵艦隊を撃破せよ！",
      detail: "艦隊を出撃させ、敵艦隊を捕捉、これを撃破せよ！",
      progress_flag: 1, // 50%
      invalid_flag: 0,
      select_rewards: null,
      bonus_flag: 0,
    },
    "2": {
      no: 216,
      category: 2,
      type: 2,
      state: 2, // Accepted
      title: "敵艦隊主力を撃滅せよ！",
      detail: "敵艦隊主力との交戦を敢行、これを撃滅せよ！",
      progress_flag: 2, // 80%
      invalid_flag: 0,
      select_rewards: null,
      bonus_flag: 0,
    },
    "3": {
      no: 303,
      category: 3,
      type: 1,
      state: 1, // Available
      title: "「演習」で練度向上！",
      detail: "本日中に他の司令官の艦隊と3回以上「演習」を行え！",
      progress_flag: 0, // 0%
      invalid_flag: 0,
      select_rewards: null,
      bonus_flag: 0,
    },
    "4": {
      no: 402,
      category: 4,
      type: 3,
      state: 1, // Available
      title: "「遠征」を3回成功させよう！",
      detail: "艦隊を遠征に出航させ、本日中に遠征を3回以上成功させよ！",
      progress_flag: 3, // 100%
      invalid_flag: 0,
      select_rewards: null,
      bonus_flag: 0,
    },
  },
  completed: {},
};

const emptyQuestsData = {
  timestamp: Date.now(),
  page_no: 1,
  count: 0,
  completed_kind: 0,
  exec_count: 0,
  exec_type: 0,
  quests: {},
  completed: {},
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
      <QuestsContext.Provider value={[mockQuestsData as any, () => {}]}>
        <QuestsComponent />
      </QuestsContext.Provider>
    </ul>
  ),
};

export const EmptyQuests: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-xl p-3">
      <QuestsContext.Provider value={[emptyQuestsData as any, () => {}]}>
        <QuestsComponent />
      </QuestsContext.Provider>
    </ul>
  ),
};
