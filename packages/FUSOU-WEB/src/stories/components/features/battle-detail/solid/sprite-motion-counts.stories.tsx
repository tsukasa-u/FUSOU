import { SpriteMotionCounts } from "../../../../../components/features/battle-detail/solid/sprite-motion-counts";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/battle-detail/solid/sprite-motion-counts",
  component: SpriteMotionCounts,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "counts": {
      "f_sprite_fly_count": 2,
      "e_sprite_fly_count": 1,
      "f_sprite_crash_count": 0,
      "e_sprite_crash_count": 1,
      "f_sprite_damage_count": 0,
      "e_sprite_damage_count": 2,
      "f_sprite_non_normal_count": 0,
      "e_sprite_non_normal_count": 0
    }
  },
};
