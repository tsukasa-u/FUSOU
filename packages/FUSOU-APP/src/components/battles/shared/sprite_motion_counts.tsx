import type { JSX } from "solid-js";

export interface SpriteMotionCountsLike {
  f_sprite_fly_count?: number | null;
  e_sprite_fly_count?: number | null;
  f_sprite_crash_count?: number | null;
  e_sprite_crash_count?: number | null;
  f_sprite_damage_count?: number | null;
  e_sprite_damage_count?: number | null;
  f_sprite_non_normal_count?: number | null;
  e_sprite_non_normal_count?: number | null;
}

interface SpriteMotionCountsProps {
  counts: SpriteMotionCountsLike | null | undefined;
  class?: string;
}

export function SpriteMotionCounts(
  props: SpriteMotionCountsProps,
): JSX.Element | null {
  if (!props.counts) return null;

  const counts = props.counts;

  return (
    <span class={props.class ?? "pl-2"}>
      Sprite - Fly: {counts.f_sprite_fly_count ?? "?"}/{counts.e_sprite_fly_count ?? "?"}, Crash: {counts.f_sprite_crash_count ?? "?"}/{counts.e_sprite_crash_count ?? "?"}, Damage: {counts.f_sprite_damage_count ?? "?"}/{counts.e_sprite_damage_count ?? "?"}, Non-Normal: {counts.f_sprite_non_normal_count ?? "?"}/{counts.e_sprite_non_normal_count ?? "?"}
    </span>
  );
}