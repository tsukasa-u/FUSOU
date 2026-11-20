import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_FIELD_SPECS,
  DATA_SENDER_SPECS,
  DEFAULT_CONFIG_VALUES,
  DEFAULT_RESTART_REQUIRED_KEYS,
  diffConfigValues,
  formatStringArrayInput,
  getConfigKeyLabel,
  getRestartRequiredKeys,
  parseStringArrayInput,
  validateConfigChanges,
} from "./config_schema";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_PACKAGES_DIR = path.resolve(TEST_DIR, "../../../../");
const CONFIGS_TOML_PATH = path.join(REPO_PACKAGES_DIR, "configs/configs.toml");
const CONFIG_CMD_RS_PATH = path.join(
  REPO_PACKAGES_DIR,
  "FUSOU-APP/src-tauri/src/cmd/config_cmd.rs",
);

/**
 * Parses top-level and nested TOML leaf keys and detects `# Requires restart` annotations
 * from packages/configs/configs.toml.
 */
function parseTomlKeysAndRestartNotes(tomlContent: string): {
  keys: string[];
  restartAnnotatedKeys: string[];
} {
  const keys: string[] = [];
  const restartAnnotatedKeys: string[] = [];
  let currentSection = "";
  let pendingComments: string[] = [];

  for (const rawLine of tomlContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      pendingComments = [];
      continue;
    }
    if (line.startsWith("#")) {
      pendingComments.push(line);
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      pendingComments = [];
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (keyMatch) {
      const fullKey = currentSection
        ? `${currentSection}.${keyMatch[1]}`
        : keyMatch[1];
      const comments = pendingComments;
      pendingComments = [];

      if (
        fullKey === "version" ||
        fullKey.startsWith("app.connect_kc_server.server_list.")
      ) {
        continue;
      }

      keys.push(fullKey);
      if (comments.some((c) => /requires restart/i.test(c))) {
        restartAnnotatedKeys.push(fullKey);
      }
    }
  }

  return {
    keys: keys.sort(),
    restartAnnotatedKeys: restartAnnotatedKeys.sort(),
  };
}

function parseRustEditableSpecs(
  rustSource: string,
): Array<{ key: string; requiresRestart: boolean }> {
  const blockMatch = rustSource.match(
    /const EDITABLE_CONFIG_SPECS:\s*&\[ConfigKeySpec\]\s*=\s*&\[([\s\S]*?)\];/,
  );
  if (!blockMatch) {
    throw new Error("Could not locate EDITABLE_CONFIG_SPECS in config_cmd.rs");
  }

  const specs: Array<{ key: string; requiresRestart: boolean }> = [];
  const entryRegex =
    /ConfigKeySpec\s*\{\s*key:\s*"([^"]+)",\s*requires_restart:\s*(true|false),?\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(blockMatch[1])) !== null) {
    specs.push({
      key: match[1],
      requiresRestart: match[2] === "true",
    });
  }
  return specs;
}

describe("config_schema", () => {
  it("has default values for every declared field and data sender key", () => {
    for (const field of ALL_FIELD_SPECS) {
      expect(field.key in DEFAULT_CONFIG_VALUES).toBe(true);
    }
    for (const sender of DATA_SENDER_SPECS) {
      expect(sender.enableKey in DEFAULT_CONFIG_VALUES).toBe(true);
      expect(sender.localKey in DEFAULT_CONFIG_VALUES).toBe(true);
      expect(sender.endpointKey in DEFAULT_CONFIG_VALUES).toBe(true);
    }
  });

  it("exhaustively covers configs.toml with zero exceptions and matches Rust & TOML restart notes 1:1", () => {
    const { keys: tomlKeys, restartAnnotatedKeys } =
      parseTomlKeysAndRestartNotes(fs.readFileSync(CONFIGS_TOML_PATH, "utf8"));
    const rustSource = fs.readFileSync(CONFIG_CMD_RS_PATH, "utf8");
    const rustSpecs = parseRustEditableSpecs(rustSource);

    // Every UI-editable key (fields + data sender upload/local toggles; sender endpoints live in ALL_FIELD_SPECS)
    const uiKeyList = [
      ...ALL_FIELD_SPECS.map((field) => field.key),
      ...DATA_SENDER_SPECS.flatMap((sender) => [
        sender.enableKey,
        sender.localKey,
      ]),
    ];
    const uiKeysUnique = Array.from(new Set(uiKeyList)).sort();
    expect(uiKeyList.length).toBe(uiKeysUnique.length);

    const rustEditableKeys = rustSpecs.map((spec) => spec.key).sort();
    const defaultValueKeys = Object.keys(DEFAULT_CONFIG_VALUES).sort();

    // 1. configs.toml == Frontend UI schema == Backend editable specs == Frontend defaults (zero exceptions)
    expect(uiKeysUnique).toEqual(tomlKeys);
    expect(rustEditableKeys).toEqual(tomlKeys);
    expect(defaultValueKeys).toEqual(tomlKeys);

    // 2. Restart classification matches across Frontend, Backend, AND configs.toml comments
    const rustRestartKeys = rustSpecs
      .filter((spec) => spec.requiresRestart)
      .map((spec) => spec.key)
      .sort();
    const uiRestartKeys = Array.from(DEFAULT_RESTART_REQUIRED_KEYS).sort();
    expect(uiRestartKeys).toEqual(rustRestartKeys);
    expect(restartAnnotatedKeys).toEqual(rustRestartKeys);
  });

  it("computes minimal diffs including array equality", () => {
    const baseline = {
      ...DEFAULT_CONFIG_VALUES,
      "app.asset_sync.asset_skip_extensions": ["mp3", "woff2", "js"],
    };
    const draft = {
      ...baseline,
      "app.theme.theme": "dark",
      "app.asset_sync.asset_skip_extensions": ["mp3", "woff2", "js"],
    };

    expect(diffConfigValues(baseline, draft)).toEqual({
      "app.theme.theme": "dark",
    });

    const draftWithArrayChange = {
      ...draft,
      "app.asset_sync.asset_skip_extensions": ["mp3", "ogg"],
    };
    expect(diffConfigValues(baseline, draftWithArrayChange)).toEqual({
      "app.theme.theme": "dark",
      "app.asset_sync.asset_skip_extensions": ["mp3", "ogg"],
    });
  });

  it("distinguishes immediate settings from restart-required settings", () => {
    expect(
      getRestartRequiredKeys(
        [
          "app.theme.theme",
          "app.font.font_family",
          "app.browser.external_screenshot_directory",
          "app.database.local.integration_batch_size",
          "app.asset_sync.retry.max_attempts",
        ],
        DEFAULT_RESTART_REQUIRED_KEYS,
      ),
    ).toEqual([]);

    expect(
      getRestartRequiredKeys(
        [
          "app.theme.theme",
          "app.database.allow_data_to_local",
          "proxy.allow_save_api_responses",
          "app.quest_tree_sender.enable",
        ],
        DEFAULT_RESTART_REQUIRED_KEYS,
      ),
    ).toEqual([
      "app.database.allow_data_to_local",
      "proxy.allow_save_api_responses",
      "app.quest_tree_sender.enable",
    ]);
  });

  it("parses and formats string array inputs cleanly", () => {
    expect(parseStringArrayInput(".MP3, woff2, , .js, mp3")).toEqual([
      "mp3",
      "woff2",
      "js",
    ]);
    expect(formatStringArrayInput(["mp3", "woff2", "js"])).toBe(
      "mp3, woff2, js",
    );
  });

  it("validates numeric bounds, URLs, and 6-field cron expressions", () => {
    expect(
      validateConfigChanges({
        "proxy.network.proxy_server_port": 70000,
        "app.database.local.integration_batch_size": 0,
        "app.browser.url": "ftp://invalid.example",
        "app.database.integration_schedule_cron": "0 0 * * *",
      }),
    ).toEqual({
      "proxy.network.proxy_server_port": "Must be at most 65535.",
      "app.database.local.integration_batch_size": "Must be at least 1.",
      "app.browser.url": "URL must start with http:// or https://.",
      "app.database.integration_schedule_cron":
        'Expected 6 space-separated cron fields ("sec min hour day month dow").',
    });

    expect(
      validateConfigChanges({
        "proxy.network.proxy_server_port": 8080,
        "app.database.local.integration_batch_size": 500,
        "app.browser.url":
          "http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/",
        "app.auth.anonymous_sync_v2_complete_endpoint":
          "https://fusou.dev/api/auth/anonymous-sync/v2/pending/{token}/complete",
        "app.database.integration_schedule_cron": "0 0 * * * *",
      }),
    ).toEqual({});
  });

  it("resolves human-readable labels for both field specs and data senders", () => {
    expect(getConfigKeyLabel("app.theme.theme")).toBe("Theme");
    expect(getConfigKeyLabel("app.quest_tree_sender.enable")).toBe(
      "Quest Tree (Remote Upload)",
    );
    expect(getConfigKeyLabel("app.remodel_sender.allow_data_to_local")).toBe(
      "Remodel Tree (Experimental) (Local JSONL)",
    );
  });
});
