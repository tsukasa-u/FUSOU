import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type {
  AppConfigsResponse,
  ConfigValuesMap,
} from "../components/settings/config_schema";
import { isTauri } from "./tauri";

export const UI_CONFIG_STORAGE_KEY = "fusou-app-ui-config";

export interface UiConfigState {
  tabs: {
    show_fleet: boolean;
    show_ship: boolean;
    show_equip: boolean;
    show_item: boolean;
    show_quest: boolean;
    show_uploads: boolean;
    show_logs: boolean;
    show_policy: boolean;
  };
  fleet_tab: {
    show_materials: boolean;
    open_materials: boolean;
    show_fleets: boolean;
    open_fleets: boolean;
    show_repair_docks: boolean;
    open_repair_docks: boolean;
    show_air_bases: boolean;
    open_air_bases: boolean;
    open_air_base_squadrons: boolean;
    show_battles: boolean;
    open_battles: boolean;
  };
  fleets: {
    show_condition_value: boolean;
    show_fleet_1: boolean;
    open_fleet_1: boolean;
    show_fleet_2: boolean;
    open_fleet_2: boolean;
    show_fleet_3: boolean;
    open_fleet_3: boolean;
    show_fleet_4: boolean;
    open_fleet_4: boolean;
  };
  items: {
    show_items: boolean;
    open_items: boolean;
    show_normal: boolean;
    open_normal: boolean;
    show_special: boolean;
    open_special: boolean;
    show_purchased: boolean;
    open_purchased: boolean;
    show_furniture: boolean;
    open_furniture: boolean;
  };
  quests: {
    show_quests: boolean;
    open_quests: boolean;
    show_accepted: boolean;
    open_accepted: boolean;
    show_available: boolean;
    open_available: boolean;
    show_completed: boolean;
    open_completed: boolean;
  };
}

export function createDefaultUiConfig(): UiConfigState {
  return {
    tabs: {
      show_fleet: true,
      show_ship: true,
      show_equip: true,
      show_item: true,
      show_quest: true,
      show_uploads: true,
      show_logs: true,
      show_policy: true,
    },
    fleet_tab: {
      show_materials: true,
      open_materials: true,
      show_fleets: true,
      open_fleets: true,
      show_repair_docks: true,
      open_repair_docks: true,
      show_air_bases: true,
      open_air_bases: false,
      open_air_base_squadrons: false,
      show_battles: true,
      open_battles: true,
    },
    fleets: {
      show_condition_value: true,
      show_fleet_1: true,
      open_fleet_1: true,
      show_fleet_2: true,
      open_fleet_2: false,
      show_fleet_3: true,
      open_fleet_3: false,
      show_fleet_4: true,
      open_fleet_4: false,
    },
    items: {
      show_items: true,
      open_items: true,
      show_normal: true,
      open_normal: true,
      show_special: true,
      open_special: true,
      show_purchased: true,
      open_purchased: true,
      show_furniture: true,
      open_furniture: true,
    },
    quests: {
      show_quests: true,
      open_quests: true,
      show_accepted: true,
      open_accepted: true,
      show_available: true,
      open_available: true,
      show_completed: true,
      open_completed: true,
    },
  };
}

const boolFromMap = (
  values: ConfigValuesMap,
  key: string,
  fallback: boolean,
): boolean => {
  const value = values[key];
  return typeof value === "boolean" ? value : fallback;
};

export function parseUiConfigValues(
  values: ConfigValuesMap,
  base: UiConfigState = createDefaultUiConfig(),
): UiConfigState {
  return {
    tabs: {
      show_fleet: boolFromMap(
        values,
        "app.ui.tabs.show_fleet",
        base.tabs.show_fleet,
      ),
      show_ship: boolFromMap(
        values,
        "app.ui.tabs.show_ship",
        base.tabs.show_ship,
      ),
      show_equip: boolFromMap(
        values,
        "app.ui.tabs.show_equip",
        base.tabs.show_equip,
      ),
      show_item: boolFromMap(
        values,
        "app.ui.tabs.show_item",
        base.tabs.show_item,
      ),
      show_quest: boolFromMap(
        values,
        "app.ui.tabs.show_quest",
        base.tabs.show_quest,
      ),
      show_uploads: boolFromMap(
        values,
        "app.ui.tabs.show_uploads",
        base.tabs.show_uploads,
      ),
      show_logs: boolFromMap(
        values,
        "app.ui.tabs.show_logs",
        base.tabs.show_logs,
      ),
      show_policy: boolFromMap(
        values,
        "app.ui.tabs.show_policy",
        base.tabs.show_policy,
      ),
    },
    fleet_tab: {
      show_materials: boolFromMap(
        values,
        "app.ui.fleet_tab.show_materials",
        base.fleet_tab.show_materials,
      ),
      open_materials: boolFromMap(
        values,
        "app.ui.fleet_tab.open_materials",
        base.fleet_tab.open_materials,
      ),
      show_fleets: boolFromMap(
        values,
        "app.ui.fleet_tab.show_fleets",
        base.fleet_tab.show_fleets,
      ),
      open_fleets: boolFromMap(
        values,
        "app.ui.fleet_tab.open_fleets",
        base.fleet_tab.open_fleets,
      ),
      show_repair_docks: boolFromMap(
        values,
        "app.ui.fleet_tab.show_repair_docks",
        base.fleet_tab.show_repair_docks,
      ),
      open_repair_docks: boolFromMap(
        values,
        "app.ui.fleet_tab.open_repair_docks",
        base.fleet_tab.open_repair_docks,
      ),
      show_air_bases: boolFromMap(
        values,
        "app.ui.fleet_tab.show_air_bases",
        base.fleet_tab.show_air_bases,
      ),
      open_air_bases: boolFromMap(
        values,
        "app.ui.fleet_tab.open_air_bases",
        base.fleet_tab.open_air_bases,
      ),
      open_air_base_squadrons: boolFromMap(
        values,
        "app.ui.fleet_tab.open_air_base_squadrons",
        base.fleet_tab.open_air_base_squadrons,
      ),
      show_battles: boolFromMap(
        values,
        "app.ui.fleet_tab.show_battles",
        base.fleet_tab.show_battles,
      ),
      open_battles: boolFromMap(
        values,
        "app.ui.fleet_tab.open_battles",
        base.fleet_tab.open_battles,
      ),
    },
    fleets: {
      show_condition_value: boolFromMap(
        values,
        "app.ui.fleets.show_condition_value",
        base.fleets.show_condition_value,
      ),
      show_fleet_1: boolFromMap(
        values,
        "app.ui.fleets.show_fleet_1",
        base.fleets.show_fleet_1,
      ),
      open_fleet_1: boolFromMap(
        values,
        "app.ui.fleets.open_fleet_1",
        base.fleets.open_fleet_1,
      ),
      show_fleet_2: boolFromMap(
        values,
        "app.ui.fleets.show_fleet_2",
        base.fleets.show_fleet_2,
      ),
      open_fleet_2: boolFromMap(
        values,
        "app.ui.fleets.open_fleet_2",
        base.fleets.open_fleet_2,
      ),
      show_fleet_3: boolFromMap(
        values,
        "app.ui.fleets.show_fleet_3",
        base.fleets.show_fleet_3,
      ),
      open_fleet_3: boolFromMap(
        values,
        "app.ui.fleets.open_fleet_3",
        base.fleets.open_fleet_3,
      ),
      show_fleet_4: boolFromMap(
        values,
        "app.ui.fleets.show_fleet_4",
        base.fleets.show_fleet_4,
      ),
      open_fleet_4: boolFromMap(
        values,
        "app.ui.fleets.open_fleet_4",
        base.fleets.open_fleet_4,
      ),
    },
    items: {
      show_items: boolFromMap(
        values,
        "app.ui.items.show_items",
        base.items.show_items,
      ),
      open_items: boolFromMap(
        values,
        "app.ui.items.open_items",
        base.items.open_items,
      ),
      show_normal: boolFromMap(
        values,
        "app.ui.items.show_normal",
        base.items.show_normal,
      ),
      open_normal: boolFromMap(
        values,
        "app.ui.items.open_normal",
        base.items.open_normal,
      ),
      show_special: boolFromMap(
        values,
        "app.ui.items.show_special",
        base.items.show_special,
      ),
      open_special: boolFromMap(
        values,
        "app.ui.items.open_special",
        base.items.open_special,
      ),
      show_purchased: boolFromMap(
        values,
        "app.ui.items.show_purchased",
        base.items.show_purchased,
      ),
      open_purchased: boolFromMap(
        values,
        "app.ui.items.open_purchased",
        base.items.open_purchased,
      ),
      show_furniture: boolFromMap(
        values,
        "app.ui.items.show_furniture",
        base.items.show_furniture,
      ),
      open_furniture: boolFromMap(
        values,
        "app.ui.items.open_furniture",
        base.items.open_furniture,
      ),
    },
    quests: {
      show_quests: boolFromMap(
        values,
        "app.ui.quests.show_quests",
        base.quests.show_quests,
      ),
      open_quests: boolFromMap(
        values,
        "app.ui.quests.open_quests",
        base.quests.open_quests,
      ),
      show_accepted: boolFromMap(
        values,
        "app.ui.quests.show_accepted",
        base.quests.show_accepted,
      ),
      open_accepted: boolFromMap(
        values,
        "app.ui.quests.open_accepted",
        base.quests.open_accepted,
      ),
      show_available: boolFromMap(
        values,
        "app.ui.quests.show_available",
        base.quests.show_available,
      ),
      open_available: boolFromMap(
        values,
        "app.ui.quests.open_available",
        base.quests.open_available,
      ),
      show_completed: boolFromMap(
        values,
        "app.ui.quests.show_completed",
        base.quests.show_completed,
      ),
      open_completed: boolFromMap(
        values,
        "app.ui.quests.open_completed",
        base.quests.open_completed,
      ),
    },
  };
}

function readCachedUiConfig(): UiConfigState {
  const defaults = createDefaultUiConfig();
  if (typeof localStorage === "undefined") {
    return defaults;
  }
  try {
    const raw = localStorage.getItem(UI_CONFIG_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<UiConfigState>;
    return {
      tabs: { ...defaults.tabs, ...(parsed.tabs ?? {}) },
      fleet_tab: { ...defaults.fleet_tab, ...(parsed.fleet_tab ?? {}) },
      fleets: { ...defaults.fleets, ...(parsed.fleets ?? {}) },
      items: { ...defaults.items, ...(parsed.items ?? {}) },
      quests: { ...defaults.quests, ...(parsed.quests ?? {}) },
    };
  } catch {
    return defaults;
  }
}

function writeCachedUiConfig(next: UiConfigState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(UI_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota / private mode failures
  }
}

const [uiConfigStore, setUiConfigStore] = createStore<UiConfigState>(
  readCachedUiConfig(),
);

export function useUiConfig(): UiConfigState {
  return uiConfigStore;
}

export function setUiConfig(next: UiConfigState): void {
  setUiConfigStore(next);
  writeCachedUiConfig(next);
}

export function resetUiConfigToDefaults(): void {
  setUiConfig(createDefaultUiConfig());
}

export function applyUiConfigFromValues(values: ConfigValuesMap): UiConfigState {
  const next = parseUiConfigValues(values, createDefaultUiConfig());
  setUiConfig(next);
  return next;
}

export async function loadUiConfig(): Promise<UiConfigState> {
  if (!isTauri()) {
    return uiConfigStore;
  }
  try {
    const res = await invoke<AppConfigsResponse>("get_app_configs");
    const merged: ConfigValuesMap = {
      ...res.defaults,
      ...res.values,
    };
    return applyUiConfigFromValues(merged);
  } catch (err) {
    console.warn("Failed to load UI config from backend:", err);
    return uiConfigStore;
  }
}

export function isFleetVisible(
  fleets: UiConfigState["fleets"],
  deckId: number,
): boolean {
  switch (deckId) {
    case 1:
      return fleets.show_fleet_1;
    case 2:
      return fleets.show_fleet_2;
    case 3:
      return fleets.show_fleet_3;
    case 4:
      return fleets.show_fleet_4;
    default:
      return true;
  }
}

export function isFleetOpen(
  fleets: UiConfigState["fleets"],
  deckId: number,
): boolean {
  switch (deckId) {
    case 1:
      return fleets.open_fleet_1;
    case 2:
      return fleets.open_fleet_2;
    case 3:
      return fleets.open_fleet_3;
    case 4:
      return fleets.open_fleet_4;
    default:
      return false;
  }
}

/**
 * Keeps a `<details>` element's `open` state synchronized with a config getter
 * while still allowing users to freely expand/collapse it interactively.
 */
export function createConfigDisclosure(configOpen: () => boolean) {
  // eslint-disable-next-line solid/reactivity
  const [isOpen, setIsOpen] = createSignal(configOpen());
  createEffect(() => {
    setIsOpen(configOpen());
  });
  const onToggle = (e: Event & { currentTarget: HTMLDetailsElement }) => {
    setIsOpen(e.currentTarget.open);
  };
  return [isOpen, onToggle] as const;
}
