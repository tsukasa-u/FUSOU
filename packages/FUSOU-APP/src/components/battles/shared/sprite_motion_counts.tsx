import { Show, type JSX } from "solid-js";

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
): JSX.Element {
  return (
    <Show when={props.counts}>
      <span class={props.class ?? "pl-2"}>
        Sprite - Fly: {props.counts?.f_sprite_fly_count ?? "?"}/
        {props.counts?.e_sprite_fly_count ?? "?"}, Crash: {props.counts?.f_sprite_crash_count ?? "?"}/
        {props.counts?.e_sprite_crash_count ?? "?"}, Damage: {props.counts?.f_sprite_damage_count ?? "?"}/
        {props.counts?.e_sprite_damage_count ?? "?"}, Non-Normal: {props.counts?.f_sprite_non_normal_count ?? "?"}/
        {props.counts?.e_sprite_non_normal_count ?? "?"}
      </span>
    </Show>
  );
}