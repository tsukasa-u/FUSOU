import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_VALUES } from "../components/settings/config_schema";
import {
  createDefaultUiConfig,
  isFleetOpen,
  isFleetVisible,
  parseUiConfigValues,
} from "./ui_config";

describe("ui_config", () => {
  it("matches default config values from config_schema", () => {
    const parsed = parseUiConfigValues(DEFAULT_CONFIG_VALUES);
    expect(parsed).toEqual(createDefaultUiConfig());
  });

  it("applies visibility and collapse overrides cleanly", () => {
    const parsed = parseUiConfigValues({
      "app.ui.tabs.show_item": false,
      "app.ui.fleet_tab.show_fleets": false,
      "app.ui.fleet_tab.open_fleets": false,
      "app.ui.fleet_tab.open_air_bases": true,
      "app.ui.fleets.show_condition_value": false,
      "app.ui.fleets.show_fleet_4": false,
      "app.ui.fleets.open_fleet_2": true,
      "app.ui.items.show_items": false,
      "app.ui.items.open_normal": false,
      "app.ui.quests.show_completed": false,
      "app.ui.quests.open_available": false,
    });

    expect(parsed.tabs.show_item).toBe(false);
    expect(parsed.tabs.show_fleet).toBe(true);
    expect(parsed.fleet_tab.show_fleets).toBe(false);
    expect(parsed.fleet_tab.open_fleets).toBe(false);
    expect(parsed.fleet_tab.open_air_bases).toBe(true);
    expect(parsed.fleets.show_condition_value).toBe(false);
    expect(isFleetVisible(parsed.fleets, 4)).toBe(false);
    expect(isFleetVisible(parsed.fleets, 1)).toBe(true);
    expect(isFleetOpen(parsed.fleets, 2)).toBe(true);
    expect(isFleetOpen(parsed.fleets, 3)).toBe(false);
    expect(parsed.items.show_items).toBe(false);
    expect(parsed.items.open_normal).toBe(false);
    expect(parsed.quests.show_completed).toBe(false);
    expect(parsed.quests.open_available).toBe(false);
  });
});
