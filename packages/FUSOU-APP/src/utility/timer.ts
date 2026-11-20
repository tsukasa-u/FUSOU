import type { Accessor } from "solid-js";
import { createSignal, onCleanup } from "solid-js";
import type { MstMission } from "@ipc-bindings/get_data";

export type TimerDisplayMode = "both" | "remaining" | "complete_at";

export type TimerStatus =
  | "running"
  | "soon"
  | "complete"
  | "recalled"
  | "idle"
  | "locked";

export const TIMER_DISPLAY_MODE_STORAGE_KEY = "fusou-app-timer-display-mode";
export const TIMER_SOON_THRESHOLD_MS = 60_000;

export function normalizeTimerDisplayMode(
  value: string | null | undefined,
): TimerDisplayMode {
  if (value === "remaining" || value === "complete_at" || value === "both") {
    return value;
  }
  return "both";
}

export function nextTimerDisplayMode(mode: TimerDisplayMode): TimerDisplayMode {
  switch (mode) {
    case "both":
      return "remaining";
    case "remaining":
      return "complete_at";
    case "complete_at":
      return "both";
  }
}

export function timerDisplayModeLabel(mode: TimerDisplayMode): string {
  switch (mode) {
    case "both":
      return "Remain + Finish";
    case "remaining":
      return "Remaining";
    case "complete_at":
      return "Finish Time";
  }
}

function pad2(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

/**
 * Formats remaining milliseconds as `HH:MM:SS` (supports 100+ hours, clamps negative values to `00:00:00`).
 */
export function formatRemainingTime(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "00:00:00";
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function isSameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Formats a completion timestamp (epoch ms) in the OS system's local timezone.
 * Same calendar day -> `HH:MM:SS` (or `HH:MM` when `includeSeconds` is false).
 * Different calendar day -> `MM/DD HH:MM` (or `MM/DD HH:MM:SS` when `includeSeconds` is true).
 */
export function formatCompleteTime(
  completeTimeMs: number,
  nowMs: number,
  options?: { includeSeconds?: boolean },
): string {
  if (!Number.isFinite(completeTimeMs) || completeTimeMs <= 0) {
    return "—";
  }
  const target = new Date(completeTimeMs);
  const now = new Date(nowMs);
  const includeSeconds = options?.includeSeconds ?? true;
  const hhmm = `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
  const timePart = includeSeconds ? `${hhmm}:${pad2(target.getSeconds())}` : hhmm;

  if (isSameLocalCalendarDay(target, now)) {
    return timePart;
  }
  const datePart = `${pad2(target.getMonth() + 1)}/${pad2(target.getDate())}`;
  return `${datePart} ${timePart}`;
}

/**
 * Formats a completion timestamp (epoch ms) as `YYYY/MM/DD HH:MM:SS` in OS local timezone.
 */
export function formatCompleteDateTimeFull(completeTimeMs: number): string {
  if (!Number.isFinite(completeTimeMs) || completeTimeMs <= 0) {
    return "—";
  }
  const target = new Date(completeTimeMs);
  return `${target.getFullYear()}/${pad2(target.getMonth() + 1)}/${pad2(target.getDate())} ${pad2(target.getHours())}:${pad2(target.getMinutes())}:${pad2(target.getSeconds())}`;
}

export function resolveTimerStatus(
  completeTimeMs: number | null | undefined,
  nowMs: number,
  options?: {
    forcedStatus?: TimerStatus;
    soonThresholdMs?: number;
  },
): TimerStatus {
  const forced = options?.forcedStatus;
  if (forced === "idle" || forced === "locked" || forced === "complete") {
    return forced;
  }
  if (!completeTimeMs || !Number.isFinite(completeTimeMs) || completeTimeMs <= 0) {
    return forced ?? "idle";
  }
  const remainingMs = completeTimeMs - nowMs;
  if (remainingMs <= 0) {
    return "complete";
  }
  if (forced === "recalled") {
    return "recalled";
  }
  const soonThreshold = options?.soonThresholdMs ?? TIMER_SOON_THRESHOLD_MS;
  if (remainingMs <= soonThreshold) {
    return "soon";
  }
  return "running";
}

export interface DeckMissionInfo {
  state: 1 | 2 | 3;
  missionId: number;
  completeTimeMs: number;
  dispNo: string;
  name: string;
  timerStatus?: TimerStatus;
}

/**
 * Parses KanColle `api_mission` tuple `[state, mission_id, complete_time_ms, _]`
 * and enriches it with master mission metadata (`disp_no`, `name`).
 */
export function parseDeckMission(
  mission: readonly number[] | null | undefined,
  mstMissions?: Readonly<Record<number, MstMission | undefined>>,
): DeckMissionInfo | null {
  if (!mission || mission.length < 3) {
    return null;
  }
  const state = mission[0] ?? 0;
  const missionId = mission[1] ?? 0;
  const completeTimeMs = mission[2] ?? 0;
  if (state !== 1 && state !== 2 && state !== 3) {
    return null;
  }
  if (missionId <= 0) {
    return null;
  }
  const master = mstMissions?.[missionId];
  const dispNo = master?.disp_no || `#${missionId}`;
  const name = master?.name || `Mission #${missionId}`;
  const timerStatus: TimerStatus | undefined =
    state === 2 ? "complete" : state === 3 ? "recalled" : undefined;

  return {
    state,
    missionId,
    completeTimeMs,
    dispNo,
    name,
    timerStatus,
  };
}

// --- Shared 1-second reactive clock ---

const [sharedNow, setSharedNow] = createSignal<number>(Date.now());
let sharedNowSubscribers = 0;
let sharedNowIntervalId: ReturnType<typeof setInterval> | null = null;

export function useSharedNow(): Accessor<number> {
  if (typeof window !== "undefined") {
    sharedNowSubscribers += 1;
    if (sharedNowIntervalId === null) {
      setSharedNow(Date.now());
      sharedNowIntervalId = setInterval(() => {
        setSharedNow(Date.now());
      }, 1000);
    }
    onCleanup(() => {
      sharedNowSubscribers = Math.max(0, sharedNowSubscribers - 1);
      if (sharedNowSubscribers === 0 && sharedNowIntervalId !== null) {
        clearInterval(sharedNowIntervalId);
        sharedNowIntervalId = null;
      }
    });
  }
  return sharedNow;
}

// --- Shared persisted display mode ---

function readStoredTimerDisplayMode(): TimerDisplayMode {
  if (typeof window === "undefined") {
    return "both";
  }
  try {
    return normalizeTimerDisplayMode(
      window.localStorage.getItem(TIMER_DISPLAY_MODE_STORAGE_KEY),
    );
  } catch {
    return "both";
  }
}

const [sharedDisplayMode, setSharedDisplayMode] = createSignal<TimerDisplayMode>(
  readStoredTimerDisplayMode(),
);

let storageListenerAttached = false;
function ensureStorageListener(): void {
  if (storageListenerAttached || typeof window === "undefined") {
    return;
  }
  storageListenerAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key === TIMER_DISPLAY_MODE_STORAGE_KEY) {
      setSharedDisplayMode(normalizeTimerDisplayMode(event.newValue));
    }
  });
}

export function setTimerDisplayMode(mode: TimerDisplayMode): void {
  setSharedDisplayMode(mode);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(TIMER_DISPLAY_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage write errors in restricted environments.
    }
  }
}

export function cycleTimerDisplayMode(): TimerDisplayMode {
  const next = nextTimerDisplayMode(sharedDisplayMode());
  setTimerDisplayMode(next);
  return next;
}

export function useTimerDisplayMode(): [
  Accessor<TimerDisplayMode>,
  () => void,
  (mode: TimerDisplayMode) => void,
] {
  ensureStorageListener();
  return [sharedDisplayMode, cycleTimerDisplayMode, setTimerDisplayMode];
}
