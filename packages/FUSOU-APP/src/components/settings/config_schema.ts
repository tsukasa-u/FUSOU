export type ConfigValue = boolean | number | string | string[];

export type ConfigValuesMap = Record<string, ConfigValue>;

export interface KcServerOption {
  index: number;
  hostname: string;
  label: string;
}

export interface AppConfigsResponse {
  config_path: string;
  values: ConfigValuesMap;
  defaults: ConfigValuesMap;
  restart_required_keys: string[];
  server_list: KcServerOption[];
  platform: string;
}

export interface SaveAppConfigsResponse {
  values: ConfigValuesMap;
  updated_keys: string[];
  restart_required: boolean;
  restart_required_keys: string[];
}

export type ConfigFieldKind =
  | "boolean"
  | "text"
  | "number"
  | "select"
  | "path"
  | "string_array"
  | "server"
  | "font";

export interface ConfigSelectOption {
  value: string;
  label: string;
}

export interface ConfigFieldDependency {
  key: string;
  equals: boolean;
}

export interface ConfigFieldSpec {
  key: string;
  label: string;
  description: string;
  kind: ConfigFieldKind;
  requiresRestart: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: readonly ConfigSelectOption[];
  pathMode?: "directory" | "file";
  dependsOn?: ConfigFieldDependency;
  linuxOnly?: boolean;
  url?: boolean;
  allowTokenPlaceholder?: boolean;
  cron?: boolean;
}

export interface ConfigSectionSpec {
  id: string;
  title: string;
  description?: string;
  fields: readonly ConfigFieldSpec[];
}

export interface DataSenderSpec {
  id: string;
  label: string;
  description: string;
  enableKey: string;
  localKey: string;
  endpointKey: string;
}

export const FONT_PRESET_OPTIONS: readonly string[] = [
  "Noto Sans JP",
  "BIZ UDPGothic",
  "M PLUS 1p",
  "Zen Kaku Gothic New",
  "Inter",
  "Roboto",
];

export const DEFAULT_SERVER_OPTIONS: readonly KcServerOption[] = [
  {
    index: 1,
    hostname: "w01y.kancolle-server.com",
    label: "横須賀鎮守府 (w01y.kancolle-server.com)",
  },
  {
    index: 2,
    hostname: "w02k.kancolle-server.com",
    label: "新呉鎮守府 (w02k.kancolle-server.com)",
  },
  {
    index: 3,
    hostname: "w03s.kancolle-server.com",
    label: "佐世保鎮守府 (w03s.kancolle-server.com)",
  },
  {
    index: 4,
    hostname: "w04m.kancolle-server.com",
    label: "舞鶴鎮守府 (w04m.kancolle-server.com)",
  },
  {
    index: 5,
    hostname: "w05o.kancolle-server.com",
    label: "大湊警備府 (w05o.kancolle-server.com)",
  },
  {
    index: 6,
    hostname: "w06k.kancolle-server.com",
    label: "トラック泊地 (w06k.kancolle-server.com)",
  },
  {
    index: 7,
    hostname: "w07l.kancolle-server.com",
    label: "リンガ泊地 (w07l.kancolle-server.com)",
  },
  {
    index: 8,
    hostname: "w08r.kancolle-server.com",
    label: "ラバウル基地 (w08r.kancolle-server.com)",
  },
  {
    index: 9,
    hostname: "w09s.kancolle-server.com",
    label: "ショートランド泊地 (w09s.kancolle-server.com)",
  },
  {
    index: 10,
    hostname: "w10b.kancolle-server.com",
    label: "ブイン基地 (w10b.kancolle-server.com)",
  },
  {
    index: 11,
    hostname: "w11t.kancolle-server.com",
    label: "タウイタウイ泊地 (w11t.kancolle-server.com)",
  },
  {
    index: 12,
    hostname: "w12p.kancolle-server.com",
    label: "パラオ泊地 (w12p.kancolle-server.com)",
  },
  {
    index: 13,
    hostname: "w13b.kancolle-server.com",
    label: "ブルネイ泊地 (w13b.kancolle-server.com)",
  },
  {
    index: 14,
    hostname: "w14h.kancolle-server.com",
    label: "単冠湾泊地 (w14h.kancolle-server.com)",
  },
  {
    index: 15,
    hostname: "w15p.kancolle-server.com",
    label: "幌筵泊地 (w15p.kancolle-server.com)",
  },
  {
    index: 16,
    hostname: "w16s.kancolle-server.com",
    label: "宿毛湾泊地 (w16s.kancolle-server.com)",
  },
  {
    index: 17,
    hostname: "w17k.kancolle-server.com",
    label: "鹿屋基地 (w17k.kancolle-server.com)",
  },
  {
    index: 18,
    hostname: "w18i.kancolle-server.com",
    label: "岩川基地 (w18i.kancolle-server.com)",
  },
  {
    index: 19,
    hostname: "w19s.kancolle-server.com",
    label: "佐伯湾泊地 (w19s.kancolle-server.com)",
  },
  {
    index: 20,
    hostname: "w20h.kancolle-server.com",
    label: "柱島泊地 (w20h.kancolle-server.com)",
  },
];

export const DATA_SENDER_SPECS: readonly DataSenderSpec[] = [
  {
    id: "quest_tree_sender",
    label: "Quest Tree",
    description: "Record quest unlock transitions and prerequisites.",
    enableKey: "app.quest_tree_sender.enable",
    localKey: "app.quest_tree_sender.allow_data_to_local",
    endpointKey: "app.quest_tree_sender.ingest_endpoint",
  },
  {
    id: "ship_growth_sender",
    label: "Ship Growth",
    description:
      "Record ship EXP and naked parameter progression observations.",
    enableKey: "app.ship_growth_sender.enable",
    localKey: "app.ship_growth_sender.allow_data_to_local",
    endpointKey: "app.ship_growth_sender.ingest_endpoint",
  },
  {
    id: "soku_speed_sender",
    label: "Fleet Speed (Soku)",
    description: "Record observed ship speed combinations during sorties.",
    enableKey: "app.soku_speed_sender.enable",
    localKey: "app.soku_speed_sender.allow_data_to_local",
    endpointKey: "app.soku_speed_sender.ingest_endpoint",
  },
  {
    id: "remodel_sender",
    label: "Remodel Tree (Experimental)",
    description: "Record equipment improvement recipes and material costs.",
    enableKey: "app.remodel_sender.enable",
    localKey: "app.remodel_sender.allow_data_to_local",
    endpointKey: "app.remodel_sender.ingest_endpoint",
  },
];

export const PRIMARY_CONFIG_SECTIONS: readonly ConfigSectionSpec[] = [
  {
    id: "general",
    title: "General & Appearance",
    fields: [
      {
        key: "app.theme.theme",
        label: "Theme",
        description:
          "Color theme for FUSOU windows. Also persisted to configs.toml.",
        kind: "select",
        requiresRestart: false,
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
      {
        key: "app.font.font_family",
        label: "Font Family",
        description:
          "Google Fonts family name for the UI. Leave empty to use the system default font.",
        kind: "font",
        requiresRestart: false,
        placeholder: "Noto Sans JP",
      },
      {
        key: "app.autostart.enable",
        label: "Launch at Startup",
        description:
          "Enable OS startup autolaunch integration and tray startup toggle.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "app.connect_kc_server.kc_server_name",
        label: "KanColle Server",
        description:
          "Target server hostname for proxy routing. Choose Auto Listen to detect automatically.",
        kind: "server",
        requiresRestart: true,
        placeholder: "w16s.kancolle-server.com",
      },
      {
        key: "app.browser.external_screenshot_directory",
        label: "Screenshot Directory",
        description:
          "Folder where external WebView screenshots are saved. Leave empty for Pictures/FUSOU/screenshots.",
        kind: "path",
        pathMode: "directory",
        requiresRestart: false,
        placeholder: "Default (Pictures/FUSOU/screenshots)",
      },
    ],
  },
  {
    id: "data_sync",
    title: "Data Storage & Sync",
    fields: [
      {
        key: "app.auth.allow_auth",
        label: "Enable Authentication & Cloud Sync",
        description:
          "Master switch for anonymous authentication and all cloud uploads (shared R2 database, asset sync, snapshot sync, and remote senders). Local saving works even when disabled.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "app.database.allow_data_to_shared_cloud",
        label: "Shared Cloud Database (R2)",
        description:
          "Upload battle and master tables to the shared Cloudflare R2 database.",
        kind: "boolean",
        requiresRestart: true,
        dependsOn: { key: "app.auth.allow_auth", equals: true },
      },
      {
        key: "app.asset_sync.asset_upload_enable",
        label: "Asset Upload Worker",
        description:
          "Automatically upload newly cached game assets to Cloudflare R2.",
        kind: "boolean",
        requiresRestart: true,
        dependsOn: { key: "app.auth.allow_auth", equals: true },
      },
      {
        key: "app.database.allow_data_to_local",
        label: "Local Filesystem Storage",
        description:
          "Save KanColle battle and master tables to your local disk.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "app.database.local.output_directory",
        label: "Local Storage Directory",
        description:
          "Base directory for local table files and JSONL logs. Leave empty for Documents/FUSOU/storage.",
        kind: "path",
        pathMode: "directory",
        requiresRestart: true,
        placeholder: "Default (Documents/FUSOU/storage)",
      },
    ],
  },
  {
    id: "discord",
    title: "Discord Rich Presence",
    fields: [
      {
        key: "app.discord.enable_discord_integration",
        label: "Enable Discord Integration",
        description:
          "Display FUSOU activity status via Discord Rich Presence on launch.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "app.discord.use_custom_message",
        label: "Use Custom Presence Message",
        description:
          "Override the default Discord activity state and details text.",
        kind: "boolean",
        requiresRestart: true,
        dependsOn: {
          key: "app.discord.enable_discord_integration",
          equals: true,
        },
      },
      {
        key: "app.discord.custom_message",
        label: "Custom State Message",
        description: "Primary status line shown in Discord Rich Presence.",
        kind: "text",
        requiresRestart: true,
        placeholder: "Playing KanColle with FUSOU",
        dependsOn: {
          key: "app.discord.use_custom_message",
          equals: true,
        },
      },
      {
        key: "app.discord.custom_details",
        label: "Custom Details",
        description: "Secondary details line shown in Discord Rich Presence.",
        kind: "text",
        requiresRestart: true,
        placeholder: "Sortie & fleet tracking",
        dependsOn: {
          key: "app.discord.use_custom_message",
          equals: true,
        },
      },
      {
        key: "app.discord.use_custom_image",
        label: "Use Custom Large Image",
        description:
          "Display a custom image URL in Discord Rich Presence (requires custom message).",
        kind: "boolean",
        requiresRestart: true,
        dependsOn: {
          key: "app.discord.use_custom_message",
          equals: true,
        },
      },
      {
        key: "app.discord.custom_image_url",
        label: "Custom Image URL",
        description: "HTTP(S) URL of the image used for Discord Rich Presence.",
        kind: "text",
        requiresRestart: true,
        url: true,
        placeholder: "https://example.com/image.png",
        dependsOn: {
          key: "app.discord.use_custom_image",
          equals: true,
        },
      },
    ],
  },
  {
    id: "proxy_capture",
    title: "Proxy & Traffic Capture",
    fields: [
      {
        key: "proxy.allow_save_api_requests",
        label: "Save API Requests",
        description: "Write captured KanColle API request payloads to disk.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.allow_save_api_responses",
        label: "Save API Responses",
        description: "Write captured KanColle API response payloads to disk.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.allow_save_resources",
        label: "Save Game Resources",
        description: "Save game resource files such as images and metadata.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.allow_save_main_js_local",
        label: "Save main.js Locally",
        description:
          "Save only main.js locally (JavaScript files are never uploaded by asset sync).",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.save_file_location",
        label: "Capture Save Directory",
        description:
          "Override directory for saved proxy files. Leave empty to use Documents/fusou/FUSOU-PROXY-DATA.",
        kind: "path",
        pathMode: "directory",
        requiresRestart: true,
        placeholder: "Default (Documents/fusou/FUSOU-PROXY-DATA)",
      },
    ],
  },
];

export const UI_CONFIG_SECTIONS: readonly ConfigSectionSpec[] = [
  {
    id: "ui_tabs",
    title: "Tabs Visibility",
    description:
      "Show or hide top-level navigation tabs. The Settings tab is always kept visible.",
    fields: [
      {
        key: "app.ui.tabs.show_fleet",
        label: "Show Fleet Tab",
        description:
          "Display the Fleet tab (Materials, Fleets, Repair Docks, Air Base, Battles).",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.tabs.show_ship",
        label: "Show Ship Tab",
        description: "Display the Ship specification table tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.tabs.show_equip",
        label: "Show Equip Tab",
        description: "Display the Equipment specification table tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.tabs.show_item",
        label: "Show Item Tab",
        description: "Display the Item list tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.tabs.show_quest",
        label: "Show Quest Tab",
        description: "Display the Quest list tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.tabs.show_uploads",
        label: "Show Uploads Tab",
        description: "Display the Uploads / Data Collection status tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.tabs.show_logs",
        label: "Show Logs Tab",
        description: "Display the Logs viewer tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.tabs.show_policy",
        label: "Show Policy Tab",
        description: "Display the Policy tab.",
        kind: "boolean",
        requiresRestart: false,
      },
    ],
  },
  {
    id: "ui_fleet_tab",
    title: "Fleet Tab Sections",
    description:
      "Show/hide and expand/collapse each top-level list inside the Fleet tab.",
    fields: [
      {
        key: "app.ui.fleet_tab.show_materials",
        label: "Show Materials Section",
        description: "Display the Materials resource bar in the Fleet tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.fleet_tab.open_materials",
        label: "Expand Materials Section",
        description: "Keep the Materials section expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_materials", equals: true },
      },
      {
        key: "app.ui.fleet_tab.show_fleets",
        label: "Show Fleets List",
        description: "Display the Fleets section in the Fleet tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.fleet_tab.open_fleets",
        label: "Expand Fleets List",
        description: "Keep the Fleets list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_fleets", equals: true },
      },
      {
        key: "app.ui.fleet_tab.show_repair_docks",
        label: "Show Repair Docks",
        description: "Display the Repair Docks list in the Fleet tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.fleet_tab.open_repair_docks",
        label: "Expand Repair Docks",
        description: "Keep the Repair Docks list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_repair_docks", equals: true },
      },
      {
        key: "app.ui.fleet_tab.show_air_bases",
        label: "Show Air Base",
        description: "Display the Land-Based Air Base list in the Fleet tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.fleet_tab.open_air_bases",
        label: "Expand Air Base",
        description: "Keep the Air Base section expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_air_bases", equals: true },
      },
      {
        key: "app.ui.fleet_tab.open_air_base_squadrons",
        label: "Expand Individual Air Base Squadrons",
        description: "Keep each Air Base squadron list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_air_bases", equals: true },
      },
      {
        key: "app.ui.fleet_tab.show_battles",
        label: "Show Battles",
        description: "Display the Battles section in the Fleet tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.fleet_tab.open_battles",
        label: "Expand Battles",
        description: "Keep the Battles section expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_battles", equals: true },
      },
    ],
  },
  {
    id: "ui_fleets",
    title: "Individual Fleets (1st – 4th Fleet)",
    description:
      "Fine-grained visibility and collapse state for each fleet inside the Fleets list.",
    fields: [
      {
        key: "app.ui.fleets.show_condition_value",
        label: "Show Condition Value (Numeric)",
        description:
          'Display the numeric ship condition value in fleet rows. When disabled, "--" is shown while keeping condition icons.',
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_fleets", equals: true },
      },
      {
        key: "app.ui.fleets.show_fleet_1",
        label: "Show 1st Fleet",
        description: "Display the 1st Fleet entry.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_fleets", equals: true },
      },
      {
        key: "app.ui.fleets.open_fleet_1",
        label: "Expand 1st Fleet",
        description: "Keep the 1st Fleet ship list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleets.show_fleet_1", equals: true },
      },
      {
        key: "app.ui.fleets.show_fleet_2",
        label: "Show 2nd Fleet",
        description: "Display the 2nd Fleet entry.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_fleets", equals: true },
      },
      {
        key: "app.ui.fleets.open_fleet_2",
        label: "Expand 2nd Fleet",
        description: "Keep the 2nd Fleet ship list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleets.show_fleet_2", equals: true },
      },
      {
        key: "app.ui.fleets.show_fleet_3",
        label: "Show 3rd Fleet",
        description: "Display the 3rd Fleet entry.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_fleets", equals: true },
      },
      {
        key: "app.ui.fleets.open_fleet_3",
        label: "Expand 3rd Fleet",
        description: "Keep the 3rd Fleet ship list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleets.show_fleet_3", equals: true },
      },
      {
        key: "app.ui.fleets.show_fleet_4",
        label: "Show 4th Fleet",
        description: "Display the 4th Fleet entry.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleet_tab.show_fleets", equals: true },
      },
      {
        key: "app.ui.fleets.open_fleet_4",
        label: "Expand 4th Fleet",
        description: "Keep the 4th Fleet ship list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.fleets.show_fleet_4", equals: true },
      },
    ],
  },
  {
    id: "ui_items",
    title: "Items List & Shelves",
    description:
      "Show/hide and expand/collapse the Items list and individual item shelves.",
    fields: [
      {
        key: "app.ui.items.show_items",
        label: "Show Items List",
        description: "Display the Items list inside the Item tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.items.open_items",
        label: "Expand Items List",
        description: "Keep the top-level Items list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_items", equals: true },
      },
      {
        key: "app.ui.items.show_normal",
        label: "Show Normal Items Shelf",
        description: "Display the Normal Items shelf.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_items", equals: true },
      },
      {
        key: "app.ui.items.open_normal",
        label: "Expand Normal Items Shelf",
        description: "Keep the Normal Items shelf expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_normal", equals: true },
      },
      {
        key: "app.ui.items.show_special",
        label: "Show Special Items Shelf",
        description: "Display the Special Items shelf.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_items", equals: true },
      },
      {
        key: "app.ui.items.open_special",
        label: "Expand Special Items Shelf",
        description: "Keep the Special Items shelf expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_special", equals: true },
      },
      {
        key: "app.ui.items.show_purchased",
        label: "Show Purchased Items Shelf",
        description: "Display the Purchased Items shelf.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_items", equals: true },
      },
      {
        key: "app.ui.items.open_purchased",
        label: "Expand Purchased Items Shelf",
        description: "Keep the Purchased Items shelf expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_purchased", equals: true },
      },
      {
        key: "app.ui.items.show_furniture",
        label: "Show Furniture Store Shelf",
        description: "Display the Furniture Store shelf.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_items", equals: true },
      },
      {
        key: "app.ui.items.open_furniture",
        label: "Expand Furniture Store Shelf",
        description: "Keep the Furniture Store shelf expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.items.show_furniture", equals: true },
      },
    ],
  },
  {
    id: "ui_quests",
    title: "Quests List & Categories",
    description:
      "Show/hide and expand/collapse the Quests list and each quest status category.",
    fields: [
      {
        key: "app.ui.quests.show_quests",
        label: "Show Quests List",
        description: "Display the Quests list inside the Quest tab.",
        kind: "boolean",
        requiresRestart: false,
      },
      {
        key: "app.ui.quests.open_quests",
        label: "Expand Quests List",
        description: "Keep the top-level Quests list expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.quests.show_quests", equals: true },
      },
      {
        key: "app.ui.quests.show_accepted",
        label: "Show Accepted Quests",
        description: "Display the Accepted quests category.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.quests.show_quests", equals: true },
      },
      {
        key: "app.ui.quests.open_accepted",
        label: "Expand Accepted Quests",
        description: "Keep the Accepted quests category expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.quests.show_accepted", equals: true },
      },
      {
        key: "app.ui.quests.show_available",
        label: "Show Available Quests",
        description: "Display the Available quests category.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.quests.show_quests", equals: true },
      },
      {
        key: "app.ui.quests.open_available",
        label: "Expand Available Quests",
        description: "Keep the Available quests category expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.quests.show_available", equals: true },
      },
      {
        key: "app.ui.quests.show_completed",
        label: "Show Completed Quests",
        description: "Display the Completed quests category.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.quests.show_quests", equals: true },
      },
      {
        key: "app.ui.quests.open_completed",
        label: "Expand Completed Quests",
        description: "Keep the Completed quests category expanded by default.",
        kind: "boolean",
        requiresRestart: false,
        dependsOn: { key: "app.ui.quests.show_completed", equals: true },
      },
    ],
  },
];

export const ADVANCED_CONFIG_SECTIONS: readonly ConfigSectionSpec[] = [
  {
    id: "advanced_window",
    title: "Game Browser & Window",
    description:
      "Startup game URL and external game window dimensions / aspect ratio.",
    fields: [
      {
        key: "app.browser.url",
        label: "Game Start URL",
        description: "Initial URL loaded in the external KanColle WebView.",
        kind: "text",
        requiresRestart: true,
        url: true,
        placeholder:
          "http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/",
      },
      {
        key: "app.kc_window.default_inner_width",
        label: "Default Window Width",
        description:
          "Default inner width (px) used on launch and for aspect ratio preservation.",
        kind: "number",
        min: 200,
        max: 7680,
        unit: "px",
        requiresRestart: true,
      },
      {
        key: "app.kc_window.default_inner_height",
        label: "Default Window Height",
        description:
          "Default inner height (px) used on launch and for aspect ratio preservation.",
        kind: "number",
        min: 200,
        max: 7680,
        unit: "px",
        requiresRestart: true,
      },
      {
        key: "app.kc_window.max_inner_width",
        label: "Max Window Width",
        description: "Maximum allowed inner width (px) of the game window.",
        kind: "number",
        min: 200,
        max: 7680,
        unit: "px",
        requiresRestart: true,
      },
      {
        key: "app.kc_window.max_inner_height",
        label: "Max Window Height",
        description: "Maximum allowed inner height (px) of the game window.",
        kind: "number",
        min: 200,
        max: 7680,
        unit: "px",
        requiresRestart: true,
      },
      {
        key: "app.kc_window.resize_debounce_millis",
        label: "Resize Debounce (Linux / Wayland)",
        description:
          "Debounce time (ms) for game window resize events on Wayland.",
        kind: "number",
        min: 0,
        max: 60000,
        unit: "ms",
        requiresRestart: true,
        linuxOnly: true,
      },
      {
        key: "app.kc_window.keep_window_size_duration_millis",
        label: "Keep Size Lock Duration (Linux / Wayland)",
        description:
          "Duration (ms) to hold min/max lock after aspect-ratio resize on Wayland.",
        kind: "number",
        min: 0,
        max: 60000,
        unit: "ms",
        requiresRestart: false,
        linuxOnly: true,
      },
    ],
  },
  {
    id: "advanced_proxy",
    title: "Proxy Network, Certificates & PAC",
    description:
      "Port bindings, TCP tuning, custom SSL certificates, and PAC script routing.",
    fields: [
      {
        key: "proxy.network.proxy_server_port",
        label: "Proxy Server Port",
        description:
          "Fixed listening port for the local proxy. Set 0 to pick an unused port automatically.",
        kind: "number",
        min: 0,
        max: 65535,
        requiresRestart: true,
      },
      {
        key: "proxy.pac.pac_server_port",
        label: "PAC Server Port",
        description:
          "Fixed listening port for the PAC server. Set 0 to pick an unused port automatically.",
        kind: "number",
        min: 0,
        max: 65535,
        requiresRestart: true,
      },
      {
        key: "proxy.pac.use_custom_pac",
        label: "Use Custom PAC Script",
        description:
          "Serve a user-provided PAC file instead of the generated proxy.pac.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.pac.pac_script",
        label: "Custom PAC Script Path",
        description: "Path to the custom .pac file.",
        kind: "path",
        pathMode: "file",
        requiresRestart: true,
        placeholder: "path/to/pac/script.pac",
        dependsOn: { key: "proxy.pac.use_custom_pac", equals: true },
      },
      {
        key: "proxy.certificates.use_generated_certs",
        label: "Use Auto-Generated CA Certificates",
        description:
          "Automatically generate and trust a local CA certificate. Disable to supply custom PEM files.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.certificates.cert_file",
        label: "Custom SSL Certificate File",
        description:
          "Path to custom CA certificate file when auto-generated certificates are disabled.",
        kind: "path",
        pathMode: "file",
        requiresRestart: true,
        placeholder: "path/to/cert/file",
        dependsOn: {
          key: "proxy.certificates.use_generated_certs",
          equals: false,
        },
      },
      {
        key: "proxy.certificates.key_file",
        label: "Custom SSL Private Key File",
        description:
          "Path to custom CA private key file when auto-generated certificates are disabled.",
        kind: "path",
        pathMode: "file",
        requiresRestart: true,
        placeholder: "path/to/key/file",
        dependsOn: {
          key: "proxy.certificates.use_generated_certs",
          equals: false,
        },
      },
      {
        key: "proxy.network.enforce_http",
        label: "Enforce HTTP to Proxy Client",
        description: "Force HTTP transport between proxy client and server.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.network.set_nodelay",
        label: "Enable TCP_NODELAY",
        description: "Disable Nagle's algorithm on the proxy TCP listener.",
        kind: "boolean",
        requiresRestart: true,
      },
      {
        key: "proxy.network.connect_timeout",
        label: "Connect Timeout",
        description:
          "Timeout in seconds when connecting to upstream servers (0 = system default).",
        kind: "number",
        min: 0,
        unit: "s",
        requiresRestart: true,
      },
      {
        key: "proxy.network.keepalive_interval",
        label: "TCP Keepalive Interval",
        description: "TCP keepalive interval in seconds (0 = system default).",
        kind: "number",
        min: 0,
        unit: "s",
        requiresRestart: true,
      },
      {
        key: "proxy.network.recv_buffer_size",
        label: "Receive Buffer Size",
        description:
          "Socket receive buffer size in bytes (0 = system default).",
        kind: "number",
        min: 0,
        unit: "B",
        requiresRestart: true,
      },
      {
        key: "proxy.network.send_buffer_size",
        label: "Send Buffer Size",
        description: "Socket send buffer size in bytes (0 = system default).",
        kind: "number",
        min: 0,
        unit: "B",
        requiresRestart: true,
      },
    ],
  },
  {
    id: "advanced_sync_retry",
    title: "Sync Schedule, Storage & Retry Tuning",
    description:
      "Batch sizes, cron scheduling, asset sync polling, and retry backoff settings.",
    fields: [
      {
        key: "app.database.integration_schedule_cron",
        label: "Integration Schedule (Cron)",
        description:
          '6-field cron expression ("sec min hour day month day_of_week"), e.g. "0 0 * * * *".',
        kind: "text",
        requiresRestart: true,
        cron: true,
        placeholder: "0 0 * * * *",
      },
      {
        key: "app.database.local.integration_batch_size",
        label: "Local Integration Batch Size",
        description:
          "Number of records processed per local integration batch (1–10000).",
        kind: "number",
        min: 1,
        max: 10000,
        requiresRestart: false,
      },
      {
        key: "app.asset_sync.scan_interval_seconds",
        label: "Asset Scan Interval",
        description:
          "Polling interval in seconds for scanning cached asset files.",
        kind: "number",
        min: 1,
        unit: "s",
        requiresRestart: true,
      },
      {
        key: "app.asset_sync.asset_skip_extensions",
        label: "Skipped Asset Extensions",
        description:
          "Comma-separated file extensions (without dots) excluded from R2 asset uploads.",
        kind: "string_array",
        requiresRestart: true,
        placeholder: "mp3, woff2, js",
      },
      {
        key: "app.asset_sync.retry.max_attempts",
        label: "Retry Max Attempts",
        description: "Maximum retry attempts before dropping a pending upload.",
        kind: "number",
        min: 1,
        requiresRestart: false,
      },
      {
        key: "app.asset_sync.retry.ttl_seconds",
        label: "Pending Upload TTL",
        description:
          "Time to live in seconds before pending upload files expire (default 2592000 = 30 days).",
        kind: "number",
        min: 60,
        unit: "s",
        requiresRestart: false,
      },
      {
        key: "app.asset_sync.retry.interval_seconds",
        label: "Retry Base Interval",
        description:
          "Base interval in seconds between automatic upload retry runs.",
        kind: "number",
        min: 1,
        unit: "s",
        requiresRestart: true,
      },
      {
        key: "app.asset_sync.retry.auth_backoff_seconds",
        label: "Auth Failure Backoff",
        description:
          "Cooldown in seconds after an authentication failure before retrying.",
        kind: "number",
        min: 1,
        unit: "s",
        requiresRestart: false,
      },
      {
        key: "app.asset_sync.retry.item_interval_seconds",
        label: "Per-Item Retry Delay",
        description:
          "Minimum wait time in seconds between individual items in a retry batch (0 = disabled).",
        kind: "number",
        min: 0,
        unit: "s",
        requiresRestart: false,
      },
    ],
  },
  {
    id: "advanced_endpoints",
    title: "API Endpoints & Authentication",
    description:
      "Override backend service endpoints for self-hosted or development environments.",
    fields: [
      {
        key: "app.map_cell_labels.bundle_url",
        label: "Map Cell Labels Bundle URL",
        description: "JSON bundle URL providing map node letter labels.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.database.r2.upload_endpoint",
        label: "Battle Data Upload Endpoint",
        description: "HTTPS endpoint for Cloudflare R2 battle data uploads.",
        kind: "text",
        requiresRestart: false,
        url: true,
      },
      {
        key: "app.database.r2.master_data_upload_endpoint",
        label: "Master Data Upload Endpoint",
        description: "HTTPS endpoint for master data uploads.",
        kind: "text",
        requiresRestart: false,
        url: true,
      },
      {
        key: "app.asset_sync.asset_upload_endpoint",
        label: "Asset Upload Endpoint",
        description: "HTTPS endpoint mediating Cloudflare R2 asset uploads.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.asset_sync.fleet_snapshot_endpoint",
        label: "Fleet Snapshot Endpoint",
        description: "HTTPS endpoint for fleet snapshot uploads.",
        kind: "text",
        requiresRestart: false,
        url: true,
      },
      {
        key: "app.asset_sync.kc_period_endpoint",
        label: "KC Period Tag Endpoint",
        description: "Endpoint returning the latest maintenance period tag.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.asset_sync.asset_existing_keys_endpoint",
        label: "Existing Asset Keys Endpoint",
        description: "Endpoint returning the cached list of uploaded R2 keys.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.quest_tree_sender.ingest_endpoint",
        label: "Quest Tree Ingest Endpoint",
        description: "HTTPS endpoint receiving quest tree observations.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.ship_growth_sender.ingest_endpoint",
        label: "Ship Growth Ingest Endpoint",
        description: "HTTPS endpoint receiving ship growth observations.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.soku_speed_sender.ingest_endpoint",
        label: "Fleet Speed Ingest Endpoint",
        description: "HTTPS endpoint receiving speed observations.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.remodel_sender.ingest_endpoint",
        label: "Remodel Data Ingest Endpoint",
        description: "HTTPS endpoint receiving remodel recipe observations.",
        kind: "text",
        requiresRestart: true,
        url: true,
      },
      {
        key: "app.auth.auth_page_url",
        label: "Auth Page URL",
        description:
          "Sign-in page opened when user authentication is triggered.",
        kind: "text",
        requiresRestart: false,
        url: true,
      },
      {
        key: "app.auth.anonymous_sync_v2_register_endpoint",
        label: "Anonymous Sync Register Endpoint",
        description: "v2 device registration endpoint.",
        kind: "text",
        requiresRestart: false,
        url: true,
      },
      {
        key: "app.auth.anonymous_sync_v2_challenge_endpoint",
        label: "Anonymous Sync Challenge Endpoint",
        description: "v2 authentication challenge endpoint.",
        kind: "text",
        requiresRestart: false,
        url: true,
      },
      {
        key: "app.auth.anonymous_sync_v2_refresh_endpoint",
        label: "Anonymous Sync Refresh Endpoint",
        description: "v2 dataset token refresh endpoint.",
        kind: "text",
        requiresRestart: false,
        url: true,
      },
      {
        key: "app.auth.anonymous_sync_v2_complete_endpoint",
        label: "Anonymous Sync Complete Endpoint",
        description:
          "v2 pending token completion endpoint (supports {token} placeholder).",
        kind: "text",
        requiresRestart: false,
        url: true,
        allowTokenPlaceholder: true,
      },
    ],
  },
];

export const DEFAULT_CONFIG_VALUES: ConfigValuesMap = {
  "app.theme.theme": "light",
  "app.font.font_family": "Noto Sans JP",
  "app.autostart.enable": false,
  "app.connect_kc_server.kc_server_name": "",
  "app.browser.external_screenshot_directory": "",
  "app.browser.url":
    "http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/",
  "app.discord.enable_discord_integration": false,
  "app.discord.use_custom_message": false,
  "app.discord.custom_message": "",
  "app.discord.custom_details": "",
  "app.discord.use_custom_image": false,
  "app.discord.custom_image_url": "",
  "app.map_cell_labels.bundle_url":
    "https://fusou.dev/battle-maps/cell_labels.json",
  "app.database.allow_data_to_shared_cloud": false,
  "app.database.allow_data_to_local": false,
  "app.database.integration_schedule_cron": "0 0 * * * *",
  "app.database.local.output_directory": "",
  "app.database.local.integration_batch_size": 500,
  "app.database.r2.upload_endpoint": "https://fusou.dev/api/battle-data/upload",
  "app.database.r2.master_data_upload_endpoint":
    "https://fusou.dev/api/master-data/upload",
  "app.asset_sync.asset_upload_enable": false,
  "app.asset_sync.scan_interval_seconds": 30,
  "app.asset_sync.asset_upload_endpoint":
    "https://fusou.dev/api/asset-sync/upload",
  "app.asset_sync.fleet_snapshot_endpoint":
    "https://fusou.dev/api/fleet/snapshot",
  "app.asset_sync.kc_period_endpoint": "https://fusou.dev/api/kc-period/latest",
  "app.asset_sync.asset_existing_keys_endpoint":
    "https://fusou.dev/api/asset-sync/keys",
  "app.asset_sync.asset_skip_extensions": ["mp3", "woff2", "js"],
  "app.asset_sync.retry.max_attempts": 10,
  "app.asset_sync.retry.ttl_seconds": 2592000,
  "app.asset_sync.retry.interval_seconds": 900,
  "app.asset_sync.retry.auth_backoff_seconds": 600,
  "app.asset_sync.retry.item_interval_seconds": 5,
  "app.auth.allow_auth": false,
  "app.auth.auth_page_url": "https://fusou.dev/auth/local/signin",
  "app.auth.anonymous_sync_v2_register_endpoint":
    "https://fusou.dev/api/auth/anonymous-sync/v2/register",
  "app.auth.anonymous_sync_v2_challenge_endpoint":
    "https://fusou.dev/api/auth/anonymous-sync/v2/challenge",
  "app.auth.anonymous_sync_v2_refresh_endpoint":
    "https://fusou.dev/api/auth/anonymous-sync/v2/refresh",
  "app.auth.anonymous_sync_v2_complete_endpoint":
    "https://fusou.dev/api/auth/anonymous-sync/v2/pending/{token}/complete",
  "app.quest_tree_sender.enable": false,
  "app.quest_tree_sender.allow_data_to_local": false,
  "app.quest_tree_sender.ingest_endpoint":
    "https://fusou.dev/api/quest-tree/ingest",
  "app.ship_growth_sender.enable": false,
  "app.ship_growth_sender.allow_data_to_local": false,
  "app.ship_growth_sender.ingest_endpoint":
    "https://fusou.dev/api/ship-growth/ingest",
  "app.soku_speed_sender.enable": false,
  "app.soku_speed_sender.allow_data_to_local": false,
  "app.soku_speed_sender.ingest_endpoint":
    "https://fusou.dev/api/soku-speed-observed/ingest",
  "app.remodel_sender.enable": false,
  "app.remodel_sender.allow_data_to_local": false,
  "app.remodel_sender.ingest_endpoint":
    "https://fusou.dev/api/remodel-data/ingest",
  "app.kc_window.default_inner_width": 1200,
  "app.kc_window.default_inner_height": 720,
  "app.kc_window.max_inner_width": 1920,
  "app.kc_window.max_inner_height": 1080,
  "app.kc_window.resize_debounce_millis": 200,
  "app.kc_window.keep_window_size_duration_millis": 1000,
  "app.ui.tabs.show_fleet": true,
  "app.ui.tabs.show_ship": true,
  "app.ui.tabs.show_equip": true,
  "app.ui.tabs.show_item": true,
  "app.ui.tabs.show_quest": true,
  "app.ui.tabs.show_uploads": true,
  "app.ui.tabs.show_logs": true,
  "app.ui.tabs.show_policy": true,
  "app.ui.fleet_tab.show_materials": true,
  "app.ui.fleet_tab.open_materials": true,
  "app.ui.fleet_tab.show_fleets": true,
  "app.ui.fleet_tab.open_fleets": true,
  "app.ui.fleet_tab.show_repair_docks": true,
  "app.ui.fleet_tab.open_repair_docks": true,
  "app.ui.fleet_tab.show_air_bases": true,
  "app.ui.fleet_tab.open_air_bases": false,
  "app.ui.fleet_tab.open_air_base_squadrons": false,
  "app.ui.fleet_tab.show_battles": true,
  "app.ui.fleet_tab.open_battles": true,
  "app.ui.fleets.show_condition_value": true,
  "app.ui.fleets.show_fleet_1": true,
  "app.ui.fleets.open_fleet_1": true,
  "app.ui.fleets.show_fleet_2": true,
  "app.ui.fleets.open_fleet_2": false,
  "app.ui.fleets.show_fleet_3": true,
  "app.ui.fleets.open_fleet_3": false,
  "app.ui.fleets.show_fleet_4": true,
  "app.ui.fleets.open_fleet_4": false,
  "app.ui.items.show_items": true,
  "app.ui.items.open_items": true,
  "app.ui.items.show_normal": true,
  "app.ui.items.open_normal": true,
  "app.ui.items.show_special": true,
  "app.ui.items.open_special": true,
  "app.ui.items.show_purchased": true,
  "app.ui.items.open_purchased": true,
  "app.ui.items.show_furniture": true,
  "app.ui.items.open_furniture": true,
  "app.ui.quests.show_quests": true,
  "app.ui.quests.open_quests": true,
  "app.ui.quests.show_accepted": true,
  "app.ui.quests.open_accepted": true,
  "app.ui.quests.show_available": true,
  "app.ui.quests.open_available": true,
  "app.ui.quests.show_completed": true,
  "app.ui.quests.open_completed": true,
  "proxy.allow_save_api_requests": false,
  "proxy.allow_save_api_responses": false,
  "proxy.allow_save_resources": false,
  "proxy.allow_save_main_js_local": false,
  "proxy.save_file_location": "",
  "proxy.network.enforce_http": false,
  "proxy.network.set_nodelay": false,
  "proxy.network.connect_timeout": 0,
  "proxy.network.keepalive_interval": 0,
  "proxy.network.recv_buffer_size": 8000000,
  "proxy.network.send_buffer_size": 8000000,
  "proxy.network.proxy_server_port": 0,
  "proxy.certificates.use_generated_certs": true,
  "proxy.certificates.cert_file": "path/to/cert/file",
  "proxy.certificates.key_file": "path/to/key/file",
  "proxy.pac.use_custom_pac": false,
  "proxy.pac.pac_script": "path/to/pac/script.pac",
  "proxy.pac.pac_server_port": 0,
};

export const ALL_FIELD_SPECS: readonly ConfigFieldSpec[] = [
  ...PRIMARY_CONFIG_SECTIONS.flatMap((section) => section.fields),
  ...UI_CONFIG_SECTIONS.flatMap((section) => section.fields),
  ...ADVANCED_CONFIG_SECTIONS.flatMap((section) => section.fields),
];

export const FIELD_SPEC_BY_KEY: ReadonlyMap<string, ConfigFieldSpec> = new Map(
  ALL_FIELD_SPECS.map((field) => [field.key, field]),
);

export const DEFAULT_RESTART_REQUIRED_KEYS: ReadonlySet<string> = new Set([
  ...ALL_FIELD_SPECS.filter((field) => field.requiresRestart).map(
    (field) => field.key,
  ),
  ...DATA_SENDER_SPECS.flatMap((sender) => [
    sender.enableKey,
    sender.localKey,
    sender.endpointKey,
  ]),
]);

export function getConfigKeyLabel(key: string): string {
  const spec = FIELD_SPEC_BY_KEY.get(key);
  if (spec) return spec.label;

  for (const sender of DATA_SENDER_SPECS) {
    if (key === sender.enableKey) return `${sender.label} (Remote Upload)`;
    if (key === sender.localKey) return `${sender.label} (Local JSONL)`;
    if (key === sender.endpointKey) return `${sender.label} Ingest Endpoint`;
  }

  return key;
}

export function cloneConfigValues(values: ConfigValuesMap): ConfigValuesMap {
  const out: ConfigValuesMap = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

export function areConfigValuesEqual(
  a: ConfigValue | undefined,
  b: ConfigValue | undefined,
): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
  }
  return false;
}

export function diffConfigValues(
  baseline: ConfigValuesMap,
  draft: ConfigValuesMap,
): ConfigValuesMap {
  const changes: ConfigValuesMap = {};
  const keys = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
  for (const key of keys) {
    if (!(key in draft)) continue;
    if (!areConfigValuesEqual(baseline[key], draft[key])) {
      const value = draft[key];
      changes[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return changes;
}

export function getRestartRequiredKeys(
  keys: readonly string[],
  restartKeySet: ReadonlySet<string> = DEFAULT_RESTART_REQUIRED_KEYS,
): string[] {
  return keys.filter((key) => restartKeySet.has(key));
}

export function formatStringArrayInput(value: ConfigValue | undefined): string {
  if (!Array.isArray(value)) return "";
  return value.join(", ");
}

export function parseStringArrayInput(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of raw.split(",")) {
    const cleaned = token.trim().replace(/^\.+/, "").toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

export function validateConfigChanges(
  changes: ConfigValuesMap,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(changes)) {
    const spec = FIELD_SPEC_BY_KEY.get(key);
    if (!spec) continue;

    if (spec.kind === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        !Number.isInteger(value)
      ) {
        errors[key] = "Must be a whole number.";
        continue;
      }
      if (spec.min !== undefined && value < spec.min) {
        errors[key] = `Must be at least ${spec.min}.`;
        continue;
      }
      if (spec.max !== undefined && value > spec.max) {
        errors[key] = `Must be at most ${spec.max}.`;
        continue;
      }
    }

    if (spec.url && typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const normalized = spec.allowTokenPlaceholder
          ? trimmed.replace(/\{token\}/g, "placeholder")
          : trimmed;
        try {
          const parsed = new URL(normalized);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            errors[key] = "URL must start with http:// or https://.";
          }
        } catch {
          errors[key] = "Invalid URL format.";
        }
      }
    }

    if (spec.cron && typeof value === "string") {
      const parts = value.trim().split(/\s+/).filter(Boolean);
      if (parts.length !== 6) {
        errors[key] =
          'Expected 6 space-separated cron fields ("sec min hour day month dow").';
      }
    }
  }

  return errors;
}
