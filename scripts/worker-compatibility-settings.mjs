import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";

function isValidCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

export function parseWorkerCompatibilitySettings(source, configName) {
  const document = parse(source);
  const date = document.compatibility_date;
  assert.equal(
    typeof date,
    "string",
    `${configName} must define a root compatibility_date string`,
  );
  assert.ok(
    isValidCalendarDate(date),
    `${configName} has an invalid compatibility_date calendar date`,
  );

  const flags = document.compatibility_flags;
  assert.ok(
    Array.isArray(flags),
    `${configName} must define a root compatibility_flags array`,
  );
  assert.ok(
    flags.every(
      (flag) =>
        typeof flag === "string" &&
        flag.length > 0 &&
        flag.trim() === flag,
    ),
    `${configName} compatibility_flags must contain non-empty strings without surrounding whitespace`,
  );
  assert.equal(
    new Set(flags).size,
    flags.length,
    `${configName} must not repeat compatibility_flags`,
  );
  return Object.freeze({
    date,
    flags: Object.freeze(flags),
  });
}

export function readWorkerCompatibilitySettings(configPath, configName) {
  return parseWorkerCompatibilitySettings(
    readFileSync(configPath, "utf8"),
    configName,
  );
}

export function assertWorkerCompatibilitySettingsMatch(
  expected,
  actual,
  description,
) {
  assert.equal(
    actual.date,
    expected.date,
    `${description}: compatibility_date mismatch`,
  );
  assert.deepEqual(
    actual.flags,
    expected.flags,
    `${description}: compatibility_flags mismatch`,
  );
}

export function assertMiniflareWorkerCompatibility(
  workerConfig,
  expected,
  workerName,
) {
  assert.equal(
    workerConfig.compatibilityDate,
    expected.date,
    `Miniflare compatibility_date mismatch for ${workerName}`,
  );
  assert.deepEqual(
    workerConfig.compatibilityFlags,
    expected.flags,
    `Miniflare compatibility_flags mismatch for ${workerName}`,
  );
}

export function verifyWorkerCompatibilitySettingsGuards() {
  const valid = parseWorkerCompatibilitySettings(
    'compatibility_date = "2026-11-13"\ncompatibility_flags = ["enable_request_signal"]\n',
    "valid fixture",
  );
  const noFlags = parseWorkerCompatibilitySettings(
    'compatibility_date = "2026-11-13"\ncompatibility_flags = []\n',
    "empty flags fixture",
  );
  const leapDay = parseWorkerCompatibilitySettings(
    'compatibility_date = "2024-02-29" # valid leap day\ncompatibility_flags = [\n  "nodejs_compat", # trailing comma is valid TOML\n]\n[env.production]\ncompatibility_date = "2023-02-28"\ncompatibility_flags = ["other_flag"]\n',
    "root and environment fixture",
  );
  assert.deepEqual(valid, {
    date: "2026-11-13",
    flags: ["enable_request_signal"],
  });
  assert.deepEqual(noFlags, { date: "2026-11-13", flags: [] });
  assert.deepEqual(leapDay, {
    date: "2024-02-29",
    flags: ["nodejs_compat"],
  });
  assert.throws(() =>
    parseWorkerCompatibilitySettings(
      'compatibility_flags = []\n',
      "missing date fixture",
    ),
  );
  assertWorkerCompatibilitySettingsMatch(valid, { ...valid }, "matching fixture");
  assert.throws(
    () =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\n',
        "missing flags fixture",
      ),
    /compatibility_flags/,
  );
  assert.throws(
    () =>
      parseWorkerCompatibilitySettings(
          'compatibility_date = "2026-99-99"\ncompatibility_flags = []\n',
          "invalid calendar date fixture",
      ),
      /invalid compatibility_date calendar date/,
  );
  for (const date of ["2026-04-31", "2026-13-01", "2023-02-29", "26-11-13"]) {
      assert.throws(
        () =>
          parseWorkerCompatibilitySettings(
            `compatibility_date = "${date}"\ncompatibility_flags = []\n`,
            `invalid calendar date ${date}`,
          ),
        /invalid compatibility_date calendar date/,
      );
  }
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\ncompatibility_flags = ["enable_request_signal" "nodejs_compat"]\n',
        "missing comma fixture",
      ),
  );
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\n compatibility_date = "2026-11-12"\ncompatibility_flags = []\n',
        "indented duplicate assignment fixture",
      ),
  );
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\ncompatibility_flags = ["enable_request_signal", "enable_request_signal"]\n',
        "duplicate flag fixture",
      ),
  );
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = 20261113\ncompatibility_flags = []\n',
        "non-string date fixture",
      ),
  );
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\ncompatibility_flags = "enable_request_signal"\n',
        "non-array flags fixture",
      ),
  );
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\ncompatibility_flags = ["enable_request_signal", 1]\n',
        "mixed-type flags fixture",
      ),
  );
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\ncompatibility_flags = [""]\n',
        "empty flag fixture",
      ),
  );
  assert.throws(() =>
      parseWorkerCompatibilitySettings(
        'compatibility_date = "2026-11-13"\ncompatibility_flags = [" "]\n',
        "whitespace flag fixture",
      ),
  );
  assert.throws(
      () =>
        assertWorkerCompatibilitySettingsMatch(
        valid,
        { date: "2026-11-12", flags: ["enable_request_signal"] },
        "date mismatch fixture",
      ),
    /compatibility_date mismatch/,
  );
  assert.throws(
    () =>
      assertWorkerCompatibilitySettingsMatch(
        valid,
        { date: "2026-11-13", flags: [] },
        "flags mismatch fixture",
      ),
    /compatibility_flags mismatch/,
  );
  console.log("PASS compatibility settings parser and mismatch guards");
}
