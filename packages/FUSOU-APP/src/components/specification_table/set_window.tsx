import type { Accessor, JSX, Setter } from "solid-js";
import { For, Match, Show, Switch } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";
import IconDownArrow from "../../icons/down_arrow";
import IconUpArrow from "../../icons/up_arrow";

const FILTERED_INDICATOR_CLASS =
  "indicator-item badge badge-secondary badge-xs -mx-2 pointer-events-none [--indicator-y:-65%]";

const CloseIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="currentColor"
    class="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
  </svg>
);

const openFilterModal = (modalId: string, setSpecModal: Setter<boolean>) => {
  setSpecModal(true);
  const dialog = document.getElementById(modalId) as HTMLDialogElement | null;
  dialog?.showModal();
};

const closeFilterModal = (modalId: string, setSpecModal: Setter<boolean>) => {
  const dialog = document.getElementById(modalId) as HTMLDialogElement | null;
  dialog?.close();
  setSpecModal(false);
};

type SpecFilterModalFrameProps = {
  id: string;
  title: string;
  widthClass?: string;
  isFiltered?: boolean;
  setSpecModal: Setter<boolean>;
  footerLeft?: JSX.Element;
  children: JSX.Element;
};

const SpecFilterModalFrame = (props: SpecFilterModalFrameProps) => {
  const handleClose = () => closeFilterModal(props.id, props.setSpecModal);

  return (
    <dialog
      id={props.id}
      class="modal spec-filter-modal"
      onClose={() => props.setSpecModal(false)}
    >
      <div
        class={`modal-box border border-base-300 bg-base-100 text-base-content rounded-box p-4 mx-auto ${
          props.widthClass ?? "w-80"
        }`}
      >
        <div class="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-base-300">
          <div class="flex items-center gap-2 min-w-0">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/75 truncate">
              {props.title}
            </h3>
            <Show when={props.isFiltered}>
              <span class="badge badge-secondary badge-xs shrink-0">
                Filtered
              </span>
            </Show>
          </div>
          <button
            type="button"
            aria-label={`Close ${props.title}`}
            class="btn btn-ghost btn-xs btn-square h-6 w-6 min-h-0 shrink-0 text-base-content/60 hover:text-base-content"
            onClick={handleClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div>{props.children}</div>

        <div class="mt-3 pt-2.5 border-t border-base-300 flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            {props.footerLeft ?? <span />}
          </div>
          <button
            type="button"
            class="btn btn-primary border-primary-content btn-xs"
            onClick={handleClose}
          >
            Done
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button onClick={() => props.setSpecModal(false)}>close</button>
      </form>
    </dialog>
  );
};

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

const isRangeFilterActive = (entry: RangeProps[string]): boolean => {
  if (entry.reset) return false;
  if (entry.range) {
    return (
      (Number.isInteger(entry.min) && entry.min != 0) ||
      (Number.isInteger(entry.max) && entry.max != 0)
    );
  }
  return Number.isInteger(entry.eq);
};

export const init_range_props = (
  params: string[],
  abbreviations: string[],
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
  set_range_props: SetStoreFunction<RangeProps>,
  set_spec_modal: Setter<boolean>,
): { [key: string]: JSX.Element } => {
  const paramWindow: { [key: string]: JSX.Element } = {};
  params.forEach((param) => {
    const modalId = `${modal_prefix}_${param}`;
    let minInputRef: HTMLInputElement | undefined;
    let maxInputRef: HTMLInputElement | undefined;
    let eqInputRef: HTMLInputElement | undefined;

    const resetFilter = () => {
      set_range_props(param, "min", 0);
      set_range_props(param, "max", 0);
      set_range_props(param, "eq", 0);
      set_range_props(param, "range", true);
      set_range_props(param, "reset", true);
      if (minInputRef) minInputRef.value = "";
      if (maxInputRef) maxInputRef.value = "";
      if (eqInputRef) eqInputRef.value = "";
    };

    paramWindow[param] = (
      <>
        <div>
          <div class="indicator">
            <Show when={isRangeFilterActive(range_props[param])}>
              <span class={FILTERED_INDICATOR_CLASS}>filtered</span>
            </Show>
            <div
              class="btn btn-xs btn-ghost -mx-2"
              onClick={() => openFilterModal(modalId, set_spec_modal)}
            >
              {param}
            </div>
          </div>
        </div>
        <SpecFilterModalFrame
          id={modalId}
          title={param}
          widthClass="w-80"
          isFiltered={isRangeFilterActive(range_props[param])}
          setSpecModal={set_spec_modal}
          footerLeft={
            <button
              type="button"
              class="btn btn-outline btn-xs"
              disabled={range_props[param].reset}
              onClick={resetFilter}
            >
              Reset Filter
            </button>
          }
        >
          <div class="space-y-2">
            <div class="form-control">
              <label class="label cursor-pointer justify-start gap-2.5 px-1 py-1">
                <input
                  type="radio"
                  name={`radio-${modalId}`}
                  class="radio radio-sm shrink-0"
                  checked={
                    range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", true);
                  }}
                />
                <span class="label-text text-sm flex items-center gap-1.5 flex-wrap">
                  <input
                    ref={minInputRef}
                    type="text"
                    placeholder="Min"
                    class="input input-sm input-bordered w-16"
                    onInput={(e) => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", true);
                      set_range_props(param, "min", Number(e.target.value));
                    }}
                  />
                  <span>&#8804; {range_props[param].abbreviation} &#8804;</span>
                  <input
                    ref={maxInputRef}
                    type="text"
                    placeholder="Max"
                    class="input input-sm input-bordered w-16"
                    onInput={(e) => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", true);
                      set_range_props(param, "max", Number(e.target.value));
                    }}
                  />
                </span>
              </label>
              <Show
                when={
                  !Number.isInteger(range_props[param].min) ||
                  !Number.isInteger(range_props[param].max)
                }
              >
                <div class="text-[11px] text-error pl-7">Input Number</div>
              </Show>
            </div>

            <div class="divider my-0.5 text-[11px] text-base-content/50">
              OR
            </div>

            <div class="form-control">
              <label class="label cursor-pointer justify-start gap-2.5 px-1 py-1">
                <input
                  type="radio"
                  name={`radio-${modalId}`}
                  class="radio radio-sm shrink-0"
                  checked={
                    !range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", false);
                  }}
                />
                <span class="label-text text-sm flex items-center gap-1.5 flex-1">
                  <span>{range_props[param].abbreviation} =</span>
                  <input
                    ref={eqInputRef}
                    type="text"
                    placeholder="Eq"
                    class="input input-sm input-bordered w-32"
                    onInput={(e) => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", false);
                      set_range_props(param, "eq", Number(e.target.value));
                    }}
                  />
                </span>
              </label>
              <Show when={!Number.isInteger(range_props[param].eq)}>
                <div class="text-[11px] text-error pl-7">Input Number</div>
              </Show>
            </div>
          </div>
        </SpecFilterModalFrame>
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
  set_range_props: SetStoreFunction<RangeProps>,
  set_spec_modal: Setter<boolean>,
): { [key: string]: JSX.Element } => {
  const paramWindow: { [key: string]: JSX.Element } = {};
  params.forEach((param, param_index) => {
    const modalId = `${modal_prefix}_${param}`;
    let minSelectRef: HTMLSelectElement | undefined;
    let maxSelectRef: HTMLSelectElement | undefined;
    let eqSelectRef: HTMLSelectElement | undefined;

    const resetFilter = () => {
      set_range_props(param, "min", 0);
      set_range_props(param, "max", 0);
      set_range_props(param, "eq", 0);
      set_range_props(param, "range", true);
      set_range_props(param, "reset", true);
      if (minSelectRef) minSelectRef.selectedIndex = 0;
      if (maxSelectRef) maxSelectRef.selectedIndex = 0;
      if (eqSelectRef) eqSelectRef.selectedIndex = 0;
    };

    paramWindow[param] = (
      <>
        <div>
          <div class="indicator">
            <Show when={isRangeFilterActive(range_props[param])}>
              <span class={FILTERED_INDICATOR_CLASS}>filtered</span>
            </Show>
            <div
              class="btn btn-xs btn-ghost -mx-2"
              onClick={() => openFilterModal(modalId, set_spec_modal)}
            >
              {param}
            </div>
          </div>
        </div>
        <SpecFilterModalFrame
          id={modalId}
          title={param}
          widthClass="w-96 max-w-full"
          isFiltered={isRangeFilterActive(range_props[param])}
          setSpecModal={set_spec_modal}
          footerLeft={
            <button
              type="button"
              class="btn btn-outline btn-xs"
              disabled={range_props[param].reset}
              onClick={resetFilter}
            >
              Reset Filter
            </button>
          }
        >
          <div class="space-y-2">
            <div class="form-control">
              <label class="label cursor-pointer justify-start gap-2.5 px-1 py-1">
                <input
                  type="radio"
                  name={`radio-${modalId}`}
                  class="radio radio-sm shrink-0"
                  checked={
                    range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", true);
                  }}
                />
                <span class="label-text text-sm flex items-center gap-1.5 flex-wrap">
                  <select
                    ref={minSelectRef}
                    class="select select-bordered select-sm w-24"
                    onChange={(e) => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", true);
                      set_range_props(
                        param,
                        "min",
                        params_converter[param_index].findIndex(
                          (param_select) => param_select == e.target.value,
                        ),
                      );
                    }}
                  >
                    <For each={params_option[param_index]}>
                      {(param_select) => <option>{param_select}</option>}
                    </For>
                  </select>
                  <span>&#8804; {range_props[param].abbreviation} &#8804;</span>
                  <select
                    ref={maxSelectRef}
                    class="select select-bordered select-sm w-24"
                    onChange={(e) => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", true);
                      set_range_props(
                        param,
                        "max",
                        params_converter[param_index].findIndex(
                          (param_select) => param_select == e.target.value,
                        ),
                      );
                    }}
                  >
                    <For each={params_option[param_index]}>
                      {(param_select) => <option>{param_select}</option>}
                    </For>
                  </select>
                </span>
              </label>
            </div>

            <div class="divider my-0.5 text-[11px] text-base-content/50">
              OR
            </div>

            <div class="form-control">
              <label class="label cursor-pointer justify-start gap-2.5 px-1 py-1">
                <input
                  type="radio"
                  name={`radio-${modalId}`}
                  class="radio radio-sm shrink-0"
                  checked={
                    !range_props[param].range && !range_props[param].reset
                  }
                  onClick={() => {
                    set_range_props(param, "reset", false);
                    set_range_props(param, "range", false);
                  }}
                />
                <span class="label-text text-sm flex items-center gap-2 flex-1">
                  <span>{range_props[param].abbreviation} =</span>
                  <select
                    ref={eqSelectRef}
                    class="select select-bordered select-sm flex-1 min-w-0"
                    onChange={(e) => {
                      set_range_props(param, "reset", false);
                      set_range_props(param, "range", false);
                      set_range_props(
                        param,
                        "eq",
                        params_converter[param_index].findIndex(
                          (param_select) => param_select == e.target.value,
                        ),
                      );
                    }}
                  >
                    <For each={params_option[param_index]}>
                      {(param_select) => <option>{param_select}</option>}
                    </For>
                  </select>
                </span>
              </label>
            </div>
          </div>
        </SpecFilterModalFrame>
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
  set_set_sort: Setter<string>,
  set_spec_modal: Setter<boolean>,
) => {
  const modalId = `${modal_prefix}_sort`;
  const isDefaultSort = () => set_order() && set_sort() === "Default";

  return (
    <>
      <div>
        <div class="indicator">
          <span class="indicator-item indicator-top badge badge-secondary badge-xs max-w-16 truncate flex justify-start pointer-events-none [--indicator-s:0px] [--indicator-e:auto] [--indicator-x:0px] [--indicator-y:-65%]">
            <Switch fallback="">
              <Match when={set_order()}>▲</Match>
              <Match when={!set_order()}>▼</Match>
            </Switch>
            {set_sort()}
          </span>
          <div
            class="btn btn-xs btn-ghost px-1"
            onClick={() => openFilterModal(modalId, set_spec_modal)}
          >
            No
          </div>
        </div>
      </div>
      <SpecFilterModalFrame
        id={modalId}
        title="Sort"
        widthClass="w-80"
        isFiltered={!isDefaultSort()}
        setSpecModal={set_spec_modal}
        footerLeft={
          <button
            type="button"
            class="btn btn-outline btn-xs"
            disabled={isDefaultSort()}
            onClick={() => {
              set_set_order(true);
              set_set_sort("Default");
            }}
          >
            Reset Sort
          </button>
        }
      >
        <div class="flex flex-col gap-3 py-1">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">Order</span>
            <div class="h-6">
              <label class="swap swap-rotate">
                <input
                  type="checkbox"
                  checked={set_order()}
                  onClick={(e) => set_set_order(e.currentTarget.checked)}
                />
                <div class="swap-on flex flex-nowrap items-center gap-1">
                  <IconUpArrow class="h-5 w-5" />
                  <div class="label-text text-xs">ASC</div>
                </div>
                <div class="swap-off flex flex-nowrap items-center gap-1">
                  <IconDownArrow class="h-5 w-5" />
                  <div class="label-text text-xs">DESC</div>
                </div>
              </label>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium">Sort Parameters</span>
            <select
              class="select select-bordered select-sm w-36"
              value={set_sort()}
              onChange={(e) => set_set_sort(e.target.value)}
            >
              <option>Default</option>
              <For each={properties}>
                {(property) => <option>{property}</option>}
              </For>
            </select>
          </div>
        </div>
      </SpecFilterModalFrame>
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
  cal_search_name: (search_name: string) => void,
  set_spec_modal: Setter<boolean>,
) => {
  const modalId = `${modal_prefix}_search_name`;
  let searchInputRef: HTMLInputElement | undefined;
  const isNameFiltered = () =>
    Object.values(check_name).findIndex((value) => !value) != -1;

  const clearSearch = (focusInput: boolean) => {
    set_search_name("");
    cal_search_name("");
    if (focusInput) searchInputRef?.focus();
  };

  return (
    <>
      <div>
        <div class="indicator">
          <Show when={isNameFiltered()}>
            <span class={FILTERED_INDICATOR_CLASS}>filtered</span>
          </Show>
          <div
            class="btn btn-xs btn-ghost -mx-2"
            onClick={() => openFilterModal(modalId, set_spec_modal)}
          >
            {title}
          </div>
        </div>
      </div>
      <SpecFilterModalFrame
        id={modalId}
        title={title}
        widthClass="w-80"
        isFiltered={isNameFiltered()}
        setSpecModal={set_spec_modal}
        footerLeft={
          <button
            type="button"
            class="btn btn-outline btn-xs"
            disabled={search_name().length === 0 && !isNameFiltered()}
            onClick={() => clearSearch(false)}
          >
            Reset Filter
          </button>
        }
      >
        <div class="input input-sm input-bordered w-full flex items-center gap-1 pr-1">
          <input
            ref={searchInputRef}
            type="text"
            class="grow min-w-0"
            placeholder="Search Name"
            value={search_name()}
            onInput={(e) => {
              const next = e.currentTarget.value;
              set_search_name(next);
              cal_search_name(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                cal_search_name(search_name());
              }
            }}
          />
          <Show when={search_name().length > 0}>
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              class="btn btn-ghost btn-xs btn-square h-6 w-6 min-h-0 shrink-0 text-base-content/60 hover:text-base-content"
              onClick={() => clearSearch(true)}
            >
              <CloseIcon />
            </button>
          </Show>
          <button
            type="button"
            aria-label="Search"
            title="Search"
            class="btn btn-ghost btn-xs btn-square h-6 w-6 min-h-0 shrink-0 text-base-content/70 hover:text-base-content"
            onClick={() => {
              cal_search_name(search_name());
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>
      </SpecFilterModalFrame>
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
  set_categorize: Accessor<boolean>,
  set_spec_modal: Setter<boolean>,
) => {
  const modalId = `${modal_prefix}_type`;
  const hasUncheckedTypes = () =>
    Object.values(check_types).some((value) => !value);
  const hasCheckedTypes = () =>
    Object.values(check_types).some((value) => value);

  const setAllTypes = (checked: boolean) => {
    const nextTypes: { [key: string]: boolean } = {};
    Object.keys(check_types).forEach((key) => {
      nextTypes[key] = checked;
    });
    set_check_types(nextTypes);
  };

  return (
    <>
      <div>
        <div class="indicator">
          <Show when={hasUncheckedTypes()}>
            <span class={FILTERED_INDICATOR_CLASS}>filtered</span>
          </Show>
          <div
            class="btn btn-xs btn-ghost -mx-2"
            onClick={() => openFilterModal(modalId, set_spec_modal)}
          >
            {title}
          </div>
        </div>
      </div>
      <SpecFilterModalFrame
        id={modalId}
        title={title}
        widthClass="w-80"
        isFiltered={!set_categorize() && hasUncheckedTypes()}
        setSpecModal={set_spec_modal}
        footerLeft={
          <>
            <button
              type="button"
              class="btn btn-outline btn-xs"
              disabled={set_categorize() || !hasUncheckedTypes()}
              onClick={() => setAllTypes(true)}
            >
              Reset Filter
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={set_categorize() || !hasCheckedTypes()}
              onClick={() => setAllTypes(false)}
            >
              Clear All
            </button>
          </>
        }
      >
        <ul class="menu menu-xs rounded-box flex flex-nowrap w-full max-h-64 overflow-y-auto pr-1">
          <For each={Object.keys(check_types)}>
            {(type_name) => (
              <li
                class="flex-col w-full"
                onClick={() => {
                  if (set_categorize()) return;
                  const nextTypes = { ...check_types };
                  nextTypes[type_name] = !check_types[type_name];
                  set_check_types(nextTypes);
                }}
              >
                <a>
                  <div class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      checked={
                        (check_types[type_name] && !set_categorize()) ||
                        (set_type() == type_name && set_categorize())
                      }
                      disabled={set_categorize()}
                      class="checkbox checkbox-sm pointer-events-none"
                    />
                    {type_name}
                  </div>
                </a>
              </li>
            )}
          </For>
        </ul>
      </SpecFilterModalFrame>
    </>
  );
};

export type CheckProps = {
  [key: string]: boolean;
};

export const select_properties_window = (
  modal_prefix: string,
  check_property: CheckProps,
  set_check_property: SetStoreFunction<CheckProps>,
  set_spec_modal: Setter<boolean>,
) => {
  const modalId = `${modal_prefix}_select_properties`;
  const hasUncheckedProps = () =>
    Object.values(check_property).some((value) => !value);
  const hasCheckedProps = () =>
    Object.values(check_property).some((value) => value);

  const setAllProperties = (checked: boolean) => {
    const nextProps: { [key: string]: boolean } = {};
    Object.keys(check_property).forEach((key) => {
      nextProps[key] = checked;
    });
    set_check_property(nextProps);
  };

  return (
    <>
      <button
        type="button"
        class="btn btn-xs btn-ghost"
        onClick={() => openFilterModal(modalId, set_spec_modal)}
      >
        select properties
      </button>
      <SpecFilterModalFrame
        id={modalId}
        title="Visible Columns"
        widthClass="w-80"
        isFiltered={hasUncheckedProps()}
        setSpecModal={set_spec_modal}
        footerLeft={
          <>
            <button
              type="button"
              class="btn btn-outline btn-xs"
              disabled={!hasUncheckedProps()}
              onClick={() => setAllProperties(true)}
            >
              Show All
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={!hasCheckedProps()}
              onClick={() => setAllProperties(false)}
            >
              Hide All
            </button>
          </>
        }
      >
        <ul class="menu menu-xs rounded-box flex flex-nowrap w-full max-h-64 overflow-y-auto pr-1">
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
                      tabIndex={-1}
                      checked={check_property[prop]}
                      class="checkbox checkbox-sm pointer-events-none"
                    />
                    {prop}
                  </div>
                </a>
              </li>
            )}
          </For>
        </ul>
      </SpecFilterModalFrame>
    </>
  );
};
