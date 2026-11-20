import { createMemo, For, Show } from "solid-js";
import {
  useMstShips,
  useMstSlotItems,
  useNDocks,
  useShips,
  useSlotItems,
} from "../../utility/provider.tsx";
import {
  resolveTimerStatus,
  useSharedNow,
  useTimerDisplayMode,
} from "../../utility/timer.ts";
import {
  ComponentColorBarLabel,
  ComponentShipModal,
  ComponentTimer,
  EmptySlot,
  EmptyValue,
} from "ui";
import "../../css/divider.css";
import type { MstSlotItem, MstSlotItems } from "@ipc-bindings/get_data.ts";
import type { NDock, Ship } from "@ipc-bindings/port.ts";
import type { SlotItem, SlotItems } from "@ipc-bindings/require_info.ts";

export interface NDocksComponentProps {
  /** Optional fixed current timestamp (ms) for deterministic Storybook/Catalog views. */
  nowMs?: number;
}

export function NDocksComponent(props: NDocksComponentProps = {}) {
  const [ndocks] = useNDocks();
  const [ships] = useShips();
  const [mstShips] = useMstShips();
  const [slotItems] = useSlotItems();
  const [mstSlotItems] = useMstSlotItems();
  const sharedNow = useSharedNow();
  const [displayMode, toggleDisplayMode] = useTimerDisplayMode();

  const currentNowMs = () => props.nowMs ?? sharedNow();

  const isDockActive = (dock: NDock): boolean =>
    dock.state === 1 || (dock.state !== -1 && dock.ship_id > 0);

  const isDockLocked = (dock: NDock): boolean => dock.state === -1;

  const activeRepairCount = createMemo(
    () => ndocks.n_docks.filter((dock) => isDockActive(dock)).length,
  );

  const unlockedDockCount = createMemo(
    () => ndocks.n_docks.filter((dock) => !isDockLocked(dock)).length,
  );

  const getShipSlotItems = (ship: Ship | undefined): SlotItems => {
    const dict: Record<number, SlotItem> = {};
    if (ship?.slot) {
      ship.slot.forEach((id) => {
        const item = slotItems.slot_items[id];
        if (item) dict[id] = item;
      });
    }
    if (ship?.slot_ex) {
      const item = slotItems.slot_items[ship.slot_ex];
      if (item) dict[ship.slot_ex] = item;
    }
    return { slot_items: dict };
  };

  const getShipMstSlotItems = (items: SlotItems): MstSlotItems => {
    const dict: Record<number, MstSlotItem> = {};
    Object.values(items.slot_items).forEach((item) => {
      if (item) {
        const mst = mstSlotItems.mst_slot_items[item.slotitem_id];
        if (mst) dict[item.slotitem_id] = mst;
      }
    });
    return { mst_slot_items: dict };
  };

  return (
    <li>
      <details open>
        <summary class="flex items-center">
          <span>Repair Docks</span>
          <Show when={ndocks.n_docks.length > 0}>
            <span class="badge badge-xs border-base-300 tabular-nums ml-1.5">
              {activeRepairCount()} / {unlockedDockCount()}
            </span>
          </Show>
          <span class="flex-auto" />
        </summary>
        <ul class="pl-0">
          <For
            each={ndocks.n_docks}
            fallback={
              <li class="text-xs py-2">Loading Repair Dock Data ...</li>
            }
          >
            {(dock, index) => {
              const dockNumber = () => (dock.id > 0 ? dock.id : index() + 1);
              const active = () => isDockActive(dock);
              const locked = () => isDockLocked(dock);
              const ship = () =>
                active() ? ships.ships[dock.ship_id] : undefined;
              const mstShip = () => {
                const s = ship();
                return s?.ship_id ? mstShips.mst_ships[s.ship_id] : undefined;
              };
              const shipSlotItems = createMemo(() => getShipSlotItems(ship()));
              const shipMstSlotItems = createMemo(() =>
                getShipMstSlotItems(shipSlotItems()),
              );

              const timerStatus = createMemo(() =>
                resolveTimerStatus(
                  active() ? dock.complete_time : null,
                  currentNowMs(),
                  {
                    forcedStatus: locked()
                      ? "locked"
                      : active()
                        ? undefined
                        : "idle",
                  },
                ),
              );

              const statusLabel = createMemo(() => {
                switch (timerStatus()) {
                  case "locked":
                    return "Locked";
                  case "idle":
                    return "Empty";
                  case "complete":
                    return "Complete";
                  case "soon":
                  case "running":
                  case "recalled":
                    return "Repairing";
                }
              });

              const statusTextClass = createMemo(() => {
                switch (timerStatus()) {
                  case "complete":
                    return "text-green-500 font-medium";
                  case "soon":
                    return "text-yellow-500 font-medium";
                  case "running":
                    return "text-base-content/80";
                  case "idle":
                  case "locked":
                  default:
                    return "text-base-content/40";
                }
              });

              return (
                <li class="h-auto">
                  <div class="justify-start gap-0 flex items-center py-1 px-2 cursor-default">
                    <div class="w-14 flex-none text-xs font-medium text-base-content/70 tabular-nums">
                      Dock {dockNumber()}
                    </div>
                    <div class="divider divider-horizontal mr-0 ml-0 flex-none self-stretch" />
                    <div class="pl-2 pr-0.5 truncate flex-none w-[124px] content-center">
                      <Show
                        when={active() && ship() && mstShip()}
                        fallback={
                          <EmptySlot
                            kind="ship"
                            size="xs"
                            showLabel={true}
                            labelWidthClass="flex-1"
                            widthClass="w-full"
                            label={locked() ? "Locked dock" : "Empty dock"}
                          />
                        }
                      >
                        <ComponentShipModal
                          size="xs"
                          color=""
                          name_flag={true}
                          ship={ship()}
                          mst_ship={mstShip()}
                          slot_items={shipSlotItems()}
                          mst_slot_items={shipMstSlotItems()}
                        />
                      </Show>
                    </div>
                    <div class="divider divider-horizontal mr-0 ml-0 flex-none self-stretch" />
                    <div class="w-16 flex-none text-xs flex items-center justify-center">
                      <Show
                        when={active() && ship()}
                        fallback={<EmptyValue size="xs" widthClass="w-full" />}
                      >
                        <ComponentColorBarLabel
                          v_max={ship()?.maxhp ?? 0}
                          v_now={ship()?.nowhp ?? 0}
                          size="xs"
                        />
                      </Show>
                    </div>
                    <div class="divider divider-horizontal mr-0 ml-0 flex-none self-stretch" />
                    <div class="px-2 flex-none" data-testid="ndock-timer-cell">
                      <ComponentTimer
                        completeTimeMs={active() ? dock.complete_time : null}
                        status={
                          locked() ? "locked" : active() ? undefined : "idle"
                        }
                        displayMode={displayMode()}
                        onToggleDisplayMode={toggleDisplayMode}
                        nowMs={props.nowMs}
                        size="xs"
                      />
                    </div>
                    <div class="divider divider-horizontal mr-0 ml-0 flex-none self-stretch" />
                    <div
                      class={`pl-2 text-xs flex-none w-16 truncate ${statusTextClass()}`}
                      data-testid="ndock-status-cell"
                    >
                      {statusLabel()}
                    </div>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </details>
    </li>
  );
}
