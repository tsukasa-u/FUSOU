import { Show, type JSX } from "solid-js";
import { EmptySlot } from "ui";
import { ConnectedCIMstEquip } from "../connected_components";

interface TouchPlaneProps {
  fTouchPlane?: number | null;
  eTouchPlane?: number | null;
}

/**
 * Shared friendly / enemy contact plane indicator with fixed slot dimensions.
 */
export function TouchPlaneComponent(props: TouchPlaneProps): JSX.Element {
  const fTouch = () => props.fTouchPlane ?? 0;
  const eTouch = () => props.eTouchPlane ?? 0;

  return (
    <div class="inline-flex items-center shrink-0">
      <span>touch :</span>
      <span class="w-1" />
      <div class="w-6 h-6 flex items-center justify-center shrink-0">
        <Show
          when={fTouch() > 0}
          fallback={
            <EmptySlot kind="equip" size="xs" label="No friendly touch plane" />
          }
        >
          <ConnectedCIMstEquip e_flag={false} si={fTouch()} />
        </Show>
      </div>
      <div class="w-3 text-center shrink-0">/</div>
      <div class="w-6 h-6 flex items-center justify-center shrink-0">
        <Show
          when={eTouch() > 0}
          fallback={
            <EmptySlot kind="equip" size="xs" label="No enemy touch plane" />
          }
        >
          <ConnectedCIMstEquip e_flag={true} si={eTouch()} />
        </Show>
      </div>
    </div>
  );
}
