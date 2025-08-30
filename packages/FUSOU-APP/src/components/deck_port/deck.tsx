import { IconChevronRightS } from "../../icons/chevron_right_s.tsx";

import {
  useDeckPorts,
  useMstShips,
  useMstSlotItems,
  useShips,
  useSlotItems,
} from "../../utility/provider.tsx";
import type { JSX } from "solid-js";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import "../../css/divider.css";

import "shared-ui";
import type {
  MstShip,
  MstSlotItem,
  MstSlotItems,
} from "@ipc-bindings/get_data.ts";
import type { Ship } from "@ipc-bindings/port.ts";
import type { SlotItem, SlotItems } from "@ipc-bindings/require_info.ts";

const expandSiganMap: { [key: number]: boolean } = {};
const fleetOpenSignalMap: { [key: number]: boolean } = {
  1: true,
  2: false,
  3: false,
  4: false,
};

interface DeckPortProps {
  deck_id: number;
  fleet_name?: string;
}

export function DeckComponent(props: DeckPortProps) {
  const [mst_ships] = useMstShips();
  const [ships] = useShips();
  const [slot_items] = useSlotItems();
  const [mst_slot_items] = useMstSlotItems();
  const [deck_ports] = useDeckPorts();

  const ship_list = createMemo<Ship[]>(() => {
    const mst_ship_list: Ship[] = [];
    if (deck_ports.deck_ports[props.deck_id]) {
      if (deck_ports.deck_ports[props.deck_id]!.ship) {
        deck_ports.deck_ports[props.deck_id]!.ship!.forEach((id) => {
          const tmp = ships.ships[id];
          if (tmp) mst_ship_list.push(tmp);
        });
      }
    }
    return mst_ship_list;
  });

  const mst_ship_list = createMemo<MstShip[]>(() => {
    const mst_ship_list: MstShip[] = [];
    ship_list().forEach((ship) => {
      if (ship.ship_id) {
        const tmp = mst_ships.mst_ships[ship.ship_id];
        if (tmp) mst_ship_list.push(tmp);
      }
    });
    return mst_ship_list;
  });

  const slot_items_list = createMemo<SlotItems[]>(() => {
    const slot_items_list = ship_list().map((ship) => {
      const slot_item_dict: { [key: number]: SlotItem } = {};
      if (ship.slot) {
        ship.slot.forEach((id) => {
          const tmp = slot_items.slot_items[id];
          if (tmp) slot_item_dict[id] = tmp;
        });
      }
      if (ship.slot_ex) {
        const tmp = slot_items.slot_items[ship.slot_ex];
        if (tmp) slot_item_dict[ship.slot_ex] = tmp;
      }
      return {
        slot_items: slot_item_dict,
      } as SlotItems;
    });
    return slot_items_list;
  });

  const mst_slot_itmes_list = createMemo<MstSlotItems[]>(() => {
    const mst_slot_itmes_list = slot_items_list().map((items) => {
      const mst_slot_item_dict: { [key: number]: MstSlotItem } = {};
      Object.values(items.slot_items).forEach((item) => {
        if (item) {
          const tmp = mst_slot_items.mst_slot_items[item.slotitem_id];
          if (tmp) mst_slot_item_dict[item.slotitem_id] = tmp;
        }
      });
      return {
        mst_slot_items: mst_slot_item_dict,
      } as MstSlotItems;
    });
    return mst_slot_itmes_list;
  });

  const cond_state = createMemo<JSX.Element[]>(() => {
    const set_cond_state = (cond: number): JSX.Element => {
      let cond_state: JSX.Element = <></>;
      if (cond >= 71)
        cond_state = (
          <div class="size-4">
            <icon-kira size="full" kira_type={3} />
          </div>
        );
      else if (cond >= 58)
        cond_state = (
          <div class="size-4">
            <icon-kira size="full" kira_type={2} />
          </div>
        );
      else if (cond >= 50)
        // cond_state = <IconKira1 class="h-4 w-4 fill-yellow-500 stroke-2" />;
        cond_state = (
          <div class="size-4">
            <icon-kira size="full" kira_type={1} />
          </div>
        );
      else if (cond == 49) cond_state = <></>;
      else if (cond >= 40)
        cond_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"low"} />
          </div>
        );
      else if (cond >= 30)
        cond_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"low"} />
          </div>
        );
      else if (cond >= 20)
        cond_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"middle"} />
          </div>
        );
      else if (cond >= 0)
        cond_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"high"} />
          </div>
        );
      return cond_state;
    };

    const states: JSX.Element[] = [];
    ship_list().forEach((ship) => {
      states.push(set_cond_state(ship.cond ?? 0));
    });
    return states;
  });

  const hp_state = createMemo<JSX.Element[]>(() => {
    const set_hp_state = (nowhp: number, maxhp: number): JSX.Element => {
      let hp_state: JSX.Element = <></>;
      if (nowhp > 0.75 * maxhp) hp_state = <></>;
      else if (nowhp > 0.5 * maxhp)
        hp_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"low"} />
          </div>
        );
      else if (nowhp > 0.25 * maxhp)
        hp_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"middle"} />
          </div>
        );
      else if (nowhp > 0)
        hp_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"high"} />
          </div>
        );
      return hp_state;
    };

    const states: JSX.Element[] = [];
    ship_list().forEach((ship) => {
      states.push(set_hp_state(ship.nowhp ?? 0, ship.maxhp ?? 0));
    });

    return states;
  });

  const fuel_bullet_state = createMemo<JSX.Element[]>(() => {
    const set_fuel_bullet_state = (
      nowfuel: number,
      maxfuel: number,
      nowbullet: number,
      maxbullet: number
    ): JSX.Element => {
      let fuel_bullet_state: JSX.Element = <></>;
      if (nowfuel == maxfuel && nowbullet == maxbullet)
        fuel_bullet_state = <></>;
      else if (9 * nowfuel >= 7 * maxfuel && 9 * nowbullet >= 7 * maxbullet)
        fuel_bullet_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"low"} />
          </div>
        );
      else if (9 * nowfuel >= 3 * maxfuel && 9 * nowbullet >= 3 * maxbullet)
        fuel_bullet_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"middle"} />
          </div>
        );
      else if (nowfuel >= 0 && nowbullet >= 0)
        fuel_bullet_state = (
          <div class="size-4">
            <icon-caution-fill size="full" level={"high"} />
          </div>
        );
      return fuel_bullet_state;
    };

    const states: JSX.Element[] = [];
    ship_list().forEach((ship) => {
      const mst_ship = mst_ship_list().find(
        (mst_ship) => mst_ship.id == ship.ship_id
      );
      if (mst_ship) {
        states.push(
          set_fuel_bullet_state(
            ship.bull ?? 0,
            mst_ship.bull_max ?? 0,
            ship.fuel ?? 0,
            mst_ship.fuel_max ?? 0
          )
        );
      }
    });

    return states;
  });

  const [expandSignal, setMoreSignal] = createSignal<boolean>(false);

  createEffect(() => {
    setMoreSignal(expandSiganMap[props.deck_id]);

    if (expandSiganMap[props.deck_id] == undefined) {
      expandSiganMap[props.deck_id] = false;
    }

    if (fleetOpenSignalMap[props.deck_id] == undefined) {
      fleetOpenSignalMap[props.deck_id] = false;
    }
  });

  const get_deck_name = () => {
    const tmp = deck_ports.deck_ports[props.deck_id];
    return tmp ? tmp.name : "";
  };

  const get_deck_ship = () => {
    const tmp = deck_ports.deck_ports[props.deck_id];
    return tmp ? (tmp.ship ?? []) : [];
  };

  const get_slot_item = (
    ship_index: number,
    slot_id: number
  ): SlotItem | undefined => {
    return slot_items_list()[ship_index].slot_items[slot_id];
  };

  const get_mst_slot_item = (ship_index: number, slot_id: number) => {
    const slot_item_id = get_slot_item(ship_index, slot_id)?.slotitem_id;
    return slot_item_id
      ? mst_slot_itmes_list()[ship_index].mst_slot_items[slot_item_id]
      : undefined;
  };

  const get_onslot = (ship_index: number, slot_index: number) => {
    const tmp = ship_list()[ship_index].onslot;
    return tmp ? tmp[slot_index] : 0;
  };

  return (
    <>
      <li>
        <details open={fleetOpenSignalMap[props.deck_id]}>
          <summary
            class="flex"
            onClick={() => {
              fleetOpenSignalMap[props.deck_id] =
                !fleetOpenSignalMap[props.deck_id];
            }}
          >
            <div class="w-20 flex-none">{props.fleet_name ?? "Unknown"}</div>
            <div class="w-4 flex-none -mx-4">
              <IconChevronRightS class="h-4 w-4" />
            </div>
            <div class="pl-4">{get_deck_name()}</div>
            <span class="flex-auto" />
            <div class="form-control flex-none">
              <label class="label cursor-pointer h-4">
                <span
                  class={`label-text pr-2 h-4${expandSignal() ? " text-info" : ""}`}
                >
                  expand
                </span>
                <input
                  type="checkbox"
                  onClick={() => {
                    expandSiganMap[props.deck_id] = !expandSignal();
                    setMoreSignal(!expandSignal());
                  }}
                  class="toggle toggle-xs h-4 toggle-info rounded-sm [&::before]:rounded-xs"
                  checked={expandSignal()}
                />
              </label>
            </div>
          </summary>
          <ul class="pl-0">
            <For each={get_deck_ship()}>
              {(shipId, ship_index) => (
                <Show when={shipId > 0}>
                  <li class="h-auto">
                    <a class="justify-start gap-x-0 gap-y-1 flex flex-wrap">
                      <div class="justify-start gap-0 flex">
                        <div class="pl-2 pr-0.5 truncate flex-1 min-w-12 content-center">
                          <div class="w-[106px] h-max">
                            <component-ship-modal
                              size="xs"
                              color=""
                              name_flag={true}
                              ship={ship_list()[ship_index()]}
                              mst_ship={mst_ship_list()[ship_index()]}
                              slot_items={slot_items_list()[ship_index()]}
                              mst_slot_items={
                                mst_slot_itmes_list()[ship_index()]
                              }
                            />
                            {/* <ShipNameComponent ship_id={shipId} /> */}
                          </div>
                        </div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                        <div class=" flex-none">
                          <div class="flex justify-center w-8 indicator">
                            <div class="indicator-item indicator-top indicator-end">
                              {cond_state()[ship_index()]}
                            </div>
                            <div class="badge badge-md border-base-300 w-9">
                              {ship_list()[ship_index()].cond ?? 0}
                            </div>
                          </div>
                        </div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                        <div class="indicator">
                          <div class="indicator-item indicator-top indicator-end space-x-2">
                            {hp_state()[ship_index()]}
                          </div>
                          <div class="w-16 text-xs">
                            <component-color-bar-label
                              v_max={ship_list()[ship_index()].maxhp ?? 0}
                              v_now={ship_list()[ship_index()].nowhp ?? 0}
                              size="xs"
                            />
                          </div>
                          {/* <div class="flex-none">
                            <div class="grid h-2.5 w-12 place-content-center">
                              <div class="grid grid-flow-col auto-cols-max gap-1">
                                <div>{ships.ships[shipId]?.nowhp ?? 0}</div>
                                <div>/</div>
                                <div>{ships.ships[shipId]?.maxhp ?? 0}</div>
                              </div>
                            </div>
                            <div class="grid h-2.5 w-12 place-content-center">
                              <HpColorBarComponent
                                class="w-12 h-1"
                                v_now={() => ships.ships[shipId]?.nowhp ?? 0}
                                v_max={() => ships.ships[shipId]?.maxhp ?? 0}
                              />
                            </div>
                          </div> */}
                        </div>
                        <div class="divider divider-horizontal mr-0 ml-0 flex-none" />
                        <div class="indicator">
                          <div class="flex-none my-auto">
                            <div class="indicator-item indicator-top indicator-end space-x-2">
                              {fuel_bullet_state()[ship_index()]}
                            </div>
                            <div class="grid w-8 place-content-center space-y-1">
                              {/* <FuelBulletColorBarComponent
                                class="w-6 h-1"
                                v_now={() => ships.ships[shipId]?.fuel ?? 0}
                                v_max={() =>
                                  mst_ships.mst_ships[
                                    ships.ships[shipId]?.ship_id ?? 0
                                  ]?.fuel_max ?? 0
                                }
                              /> */}
                              {/* <FuelBulletColorBarComponent
                                class="w-6 h-1"
                                v_now={() => ships.ships[shipId]?.bull ?? 0}
                                v_max={() =>
                                  mst_ships.mst_ships[
                                    ships.ships[shipId]?.ship_id ?? 0
                                  ]?.bull_max ?? 0
                                }
                              /> */}
                              <component-color-bar
                                class="w-8"
                                v_now={ship_list()[ship_index()].fuel ?? 0}
                                v_max={
                                  mst_ship_list()[ship_index()].fuel_max ?? 0
                                }
                                size="xs"
                              />
                              <component-color-bar
                                class="w-8"
                                v_now={ship_list()[ship_index()].bull ?? 0}
                                v_max={
                                  mst_ship_list()[ship_index()].bull_max ?? 0
                                }
                                size="xs"
                              />
                            </div>
                          </div>
                        </div>
                        <div class="divider divider-horizontal mr-0 ml-0" />
                      </div>
                      <Show when={expandSignal()}>
                        <div class="flex">
                          <div class="w-[4px]" />
                          <div class="grid grid-cols-5 gap-2 content-center w-60">
                            <For each={ships.ships[shipId]?.slot}>
                              {(slotId, slotId_index) => (
                                <Show when={slotId > 0}>
                                  <div class="text-base flex justify-center">
                                    <component-equipment-modal
                                      size="xs"
                                      empty_flag={false}
                                      name_flag={false}
                                      attr:onslot={get_onslot(
                                        ship_index(),
                                        slotId_index()
                                      )}
                                      slot_item={get_slot_item(
                                        ship_index(),
                                        slotId
                                      )}
                                      mst_slot_item={get_mst_slot_item(
                                        ship_index(),
                                        slotId
                                      )}
                                    />
                                  </div>
                                </Show>
                              )}
                            </For>
                          </div>
                          <div class="divider divider-horizontal mr-0 ml-0" />
                          <div class="content-center">
                            <div class="text-base flex justify-center w-8">
                              <Show
                                when={
                                  (ship_list()[ship_index()].slot_ex ?? 0) > 0
                                }
                              >
                                <component-equipment-modal
                                  size="xs"
                                  empty_flag={false}
                                  name_flag={false}
                                  attr:onslot={undefined}
                                  slot_item={get_slot_item(
                                    ship_index(),
                                    ship_list()[ship_index()].slot_ex ?? 0
                                  )}
                                  mst_slot_item={get_mst_slot_item(
                                    ship_index(),
                                    ship_list()[ship_index()].slot_ex ?? 0
                                  )}
                                  ex_flag={true}
                                />
                              </Show>
                            </div>
                          </div>
                          {/* <span class="w-px" /> */}
                          <div class="divider divider-horizontal mr-0 ml-0 h-auto" />
                        </div>
                      </Show>
                    </a>
                  </li>
                </Show>
              )}
            </For>
          </ul>
        </details>
      </li>
    </>
  );
}
