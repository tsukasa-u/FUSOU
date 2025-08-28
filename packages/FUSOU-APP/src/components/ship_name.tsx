import { IconXMark } from "../icons/X-mark.tsx";
import { EquimentComponent } from "./equipment.tsx";

import "../css/modal.css";
import { useMstShips, useShips } from "../utility/provider.tsx";
import { createMemo, createSignal, For, Show } from "solid-js";
import IconShip from "../icons/ship.tsx";

import "./../css/table_hover.css";
import "./../css/table_active.css";
// import "./../css/modal_hover.css";
import "./../css/modal_active.css";

interface ShipNameProps {
  ship_id: number;
  compact?: boolean;
}

interface SpEffectItem {
  soukou: number;
  raisou: number;
  karyoku: number;
  kaihi: number;
}

const show_modal = (ship_id: number) => {
  const dialogElement = document.getElementById(
    "deck_ship_name_modal_" + ship_id,
  ) as HTMLDialogElement | null;
  dialogElement?.showModal();
};

export function ShipNameComponent(props: ShipNameProps) {
  const [_mst_ships] = useMstShips();
  const [_ships] = useShips();

  const speed_list = [
    "",
    "",
    "",
    "",
    "",
    "Slow",
    "",
    "",
    "",
    "",
    "Fast",
    "",
    "",
    "",
    "",
    "Fast+",
    "",
    "",
    "",
    "",
    "Fastest",
  ];
  const range_list = ["", "Short", "Medium", "Long", "Very Long"];

  const ship = createMemo(() => {
    return _ships.ships[props.ship_id];
  });

  const mst_ship = createMemo(() => {
    return _mst_ships.mst_ships[_ships.ships[props.ship_id]?.ship_id];
  });

  // const slot_item_list: Signal<SlotItem[]> = useComputed$(() => {
  //     let slot = _ships.ships[ship_id]?.slot;
  //     if (slot === undefined) return [];
  //     return slot.map((slot_id) => {
  //         return slot_items.slot_items[slot_id];
  //     });
  // });

  // const mst_slot_item_list: Signal<MstSlotitem[]> = useComputed$(() => {
  //     let slot = _ships.ships[ship_id]?.slot;
  //     if (slot === undefined) return [];
  //     return slot.map((slot_id) => {
  //         return mst_slot_items.mst_slot_items[slot_items.slot_items[slot_id]?.slotitem_id];
  //     });
  // });

  const max_eq = createMemo(() => {
    return _mst_ships.mst_ships[
      _ships.ships[props.ship_id]?.ship_id
    ]?.maxeq.reduce((a, b) => a + b, 0);
  });

  const sp_effect_item = createMemo(() => {
    const parameter_map: SpEffectItem = {
      soukou: 0,
      raisou: 0,
      karyoku: 0,
      kaihi: 0,
    };
    if (_ships.ships[props.ship_id] === undefined) return parameter_map;
    if (_ships.ships[props.ship_id].sp_effect_items === undefined)
      return parameter_map;
    if (_ships.ships[props.ship_id].sp_effect_items === null)
      return parameter_map;

    for (const i of [1, 2]) {
      const sp_effect_item = _ships.ships[props.ship_id]?.sp_effect_items!.items[i];
      if (sp_effect_item) {
        parameter_map.soukou += sp_effect_item.souk ?? 0;
        parameter_map.raisou += sp_effect_item.raig ?? 0;
        parameter_map.karyoku += sp_effect_item.houg ?? 0;
        parameter_map.kaihi += sp_effect_item.kaih ?? 0;
      }
    }

    return parameter_map;
  });

  const [show_dialog, set_show_dialog] = createSignal(false);

  return (
    <>
      <div
        class="flex flex-nowarp w-full"
        onClick={() => {
          set_show_dialog(true);
          show_modal(props.ship_id);
        }}
      >
        <div>
          <IconShip class="h-5 -mt-0.5 pr-2" ship_stype={mst_ship().stype} />
        </div>
        {(props.compact ?? false) ? (
          <></>
        ) : (
          <div class="truncate">{mst_ship()?.name ?? "Unknown"}</div>
        )}
      </div>
      <Show when={show_dialog()}>
        <dialog id={"deck_ship_name_modal_" + props.ship_id} class="modal">
          <div class="modal-box bg-base-100 modal-box-width">
            <form method="dialog">
              <button
                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
                onClick={() => {
                  const sleep = (ms: number) =>
                    new Promise((resolve) => setTimeout(resolve, ms));
                  (async () => {
                    await sleep(10);
                    set_show_dialog(false);
                  })();
                }}
              >
                <IconXMark class="h-6 w-6" />
              </button>
            </form>
            <div class="flex justify-start">
              <h3 class="font-bold text-base pl-2 truncate">
                {mst_ship()?.name ?? "Unknown"}
              </h3>
              <div class="place-self-end pb-0.5 pl-4">
                Lv. {ship()?.lv ?? ""}
              </div>
              <div class="place-self-end pb-0.5 pl-2">
                next {ship()?.exp[1] ?? ""}
              </div>
            </div>
            <div class="pt-2">
              <table class="table table-xs">
                <caption class="truncate">Equipment</caption>
                <tbody>
                  <For each={ship()?.slot} fallback={<></>}>
                    {(slot_ele, index) => {
                      return (
                        <>
                          <tr class="flex table_active table_hover rounded rounded items-center w-full">
                            <th class="flex-none w-4">S{index() + 1}</th>
                            <td class="flex-none w-12 pl-4 h-7 mt-1 w-full">
                              <Show when={slot_ele > 0}>
                                <EquimentComponent
                                  slot_id={slot_ele}
                                  ex_flag={false}
                                  name_flag={true}
                                  onslot={mst_ship().slot_num}
                                />
                              </Show>
                            </td>
                          </tr>
                        </>
                      );
                    }}
                  </For>
                  <tr class="flex table_active table_hover rounded rounded items-center">
                    <th class="flex-none w-4">SE</th>
                    <td class="flex-none w-12 pl-4 h-7 mt-1 w-full">
                      <Show when={ship()?.slot_ex > 0}>
                        <EquimentComponent
                          slot_id={ship()?.slot_ex}
                          ex_flag={true}
                          name_flag={true}
                        />
                      </Show>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="h-2" />
              <table class="table table-xs">
                <caption class="truncate">Ship Status</caption>
                <tbody>
                  <tr class="flex table_active table_hover rounded">
                    <th class="truncate flex-1 w-2">Durability</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {ship()?.maxhp ?? 0}
                    </td>
                    <th class="truncate flex-1 w-2">Firepower</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      <div class="indicator">
                        <span class="indicator-item indicator-bottom text-accent text-xs">
                          {sp_effect_item()?.karyoku > 0
                            ? "+" + sp_effect_item()?.karyoku
                            : ""}
                        </span>
                        {ship()?.karyoku[0] ?? 0}
                      </div>
                    </td>
                  </tr>
                  <tr class="flex table_active table_hover rounded">
                    <th class="truncate flex-1 w-2">Armor</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      <div class="indicator">
                        <span class="indicator-item indicator-bottom text-accent text-xs">
                          {sp_effect_item()?.soukou > 0
                            ? "+" + sp_effect_item()?.soukou
                            : ""}
                        </span>
                        {ship()?.soukou[0] ?? 0}
                      </div>
                    </td>
                    <th class="truncate flex-1 w-2">Torpedo</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      <div class="indicator">
                        <span class="indicator-item indicator-bottom text-accent text-xs">
                          {sp_effect_item()?.raisou > 0
                            ? "+" + sp_effect_item()?.raisou
                            : ""}
                        </span>
                        {ship()?.raisou[0] ?? 0}
                      </div>
                    </td>
                  </tr>
                  <tr class="flex table_active table_hover rounded">
                    <th class="truncate flex-1 w-2">Evasion</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      <div class="indicator">
                        <span class="indicator-item indicator-bottom text-accent text-xs">
                          {sp_effect_item()?.kaihi > 0
                            ? "+" + sp_effect_item()?.kaihi
                            : ""}
                        </span>
                        {ship()?.kaihi[0] ?? 0}
                      </div>
                    </td>
                    <th class="truncate flex-1 w-2">Anti-Air</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {ship()?.taiku[0] ?? 0}
                    </td>
                  </tr>
                  <tr class="flex table_active table_hover rounded">
                    <th class="truncate flex-1 w-2">Aircraft installed</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {max_eq() ?? 0 > 0}
                    </td>
                    <th class="truncate flex-1 w-2">Anti-Submarine</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {ship()?.taisen[0] ?? 0}
                    </td>
                  </tr>
                  <tr class="flex table_active table_hover rounded">
                    <th class="truncate flex-1 w-2">Speed</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {speed_list[ship()?.soku ?? 0]}
                    </td>
                    <th class="truncate flex-1 w-2">Reconnaissance</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {ship()?.sakuteki[0] ?? 0}
                    </td>
                  </tr>
                  <tr class="flex table_active table_hover rounded">
                    <th class="truncate flex-1 w-2">Range</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {range_list[ship()?.leng ?? 0]}
                    </td>
                    <th class="truncate flex-1 w-2">Luck</th>
                    <td class="flex-none w-12 flex justify-end pr-4">
                      {ship()?.lucky[0] ?? 0}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button
              onClick={() => {
                const sleep = (ms: number) =>
                  new Promise((resolve) => setTimeout(resolve, ms));
                (async () => {
                  await sleep(10);
                  set_show_dialog(false);
                })();
              }}
            >
              close
            </button>
          </form>
        </dialog>
      </Show>
    </>
  );
}
