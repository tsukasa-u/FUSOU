import type { Accessor, JSX, Setter } from "solid-js";
import { For, Match, Show, Switch } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import IconDownArrow from "../../icons/down_arrow";
import IconUpArrow from "../../icons/up_arrow";

export type RangeProps = {
  [key: string]: {
    min: number;
    max: number;
    eq: number;
    range: boolean;
    abbreviation: string;
    reset: boolean;
  };
};

export const init_range_props = (
  params: string[],
  abbreviations: string[]
): RangeProps => {
  const range_props: RangeProps = {};
  params.forEach((param, index) => {
    range_props[param] = {
      min: 0,
      max: 0,
      eq: 0,
      range: true,
      abbreviation: abbreviations[index],
      reset: true,
    };
  });
  return range_props;
};

export const set_range_window_list = (
  modal_prefix: string,
  params: string[],
  range_props: RangeProps,
  set_range_props: SetStoreFunction<RangeProps>
): { [key: string]: JSX.Element } => {
  const paramWindow: { [key: string]: JSX.Element } = {};
  params.forEach((param) => {
    paramWindow[param] = (
      <>
        <div>
          <div class="indicator">
            <Show
              when={(() => {
                let ret = false;
                if (range_props[param].reset) return false;
                if (range_props[param].range) {
                  if (
                    Number.isInteger(range_props[param].min) &&
                    range_props[param].min != 0
                  )
                    ret = true;
                  if (
                    Number.isInteger(range_props[param].max) &&
                    range_props[param].max != 0
                  )
                    ret = true;
                } else {
                  if (Number.isInteger(range_props[param].eq)) ret = true;
                }
                return ret;
              })()}
            >
              <span class="indicator-item badge badge-secondary badge-xs -mx-2">
                filtered
              </span>
            </Show>
            <div
              class="btn btn-xs btn-ghost -mx-2"
              onClick={() =>
                (
                  document.getElementById(
                    `${modal_prefix}_${param}`
                  ) as HTMLDialogElement
                ).showModal()
              }
            >
              {param}
            </div>
          </div>
        </div>
        <dialog id={`${modal_prefix}_${param}`} class="modal modal-top">
          <div class="modal-box border-1 border-base-300 text-base-content rounded-md mx-auto w-72">
            <div class="form-control">
              <label class="label cursor-pointer relative">
                <input
                  type="radio"
                  name="radio-Level"
                  class="radio radio-sm"
                  checked={
                    range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", true);
                  }}
                />
                <span class="label-text text-sm">
                  <input
                    type="text"
                    placeholder="Min"
                    class="input input-sm input-bordered w-14"
                    onInput={(e) => {
                      set_range_props(param, "min", Number(e.target.value));
                    }}
                  />{" "}
                  &#8804; {range_props[param].abbreviation} &#8804;{" "}
                  <input
                    type="text"
                    placeholder="Max"
                    class="input input-sm input-bordered w-14"
                    onInput={(e) => {
                      set_range_props(param, "max", Number(e.target.value));
                    }}
                  />
                  <Show when={!Number.isInteger(range_props[param].max)}>
                    <div class="label absolute -bottom-4 right-0">
                      <span class="label-text-alt text-error">
                        Input Number
                      </span>
                    </div>
                  </Show>
                  <Show when={!Number.isInteger(range_props[param].min)}>
                    <div class="label absolute -bottom-4 right-[116px]">
                      <span class="label-text-alt text-error">
                        Input Number
                      </span>
                    </div>
                  </Show>
                </span>
              </label>
            </div>
            <div class="divider my-0.5">OR</div>
            <div class="form-control">
              <label class="label cursor-pointer relative">
                <input
                  type="radio"
                  name="radio-Level"
                  class="radio radio-sm"
                  checked={
                    !range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", false);
                  }}
                />
                <span class="label-text text-sm">
                  {range_props[param].abbreviation} ={" "}
                  <input
                    type="text"
                    placeholder="Eq"
                    class="input input-sm input-bordered w-32"
                    onInput={(e) => {
                      set_range_props(param, "eq", Number(e.target.value));
                    }}
                  />
                  <Show when={!Number.isInteger(range_props[param].eq)}>
                    <div class="label absolute -bottom-4 right-0">
                      <span class="label-text-alt text-error">
                        Input Number
                      </span>
                    </div>
                  </Show>
                </span>
              </label>
            </div>
            <div class="flex justify-end">
              <button
                class="btn btn-ghost btn-xs -mb-4"
                onClick={() => {
                  set_range_props(param, "reset", true);
                }}
              >
                reset filter
              </button>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </>
    );
  });
  return paramWindow;
};

export const set_discrete_range_window_list = (
  modal_prefix: string,
  params: string[],
  params_option: string[][],
  params_converter: string[][],
  range_props: RangeProps,
  set_range_props: SetStoreFunction<RangeProps>
): { [key: string]: JSX.Element } => {
  const paramWindow: { [key: string]: JSX.Element } = {};
  params.forEach((param, param_index) => {
    paramWindow[param] = (
      <>
        <div>
          <div class="indicator">
            <Show
              when={(() => {
                let ret = false;
                if (range_props[param].reset) return ret;
                if (range_props[param].range) {
                  if (
                    Number.isInteger(range_props[param].min) &&
                    range_props[param].min != 0
                  )
                    ret = true;
                  if (
                    Number.isInteger(range_props[param].max) &&
                    range_props[param].max != 0
                  )
                    ret = true;
                } else {
                  if (Number.isInteger(range_props[param].eq)) ret = true;
                }
                return ret;
              })()}
            >
              <span class="indicator-item badge badge-secondary badge-xs -mx-2">
                filtered
              </span>
            </Show>
            <div
              class="btn btn-xs btn-ghost -mx-2"
              onClick={() =>
                (
                  document.getElementById(
                    `${modal_prefix}_${param}`
                  ) as HTMLDialogElement
                ).showModal()
              }
            >
              {param}
            </div>
          </div>
        </div>
        <dialog id={`${modal_prefix}_${param}`} class="modal modal-top">
          <div class="modal-box border-1 border-base-300 text-base-content rounded-md mx-auto w-92">
            <div class="form-control">
              <label class="label cursor-pointer relative">
                <input
                  type="radio"
                  name="radio-Level"
                  class="radio radio-sm"
                  checked={
                    range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", true);
                  }}
                />
                <span class="label-text text-sm">
                  <select
                    class="select select-bordered select-sm w-24 mx-2"
                    onChange={(e) => {
                      set_range_props(
                        param,
                        "min",
                        params_converter[param_index].findIndex(
                          (param_select) => param_select == e.target.value
                        )
                      );
                    }}
                  >
                    <For each={params_option[param_index]}>
                      {(param_select) => (
                        <>
                          <option>{param_select}</option>
                        </>
                      )}
                    </For>
                  </select>
                  &#8804; {range_props[param].abbreviation} &#8804;
                  <select
                    class="select select-bordered select-sm w-24 mx-2"
                    onChange={(e) => {
                      set_range_props(
                        param,
                        "max",
                        params_converter[param_index].findIndex(
                          (param_select) => param_select == e.target.value
                        )
                      );
                    }}
                  >
                    <For each={params_option[param_index]}>
                      {(param_select) => (
                        <>
                          <option>{param_select}</option>
                        </>
                      )}
                    </For>
                  </select>
                </span>
              </label>
            </div>
            <div class="divider my-0.5">OR</div>
            <div class="form-control">
              <label class="label cursor-pointer relative">
                <input
                  type="radio"
                  name="radio-Level"
                  class="radio radio-sm"
                  checked={
                    !range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", false);
                  }}
                />
                <span class="label-text text-sm">
                  {range_props[param].abbreviation} =
                  <select
                    class="select select-bordered select-sm w-58"
                    onChange={(e) =>
                      set_range_props(
                        param,
                        "eq",
                        params_converter[param_index].findIndex(
                          (param_select) => param_select == e.target.value
                        )
                      )
                    }
                  >
                    <For each={params_option[param_index]}>
                      {(param_select) => (
                        <>
                          <option>{param_select}</option>
                        </>
                      )}
                    </For>
                  </select>
                </span>
              </label>
            </div>

            <div class="flex justify-end">
              <button
                class="btn btn-ghost btn-xs -mb-4"
                onClick={() => {
                  set_range_props(param, "reset", true);
                }}
              >
                reset filter
              </button>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button>close</button>
          </form>
        </dialog>
      </>
    );
  });
  return paramWindow;
};

export const sort_window = (
  properties: string[],
  modal_prefix: string,
  set_order: Accessor<boolean>,
  set_set_order: Setter<boolean>,
  set_sort: Accessor<string>,
  set_set_sort: Setter<string>
) => {
  return (
    <>
      <div>
        <div class="indicator">
          <span class="indicator-item badge badge-secondary badge-xs -mx-2 max-w-16 truncate flex justify-start">
            <Switch fallback="">
              <Match when={set_order()}>▲</Match>
              <Match when={!set_order()}>▼</Match>
            </Switch>
            {set_sort()}
          </span>
          <div
            class="btn btn-xs btn-ghost -mx-1"
            onClick={() =>
              (
                document.getElementById(
                  `${modal_prefix}_sort`
                ) as HTMLDialogElement
              ).showModal()
            }
          >
            No
          </div>
        </div>
      </div>
      <dialog id={`${modal_prefix}_sort`} class="modal modal-top">
        <div class="modal-box border-1 border-base-300 text-base-content rounded-md mx-auto w-72">
          <table class="table table-sm ">
            <tbody>
              <tr class="flex" style={{ "border-bottom-width": "0px" }}>
                <td class="flex-1">order</td>
                <td class="flex-none h-6">
                  <label class="swap swap-rotate">
                    <input
                      type="checkbox"
                      onClick={(e) => set_set_order(e.currentTarget.checked)}
                    />
                    <div class="swap-on flex flex-nowrap items-center">
                      <IconUpArrow class="h-6 w-6" />
                      <div class="label-text text-xs">ASC</div>
                    </div>
                    <div class="swap-off flex flex-nowrap items-center">
                      <IconDownArrow class="h-6 w-6" />
                      <div class="label-text text-xs">DESC</div>
                    </div>
                  </label>
                </td>
              </tr>
              <tr
                class="flex items-center"
                style={{ "border-bottom-width": "0px" }}
              >
                <td class="flex-1">sort parameters</td>
                <td class="flex-none">
                  <select
                    class="select select-bordered select-sm w-28"
                    onChange={(e) => set_set_sort(e.target.value)}
                  >
                    <option>Default</option>
                    <For each={properties}>
                      {(property) => <option>{property}</option>}
                    </For>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
};

export type CheckName = {
  [key: number]: boolean;
};

export const search_name_window = (
  title: string,
  modal_prefix: string,
  check_name: CheckName,
  search_name: Accessor<string>,
  set_search_name: Setter<string>,
  cal_search_name: (search_name: string) => void
) => {
  return (
    <>
      <div>
        <div class="indicator">
          <Show
            when={Object.values(check_name).findIndex((value) => !value) != -1}
          >
            <span class="indicator-item badge badge-secondary badge-xs -mx-2">
              filtered
            </span>
          </Show>
          <div
            class="btn btn-xs btn-ghost -mx-2"
            onClick={() =>
              (
                document.getElementById(
                  `${modal_prefix}_search_name`
                ) as HTMLDialogElement
              ).showModal()
            }
          >
            {title}
          </div>
        </div>
      </div>
      <dialog id={`${modal_prefix}_search_name`} class="modal modal-top">
        <div class="modal-box border-1 border-base-300 text-base-content rounded-md mx-auto w-72">
          <label class="input input-sm input-bordered flex items-center gap-2">
            <input
              type="text"
              class="grow"
              placeholder="Search Name"
              onChange={(e) => {
                set_search_name(e.target.value);
                cal_search_name(e.target.value);
              }}
            />
            <div
              class="btn btn-ghost btn-sm -mr-3"
              onClick={() => {
                cal_search_name(search_name());
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                class="h-4 w-4 opacity-70"
              >
                <path
                  fill-rule="evenodd"
                  d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
          </label>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
};

export type CheckTypes = {
  [key: string]: boolean;
};

export const set_type_window = (
  title: string,
  modal_prefix: string,
  check_types: CheckTypes,
  set_check_types: SetStoreFunction<CheckTypes>,
  set_type: Accessor<string>,
  set_categorize: Accessor<boolean>
) => {
  return (
    <>
      <div>
        <div class="indicator">
          <Show
            when={Object.values(check_types).findIndex((value) => !value) != -1}
          >
            <span class="indicator-item badge badge-secondary badge-xs -mx-2">
              filtered
            </span>
          </Show>
          <div
            class="btn btn-xs btn-ghost -mx-2"
            onClick={() =>
              (
                document.getElementById(
                  `${modal_prefix}_type`
                ) as HTMLDialogElement
              ).showModal()
            }
          >
            {title}
          </div>
        </div>
      </div>
      <dialog id={`${modal_prefix}_type`} class="modal modal-top">
        <div class="absolute w-full top-2 right-4 z-[3]">
          <div class="w-72 mx-auto flex justify-end">
            <button
              class="btn btn-sm btn-outline bg-base-100"
              onClick={() => {
                const _check_types: { [key: string]: boolean } = {};
                if (
                  Object.values(check_types).findIndex((value) => value) != -1
                ) {
                  Object.keys(check_types).forEach((key) => {
                    _check_types[key] = false;
                  });
                  set_check_types(_check_types);
                } else {
                  Object.keys(check_types).forEach((key) => {
                    _check_types[key] = true;
                  });
                  set_check_types(_check_types);
                }
              }}
            >
              {Object.values(check_types).findIndex((value) => value) != -1
                ? "filter all"
                : "show all"}
            </button>
          </div>
        </div>
        <ul class="modal-box mx-auto w-72 menu menu-xs rounded-md grid overflow-y-scroll flex border-1 pt-[40px]">
          <For each={Object.keys(check_types)}>
            {(type_name) => (
              // <Show
              //   when={categorized_keys()[type_name].length != 0}
              // >
              <li
                class="flex-col w-full"
                onClick={() => {
                  const _check_types = { ...check_types };
                  _check_types[type_name] = !check_types[type_name];
                  set_check_types(_check_types);
                }}
              >
                <a>
                  <div class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={
                        (check_types[type_name] && !set_categorize()) ||
                        (set_type() == type_name && set_categorize())
                      }
                      disabled={set_categorize()}
                      class="checkbox checkbox-sm"
                    />
                    {type_name}
                  </div>
                </a>
              </li>
              // </Show>
            )}
          </For>
        </ul>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
};

export type CheckProps = {
  [key: string]: boolean;
};

export const select_properties_window = (
  modal_prefix: string,
  check_property: CheckProps,
  set_check_property: SetStoreFunction<CheckProps>
) => {
  return (
    <>
      <button
        class="btn btn-xs btn-ghost"
        onClick={() =>
          (
            document.getElementById(
              `${modal_prefix}_select_properties`
            ) as HTMLDialogElement
          ).showModal()
        }
      >
        select properties
      </button>
      <dialog id={`${modal_prefix}_select_properties`} class="modal modal-top">
        <ul class="modal-box mx-auto w-72 menu menu-xs rounded-md grid overflow-y-scroll flex border-1 pt-[40px]">
          <For each={Object.keys(check_property)}>
            {(prop) => (
              <li
                class="flex-col w-full"
                onClick={() => {
                  set_check_property(prop, !check_property[prop]);
                }}
              >
                <a>
                  <div class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={check_property[prop]}
                      class="checkbox checkbox-sm"
                    />
                    {prop}
                  </div>
                </a>
              </li>
            )}
          </For>
        </ul>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
};
