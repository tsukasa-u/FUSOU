/** @jsxImportSource solid-js */
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { EmptyState } from "@/components/common/solid/EmptyState";
import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type {
  BattleFleets,
  MstShipRecord,
  MstSlotItemRecord,
  TimelineEvent,
} from "@/features/battles/types";
import { PHASE_NAMES, AIR_STATE } from "@/features/battles/constants";
import {
  formatNullableNumber,
  normalizeNullableNumber,
  transitionState,
} from "@/features/battles/helpers";
import { buildTimelineEvents } from "@/features/battles/timeline";
import { jsonRecordOf } from "@/features/battles/payload-guards";
import { bannerUrl } from "@/features/simulator/equip-calc";
import {
  shipNameFromIndex,
  maxHpForShip,
  slotItemMeta,
  ShipBanner,
  WeaponIcon,
  HpDeltaBar,
} from "./ui";
import { SpriteMotionCounts, type SpriteMotionCountsLike } from "./sprite-motion-counts";

// ── Types ─────────────────────────────────────────────────────────────────

interface ResolvedActionRow {
  id: string;
  seq: number;
  phaseKey: string;
  phaseName: string;
  actorRole: "main" | "airbase" | "support" | "friendly_force";
  attackerSide: "friend" | "enemy";
  attackerIndices: number[];
  attackerMstShipId: number | null;
  defenderSide: "friend" | "enemy";
  defenderIdx: number | null;
  damage: number;
  crit: boolean;
  protect: boolean;
  sunk: boolean;
  beforeHp: number | null;
  afterHp: number | null;
  maxHp: number | null;
  afterState: string;
  slotIds: number[];
  attackTag: string;
}

interface SalvoTargetRow {
  defenderIdx: number | null;
  damage: number;
  crit: boolean;
  sunk: boolean;
  beforeHp: number | null;
  afterHp: number | null;
  maxHp: number | null;
  afterState: string;
}

interface SalvoBlock {
  id: string;
  waveTitle?: string;
  waveSprite?: SpriteMotionCountsLike | null;
  actorRole: "main" | "airbase" | "support" | "friendly_force";
  attackerSide: "friend" | "enemy";
  attackerIndices: number[];
  attackerMstShipIds: number[];
  attackerPlaneIds: number[];
  defenderSide: "friend" | "enemy";
  salvoLabel: string;
  totalDmg: number;
  targets: SalvoTargetRow[];
}

interface PhaseTactics {
  airSuperiority?: number | null;
  fTouchPlane?: number | null;
  eTouchPlane?: number | null;
  aaciShipIdx?: number | null;
  aaciUseItems?: number[];
  spriteCounts?: SpriteMotionCountsLike | null;
  nightTouch?: [number | null, number | null] | null;
  flarePos?: [number | null, number | null] | null;
  isFriendlyForceFlare?: boolean;
}

interface PhaseSection {
  id: string;
  key: string;
  title: string;
  tactics: PhaseTactics | null;
  salvos: SalvoBlock[];
  actions: ResolvedActionRow[];
  toEnemy: number;
  toFriend: number;
  sunkEnemy: number;
  showLegacyWarning: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────────

function isAirbaseInvolvedPhaseKey(key: string): boolean {
  return (
    key === "AirBaseAirAttack" ||
    key === "AirBaseAssult" ||
    key === "CarrierBaseAssault"
  );
}

function hasAirbasePhaseData(key: string, data: unknown): boolean {
  if (key === "AirBaseAirAttack") {
    return Array.isArray(data) && data.some((entry) => jsonRecordOf(entry));
  }
  return jsonRecordOf(data) !== null;
}

function hasOpeningAirActivity(data: unknown): boolean {
  const waves = Array.isArray(data)
    ? data.map((w) => jsonRecordOf(w)).filter((w): w is Record<string, unknown> => w !== null)
    : (() => {
        const rec = jsonRecordOf(data);
        return rec ? [rec] : [];
      })();
  if (waves.length === 0) return false;

  return waves.some((wave) => {
    const fPlaneFrom = Array.isArray(wave["f_plane_from"]) ? wave["f_plane_from"] : [];
    const ePlaneFrom = Array.isArray(wave["e_plane_from"]) ? wave["e_plane_from"] : [];
    const hasSortie =
      fPlaneFrom.some((v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0;
      }) ||
      ePlaneFrom.some((v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0;
      });
    if (hasSortie) return true;

    const fDam = Array.isArray(wave["f_damages"]) ? wave["f_damages"] : [];
    const eDam = Array.isArray(wave["e_damages"]) ? wave["e_damages"] : [];
    const hasDamage =
      fDam.some((v) => (Number(v ?? 0) || 0) > 0) ||
      eDam.some((v) => (Number(v ?? 0) || 0) > 0);
    if (hasDamage) return true;

    const fTouch = readNum(wave, "f_touch_plane");
    const eTouch = readNum(wave, "e_touch_plane");
    if ((fTouch !== null && fTouch > 0) || (eTouch !== null && eTouch > 0)) return true;

    const airFireObj = jsonRecordOf(wave["air_fire"]);
    const aaciIdx = readNum(wave, "airfire_idx") ?? readNum(airFireObj, "idx");
    if (aaciIdx !== null && aaciIdx >= 0) return true;

    const fFly = readNum(wave, "f_sprite_fly_count");
    const eFly = readNum(wave, "e_sprite_fly_count");
    if ((fFly !== null && fFly > 0) || (eFly !== null && eFly > 0)) return true;

    return false;
  });
}

function mstShipNameFromId(
  mstShipById: Map<number, MstShipRecord> | null | undefined,
  id: number | null | undefined,
): string | null {
  const n = Number(id ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = mstShipById?.get(n);
  const name = row?.name ?? "";
  return name.length > 0 ? name : null;
}

function shipBannerForIndex(
  side: "friend" | "enemy",
  idx: number,
  fleets: BattleFleets | null,
): string {
  const list = side === "friend" ? fleets?.friendlyShips : fleets?.enemyShips;
  const ship = Array.isArray(list) ? list[idx] : null;
  if (ship?.bannerUrl) return ship.bannerUrl;
  if (ship?.shipId && ship.shipId > 0) return bannerUrl(ship.shipId, { f: "auto" });
  return "";
}

function bannerForMstShipId(id: number | null | undefined): string {
  const n = Number(id ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return bannerUrl(n, { f: "auto" });
}

function toPositiveIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function readNum(source: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!source) return null;
  const direct = source[key];
  if (direct != null) {
    const n = Number(direct);
    return Number.isFinite(n) ? n : null;
  }
  const nested = jsonRecordOf(source["air_base_attack"])?.[key];
  if (nested != null) {
    const n = Number(nested);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readSpriteCounts(source: Record<string, unknown> | null | undefined): SpriteMotionCountsLike | null {
  if (!source) return null;
  const counts: SpriteMotionCountsLike = {
    f_sprite_fly_count: readNum(source, "f_sprite_fly_count"),
    e_sprite_fly_count: readNum(source, "e_sprite_fly_count"),
    f_sprite_crash_count: readNum(source, "f_sprite_crash_count"),
    e_sprite_crash_count: readNum(source, "e_sprite_crash_count"),
    f_sprite_damage_count: readNum(source, "f_sprite_damage_count"),
    e_sprite_damage_count: readNum(source, "e_sprite_damage_count"),
    f_sprite_non_normal_count: readNum(source, "f_sprite_non_normal_count"),
    e_sprite_non_normal_count: readNum(source, "e_sprite_non_normal_count"),
  };
  const hasAny = Object.values(counts).some((v) => v !== null && v !== undefined);
  return hasAny ? counts : null;
}

function pickHougekiRowsByRound(data: unknown, roundIdx: number | null): unknown {
  if (!Array.isArray(data)) return data;
  if (roundIdx == null) return data;
  const rows = data as Array<Record<string, unknown>>;
  const byIndex1 = rows.filter((row) => Number(row["index_1"] ?? Number.NaN) === roundIdx);
  if (byIndex1.length > 0) return byIndex1;
  return rows[roundIdx] ?? data;
}

function normalizeNightSupportAttackData(
  battle: Record<string, unknown>,
): Record<string, unknown> | null {
  const nested = jsonRecordOf(battle["night_support_attack"]);
  const hourai = jsonRecordOf(nested?.["hourai"] ?? battle["night_support_hourai"]);
  const airatack = jsonRecordOf(
    nested?.["airatack"] ??
      nested?.["airattack"] ??
      battle["night_support_airatack"] ??
      battle["night_support_airattack"],
  );
  if (!hourai && !airatack) return null;
  return { hourai, airatack };
}

function hasRaigekiActivity(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  const raiCandidates = [d["frai"], d["f_rai"], d["frai_list_items"], d["erai"], d["e_rai"], d["erai_list_items"]];
  const hasTarget = raiCandidates.some((candidate) => {
    if (!Array.isArray(candidate)) return false;
    return candidate.some((row) => {
      if (Array.isArray(row)) {
        return row.some((v) => {
          const n = Number(v);
          return Number.isFinite(n) && n >= 0;
        });
      }
      const n = Number(row);
      return Number.isFinite(n) && n >= 0;
    });
  });
  if (hasTarget) return true;
  const damages = [d["fdam"], d["f_dam"], d["edam"], d["e_dam"]];
  return damages.some(
    (arr) => Array.isArray(arr) && arr.some((v) => (Number(v ?? 0) || 0) > 0),
  );
}

function extractPhaseEntries(
  battle: Record<string, unknown>,
): Array<{ type: Record<string, unknown>; data: unknown }> {
  const entries: Array<{ type: Record<string, unknown>; data: unknown }> = [];

  const phaseDataForKey = (
    b: Record<string, unknown>,
    key: string,
    idx: number | null,
  ): unknown => {
    switch (key) {
      case "AirBaseAssult":
        return b["air_base_assault"];
      case "CarrierBaseAssault":
        return b["carrier_base_assault"];
      case "AirBaseAirAttack":
        return Array.isArray(b["air_base_air_attacks"])
          ? b["air_base_air_attacks"]
          : jsonRecordOf(b["air_base_air_attacks"])?.["attacks"];
      case "OpeningAirAttack":
        return Array.isArray(b["opening_air_attack"])
          ? (b["opening_air_attack"] as unknown[])[idx ?? 0]
          : b["opening_air_attack"];
      case "SupportAttack": {
        const nested = jsonRecordOf(b["support_attack"]);
        return {
          support_hourai: nested?.["support_hourai"] ?? b["support_hourai"],
          support_airatack:
            nested?.["support_airatack"] ??
            nested?.["support_airattack"] ??
            b["support_airattack"],
        };
      }
      case "OpeningTaisen":
        return b["opening_taisen"];
      case "OpeningRaigeki":
        return b["opening_raigeki"];
      case "Hougeki":
        return pickHougekiRowsByRound(b["hougeki"], idx);
      case "ClosingRaigeki":
        return b["closing_raigeki"];
      case "FriendlyForceAttack":
        return b["friendly_force_attack"];
      case "NightSupportAttack":
        return normalizeNightSupportAttackData(b);
      case "MidnightHougeki":
        return b["midnight_hougeki"];
      default:
        return null;
    }
  };

  if (
    Array.isArray(battle["battle_order"]) &&
    (battle["battle_order"] as unknown[]).length > 0 &&
    typeof (battle["battle_order"] as unknown[])[0] === "object"
  ) {
    const presentKeys = new Set<string>();
    for (const phaseType of battle["battle_order"] as Record<string, unknown>[]) {
      const key = Object.keys(phaseType)[0];
      if (key === undefined) continue;
      const idx = phaseType[key] as number | null;
      const data = phaseDataForKey(battle, key, idx);
      if (isAirbaseInvolvedPhaseKey(key) && !hasAirbasePhaseData(key, data)) {
        continue;
      }
      if (key === "OpeningAirAttack" && !hasOpeningAirActivity(data)) {
        continue;
      }
      // Deduplicate consecutive identical phase keys (e.g. AirBaseAirAttack wave 0 & 1, Hougeki round 0 & 1)
      // because buildTimelineEvents aggregates events by phaseName.
      if (presentKeys.has(key)) continue;
      presentKeys.add(key);
      entries.push({ type: phaseType, data });
    }
    if (!presentKeys.has("OpeningRaigeki") && hasRaigekiActivity(battle["opening_raigeki"])) {
      entries.push({ type: { OpeningRaigeki: 0 }, data: battle["opening_raigeki"] });
    }
    if (!presentKeys.has("ClosingRaigeki") && hasRaigekiActivity(battle["closing_raigeki"])) {
      entries.push({ type: { ClosingRaigeki: 0 }, data: battle["closing_raigeki"] });
    }
  } else {
    const airBaseAttacks = jsonRecordOf(battle["air_base_air_attacks"])?.["attacks"];
    const hasAirBaseAirAttacks =
      (Array.isArray(airBaseAttacks) && airBaseAttacks.length > 0) ||
      Array.isArray(battle["air_base_air_attacks"]);

    if (battle["air_base_assault"] && typeof battle["air_base_assault"] === "object")
      entries.push({ type: { AirBaseAssult: 0 }, data: battle["air_base_assault"] });
    if (battle["carrier_base_assault"] && typeof battle["carrier_base_assault"] === "object")
      entries.push({ type: { CarrierBaseAssault: 0 }, data: battle["carrier_base_assault"] });
    if (hasAirBaseAirAttacks)
      entries.push({ type: { AirBaseAirAttack: 0 }, data: phaseDataForKey(battle, "AirBaseAirAttack", 0) });
    if (
      hasOpeningAirActivity(battle["opening_air_attack"])
    )
      entries.push({ type: { OpeningAirAttack: 0 }, data: phaseDataForKey(battle, "OpeningAirAttack", 0) });
    if (battle["support_attack"] || battle["support_hourai"] || battle["support_airattack"])
      entries.push({ type: { SupportAttack: 0 }, data: phaseDataForKey(battle, "SupportAttack", null) });
    if (battle["opening_taisen"])
      entries.push({ type: { OpeningTaisen: 0 }, data: battle["opening_taisen"] });
    if (battle["opening_raigeki"] && typeof battle["opening_raigeki"] === "object")
      entries.push({ type: { OpeningRaigeki: 0 }, data: battle["opening_raigeki"] });
    if (
      battle["hougeki"] &&
      (Array.isArray(battle["hougeki"]) ||
        (jsonRecordOf(battle["hougeki"]) !== null &&
          Object.keys(jsonRecordOf(battle["hougeki"]) ?? {}).length > 0))
    )
      entries.push({ type: { Hougeki: 0 }, data: phaseDataForKey(battle, "Hougeki", 0) });
    if (battle["closing_raigeki"] && typeof battle["closing_raigeki"] === "object")
      entries.push({ type: { ClosingRaigeki: 0 }, data: battle["closing_raigeki"] });
    if (battle["friendly_force_attack"])
      entries.push({ type: { FriendlyForceAttack: 0 }, data: battle["friendly_force_attack"] });
    if (normalizeNightSupportAttackData(battle))
      entries.push({ type: { NightSupportAttack: 0 }, data: phaseDataForKey(battle, "NightSupportAttack", null) });
    if (battle["midnight_hougeki"])
      entries.push({ type: { MidnightHougeki: 0 }, data: battle["midnight_hougeki"] });
  }
  return entries;
}

function extractPhaseTactics(
  key: string,
  battle: Record<string, unknown>,
  phaseData: unknown,
): PhaseTactics | null {
  if (
    key === "OpeningAirAttack" ||
    key === "AirBaseAssult" ||
    key === "CarrierBaseAssault" ||
    key === "AirBaseAirAttack"
  ) {
    const firstWave = Array.isArray(phaseData)
      ? jsonRecordOf(phaseData[0])
      : jsonRecordOf(phaseData);
    if (!firstWave) return null;

    const airSup = readNum(firstWave, "air_superiority");
    const fTouch = readNum(firstWave, "f_touch_plane");
    const eTouch = readNum(firstWave, "e_touch_plane");
    const airFireObj = jsonRecordOf(firstWave["air_fire"]);
    const aaciIdx = readNum(firstWave, "airfire_idx") ?? readNum(airFireObj, "idx");
    const aaciItems = toPositiveIds(
      firstWave["airfire_use_item"] ?? airFireObj?.["use_item"],
    );
    const spriteCounts = key === "AirBaseAirAttack" ? null : readSpriteCounts(firstWave);

    const hasAny =
      (airSup !== null && AIR_STATE[airSup] !== undefined) ||
      (fTouch !== null && fTouch > 0) ||
      (eTouch !== null && eTouch > 0) ||
      (aaciIdx !== null && aaciIdx >= 0) ||
      spriteCounts !== null;

    if (!hasAny) return null;
    return {
      airSuperiority: airSup,
      fTouchPlane: fTouch,
      eTouchPlane: eTouch,
      aaciShipIdx: aaciIdx !== null && aaciIdx >= 0 ? aaciIdx : null,
      aaciUseItems: aaciItems,
      spriteCounts,
    };
  }

  if (key === "FriendlyForceAttack") {
    const ff = jsonRecordOf(battle["friendly_force_attack"]);
    const sh = jsonRecordOf(ff?.["support_hourai"]);
    const flare = Array.isArray(sh?.["flare_pos"]) ? sh["flare_pos"] : null;
    if (!flare) return null;
    const fp = normalizeNullableNumber(flare[0]);
    const ep = normalizeNullableNumber(flare[1]);
    if ((fp === null || fp < 0) && (ep === null || ep < 0)) return null;
    return { flarePos: [fp, ep], isFriendlyForceFlare: true };
  }

  if (key === "MidnightHougeki") {
    const touchRaw = Array.isArray(battle["midnight_touchplane"])
      ? battle["midnight_touchplane"]
      : null;
    const flareRaw = Array.isArray(battle["midnight_flare_pos"])
      ? battle["midnight_flare_pos"]
      : null;
    const fTouch = touchRaw ? normalizeNullableNumber(touchRaw[0]) : null;
    const eTouch = touchRaw ? normalizeNullableNumber(touchRaw[1]) : null;
    const fFlare = flareRaw ? normalizeNullableNumber(flareRaw[0]) : null;
    const eFlare = flareRaw ? normalizeNullableNumber(flareRaw[1]) : null;
    const hasTouch = (fTouch !== null && fTouch > 0) || (eTouch !== null && eTouch > 0);
    const hasFlare = (fFlare !== null && fFlare >= 0) || (eFlare !== null && eFlare >= 0);
    if (!hasTouch && !hasFlare) return null;
    return {
      nightTouch: hasTouch ? [fTouch, eTouch] : null,
      flarePos: hasFlare ? [fFlare, eFlare] : null,
      isFriendlyForceFlare: false,
    };
  }

  return null;
}

function destructionLostKindLabel(lostKind: number | null): string {
  switch (lostKind) {
    case 0:
      return "被害なし";
    case 1:
      return "半数喪失";
    case 2:
      return "1中隊喪失";
    case 3:
      return "2中隊喪失";
    case 4:
      return "3中隊喪失";
    case 5:
      return "全中隊喪失";
    default:
      return "不明";
  }
}

// ── UI Primitives (DESIGN.MD compliant, 96x24 ShipBanner, h-7 salvo rows) ─

function DenseShipCell(props: {
  name: string;
  bannerSrc: string;
  prefix: string;
  prefixTone: "info" | "error" | "success" | "warning";
  sunk?: boolean;
}): JSX.Element {
  const toneCls = () => {
    switch (props.prefixTone) {
      case "error":
        return "text-error";
      case "success":
        return "text-success";
      case "warning":
        return "text-warning";
      default:
        return "text-info";
    }
  };
  return (
    <div class="h-6 sm:h-7 flex items-center gap-1.5 sm:gap-2 min-w-0" title={`${props.prefix} ${props.name}`}>
      <div class="relative w-[72px] h-[18px] sm:w-24 sm:h-6 shrink-0 rounded overflow-hidden border border-base-300/75">
        <ShipBanner
          src={props.bannerSrc || undefined}
          alt={props.name}
          class={`w-[72px] h-[18px] sm:w-24 sm:h-6 rounded-none ${props.sunk ? "grayscale brightness-50" : ""}`}
        />
        <Show when={props.sunk}>
          <span class="absolute inset-0 flex items-center justify-center bg-black/45 text-[9px] font-bold tracking-widest text-white">
            撃沈
          </span>
        </Show>
      </div>
      <div class="hidden sm:flex min-w-0 items-center gap-1.5">
        <span class={`font-mono tabular-nums text-[10px] font-semibold w-5 shrink-0 ${toneCls()}`}>
          {props.prefix}
        </span>
        <span
          class={`hidden lg:inline text-xs font-medium truncate ${
            props.sunk ? "text-base-content/50" : "text-base-content"
          }`}
          title={props.name}
        >
          {props.name}
        </span>
      </div>
    </div>
  );
}

function DensePlaneRow(props: {
  slotId: number;
  index: number;
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
}): JSX.Element {
  const meta = createMemo(() => slotItemMeta(props.slotId, props.mstSlotItemById));
  return (
    <div class="h-6 sm:h-7 flex items-center gap-1.5 sm:gap-2 min-w-0" title={meta().name}>
      <span class="font-mono tabular-nums text-[10px] w-4 shrink-0 text-center text-base-content/50">
        {props.index + 1}
      </span>
      <WeaponIcon iconType={meta().iconType} />
      <span class="hidden lg:inline text-xs truncate text-base-content">
        {meta().name || `装備#${props.slotId}`}
      </span>
    </div>
  );
}

function FixedOutcomeCell(props: {
  damage: number;
  crit: boolean;
  protect: boolean;
  sunk: boolean;
  afterState: string;
}): JSX.Element {
  const tooltip = () => {
    const parts: string[] = [];
    parts.push(props.damage > 0 ? `-${props.damage}` : "MISS");
    if (props.crit) parts.push("クリティカル");
    if (props.sunk) parts.push("撃沈");
    else if (props.afterState) parts.push(props.afterState);
    if (props.protect) parts.push("かばう");
    return parts.join(" / ");
  };

  return (
    <div class="inline-flex items-center justify-end gap-1" title={tooltip()}>
      <Show
        when={props.damage > 0}
        fallback={
          <span class="font-mono text-[11px] w-11 text-right inline-block shrink-0 text-base-content/40">
            MISS
          </span>
        }
      >
        <span
          class={`font-mono tabular-nums text-xs w-11 text-right inline-block shrink-0 ${
            props.crit
              ? "text-error font-bold"
              : "text-base-content font-semibold"
          }`}
        >
          -{props.damage}
        </span>
      </Show>
      <Show when={props.protect}>
        <span class="inline-flex items-center justify-center h-4 px-1 rounded border border-warning/40 bg-warning/10 text-[10px] leading-none font-medium text-warning shrink-0">
          かばう
        </span>
      </Show>
    </div>
  );
}

function SingleLineEquipmentCell(props: {
  slotIds: number[];
  fallbackTag: string;
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
}): JSX.Element {
  const metas = createMemo(() =>
    props.slotIds
      .map((id) => slotItemMeta(id, props.mstSlotItemById))
      .filter((m) => m.name),
  );

  return (
    <Show
      when={metas().length > 0}
      fallback={
        <span class="text-[10px] md:text-[11px] text-base-content/55 truncate block">
          {props.fallbackTag}
        </span>
      }
    >
      <div
        class="inline-flex items-center gap-1 md:gap-1.5 h-5 max-w-full min-w-0"
        title={metas().map((m) => m.name).join(" / ")}
      >
        <span class="inline-flex items-center gap-0.5 shrink-0">
          <For each={metas()}>
            {(meta) => <WeaponIcon iconType={meta.iconType} />}
          </For>
        </span>
        <span class="hidden md:inline text-[11px] truncate text-base-content/80">
          {metas()[0]?.name}
        </span>
        <Show when={metas().length > 1}>
          <span class="hidden md:inline-flex font-mono tabular-nums text-[10px] px-1.5 h-4 items-center rounded border border-base-300 bg-base-200 text-base-content/75 shrink-0">
            +{metas().length - 1}
          </span>
        </Show>
      </div>
    </Show>
  );
}

function PhaseTacticalStrip(props: {
  tactics: PhaseTactics | null;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
}): JSX.Element | null {
  return (
    <Show when={props.tactics}>
      {(t) => {
        const airState = () =>
          t().airSuperiority != null ? AIR_STATE[t().airSuperiority!] : undefined;
        const fTouchMeta = () =>
          t().fTouchPlane && t().fTouchPlane! > 0
            ? slotItemMeta(t().fTouchPlane, props.mstSlotItemById)
            : null;
        const eTouchMeta = () =>
          t().eTouchPlane && t().eTouchPlane! > 0
            ? slotItemMeta(t().eTouchPlane, props.mstSlotItemById)
            : null;
        const hasTouch = () => fTouchMeta() !== null || eTouchMeta() !== null;

        const nightFTouch = () => {
          const id = t().nightTouch?.[0];
          return id && id > 0 ? slotItemMeta(id, props.mstSlotItemById) : null;
        };
        const nightETouch = () => {
          const id = t().nightTouch?.[1];
          return id && id > 0 ? slotItemMeta(id, props.mstSlotItemById) : null;
        };

        const aaciShipName = () =>
          t().aaciShipIdx != null
            ? shipNameFromIndex("friend", t().aaciShipIdx!, props.fleets)
            : "";
        const aaciShipBanner = () =>
          t().aaciShipIdx != null
            ? shipBannerForIndex("friend", t().aaciShipIdx!, props.fleets)
            : "";

        return (
          <div class="px-3.5 py-2 border-b border-base-300/75 bg-base-200/50 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <Show when={airState()}>
              {(as) => (
                <div class="inline-flex items-center gap-1.5">
                  <span class="text-base-content/55">制空:</span>
                  <span class={`font-semibold ${as().cls}`}>{as().label}</span>
                </div>
              )}
            </Show>

            <Show when={hasTouch()}>
              <div class="inline-flex items-center gap-1.5">
                <span class="text-base-content/55">触接:</span>
                <span class="inline-flex items-center gap-1 text-base-content">
                  <Show when={fTouchMeta()} fallback={<span class="text-base-content/40">なし</span>}>
                    {(m) => (
                      <>
                        <WeaponIcon iconType={m().iconType} />
                        <span>{m().name}</span>
                      </>
                    )}
                  </Show>
                </span>
                <span class="text-base-content/40">/</span>
                <span class="inline-flex items-center gap-1 text-base-content">
                  <Show when={eTouchMeta()} fallback={<span class="text-base-content/40">なし</span>}>
                    {(m) => (
                      <>
                        <WeaponIcon iconType={m().iconType} />
                        <span>{m().name}</span>
                      </>
                    )}
                  </Show>
                </span>
              </div>
            </Show>

            <Show when={t().aaciShipIdx != null}>
              <div class="inline-flex items-center gap-1.5 flex-wrap">
                <span class="text-base-content/55">対空CI:</span>
                <div class="w-24 h-6 shrink-0 rounded overflow-hidden border border-base-300/75">
                  <ShipBanner src={aaciShipBanner() || undefined} alt={aaciShipName()} class="w-24 h-6 rounded-none" />
                </div>
                <span class="font-medium text-base-content">{aaciShipName()}</span>
                <Show when={(t().aaciUseItems?.length ?? 0) > 0}>
                  <span class="inline-flex items-center gap-1 flex-wrap">
                    <For each={t().aaciUseItems}>
                      {(slotId) => {
                        const meta = createMemo(() => slotItemMeta(slotId, props.mstSlotItemById));
                        return (
                          <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-base-300/75 bg-base-100 text-[11px] leading-none text-base-content/80">
                            <WeaponIcon iconType={meta().iconType} />
                            <span>{meta().name || `装備#${slotId}`}</span>
                          </span>
                        );
                      }}
                    </For>
                  </span>
                </Show>
              </div>
            </Show>

            <Show when={t().nightTouch}>
              <div class="inline-flex items-center gap-1.5">
                <span class="text-base-content/55">夜間触接:</span>
                <span class="inline-flex items-center gap-1 text-base-content">
                  <Show when={nightFTouch()} fallback={<span class="text-base-content/40">なし</span>}>
                    {(m) => (
                      <>
                        <WeaponIcon iconType={m().iconType} />
                        <span>{m().name}</span>
                      </>
                    )}
                  </Show>
                </span>
                <span class="text-base-content/40">/</span>
                <span class="inline-flex items-center gap-1 text-base-content">
                  <Show when={nightETouch()} fallback={<span class="text-base-content/40">なし</span>}>
                    {(m) => (
                      <>
                        <WeaponIcon iconType={m().iconType} />
                        <span>{m().name}</span>
                      </>
                    )}
                  </Show>
                </span>
              </div>
            </Show>

            <Show when={t().flarePos}>
              {(fp) => {
                const fIdx = () => fp()[0];
                const eIdx = () => fp()[1];
                return (
                  <div class="inline-flex items-center gap-1.5">
                    <span class="text-base-content/55">照明弾:</span>
                    <Show
                      when={fIdx() !== null && fIdx()! >= 0}
                      fallback={<span class="text-base-content/40">なし</span>}
                    >
                      <span class="inline-flex items-center gap-1.5">
                        <div class="w-24 h-6 shrink-0 rounded overflow-hidden border border-base-300/75">
                          <ShipBanner
                            src={shipBannerForIndex("friend", fIdx()!, props.fleets) || undefined}
                            alt={shipNameFromIndex("friend", fIdx()!, props.fleets)}
                            class="w-24 h-6 rounded-none"
                          />
                        </div>
                        <span class="font-medium text-base-content">
                          {shipNameFromIndex("friend", fIdx()!, props.fleets)}
                        </span>
                      </span>
                    </Show>
                    <span class="text-base-content/40">/</span>
                    <Show
                      when={eIdx() !== null && eIdx()! >= 0}
                      fallback={<span class="text-base-content/40">なし</span>}
                    >
                      <span class="inline-flex items-center gap-1.5">
                        <div class="w-24 h-6 shrink-0 rounded overflow-hidden border border-base-300/75">
                          <ShipBanner
                            src={shipBannerForIndex("enemy", eIdx()!, props.fleets) || undefined}
                            alt={shipNameFromIndex("enemy", eIdx()!, props.fleets)}
                            class="w-24 h-6 rounded-none"
                          />
                        </div>
                        <span class="font-medium text-base-content">
                          {shipNameFromIndex("enemy", eIdx()!, props.fleets)}
                        </span>
                      </span>
                    </Show>
                  </div>
                );
              }}
            </Show>

            <Show when={t().spriteCounts}>
              {(sc) => (
                <div class="text-[11px] text-base-content/75">
                  <SpriteMotionCounts counts={sc()} />
                </div>
              )}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

// ── Build Phase Sections from Battle & TimelineEvents ─────────────────────

function buildSalvosForAirPhase(
  key: string,
  events: TimelineEvent[],
  phaseData: unknown,
  fleets: BattleFleets | null,
): SalvoBlock[] {
  const wavesData = Array.isArray(phaseData)
    ? phaseData.map((w) => jsonRecordOf(w))
    : [jsonRecordOf(phaseData)];

  const batchMap = new Map<number, TimelineEvent[]>();
  let fallbackId = -1;
  for (const ev of events) {
    if (ev.type !== "air" || ev.separator === true) continue;
    const id = Number.isFinite(Number(ev.airBatchId))
      ? Number(ev.airBatchId)
      : fallbackId--;
    const rows = batchMap.get(id) ?? [];
    rows.push(ev);
    batchMap.set(id, rows);
  }
  const batches = [...batchMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, rows]) => rows);

  const salvos: SalvoBlock[] = [];

  batches.forEach((batch, waveIdx) => {
    const first = batch[0];
    if (!first) return;
    const fState = Array.isArray(first.fHps)
      ? first.fHps.map((v) => normalizeNullableNumber(v))
      : [];
    const eState = Array.isArray(first.eHps)
      ? first.eHps.map((v) => normalizeNullableNumber(v))
      : [];

    const resolved = batch.map((ev) => {
      if (ev.defenderIdx === null) return { ev, beforeHp: null, afterHp: null };
      const pool = ev.defenderSide === "friend" ? fState : eState;
      const beforeHp = pool[ev.defenderIdx] ?? null;
      const afterHp =
        beforeHp === null ? null : Math.max(0, beforeHp - Math.max(0, ev.damage));
      if (afterHp !== null) pool[ev.defenderIdx] = afterHp;
      return { ev, beforeHp, afterHp };
    });

    const waveRec = wavesData[waveIdx] ?? null;
    const waveSprite = key === "AirBaseAirAttack" ? readSpriteCounts(waveRec) : null;
    const waveLabelPrefix = (() => {
      if (key === "AirBaseAirAttack") {
        if (first.airbaseBaseNo) return `第${first.airbaseBaseNo}基地航空隊 第${waveIdx + 1}波`;
        return `基地航空隊 第${waveIdx + 1}波`;
      }
      return batches.length > 1 ? `第${waveIdx + 1}波` : undefined;
    })();

    for (const side of ["friend", "enemy"] as const) {
      const sideRows = resolved.filter((r) => r.ev.attackerSide === side);
      if (sideRows.length === 0) continue;
      const sample = sideRows[0]!.ev;
      const group = Array.isArray(sample.attackerGroup)
        ? sample.attackerGroup.filter((v) => Number.isFinite(Number(v)) && Number(v) >= 0)
        : [];
      const planeIds = toPositiveIds(sample.slotItems);
      const targets: SalvoTargetRow[] = sideRows
        .filter((r) => r.ev.defenderIdx !== null && r.beforeHp !== null && r.afterHp !== null)
        .map((r) => {
          const defIdx = r.ev.defenderIdx as number;
          const mHp = maxHpForShip(r.ev.defenderSide, defIdx, r.beforeHp, fleets);
          const tr = transitionState(r.beforeHp, r.afterHp, mHp);
          return {
            defenderIdx: defIdx,
            damage: r.ev.damage,
            crit: r.ev.crit,
            sunk: r.ev.sunk || tr.sunk,
            beforeHp: r.beforeHp,
            afterHp: r.afterHp,
            maxHp: mHp,
            afterState: tr.afterState,
          };
        });

      const salvoLabel =
        key === "AirBaseAssult"
          ? "基地噴式強襲"
          : key === "CarrierBaseAssault"
            ? "空母噴式強襲"
            : key === "AirBaseAirAttack"
              ? "基地航空攻撃"
              : side === "friend"
                ? "味方航空攻撃"
                : "敵航空攻撃";

      salvos.push({
        id: `${key}-${waveIdx}-${side}`,
        ...(waveLabelPrefix !== undefined && side === "friend" ? { waveTitle: waveLabelPrefix } : {}),
        ...(waveSprite && side === "friend" ? { waveSprite } : {}),
        actorRole: sample.actorRole ?? (isAirbaseInvolvedPhaseKey(key) ? "airbase" : "main"),
        attackerSide: side,
        attackerIndices: group,
        attackerMstShipIds: sample.attackerMstShipId ? [sample.attackerMstShipId] : [],
        attackerPlaneIds: planeIds,
        defenderSide: side === "friend" ? "enemy" : "friend",
        salvoLabel,
        totalDmg: targets.reduce((s, t) => s + t.damage, 0),
        targets,
      });
    }
  });

  return salvos;
}

function buildSalvoForSupportPhase(
  key: string,
  events: TimelineEvent[],
  fleets: BattleFleets | null,
): SalvoBlock[] {
  const valid = events.filter((ev) => ev.separator !== true);
  if (valid.length === 0) return [];
  const first = valid[0]!;
  const eState = Array.isArray(first.eHps)
    ? first.eHps.map((v) => normalizeNullableNumber(v))
    : [];

  const shipIds: number[] = [];
  const targets: SalvoTargetRow[] = [];

  for (const ev of valid) {
    if (ev.attackerMstShipId && !shipIds.includes(ev.attackerMstShipId)) {
      shipIds.push(ev.attackerMstShipId);
    }
    if (ev.defenderIdx === null) continue;
    const beforeHp = eState[ev.defenderIdx] ?? null;
    const afterHp =
      beforeHp === null ? null : Math.max(0, beforeHp - Math.max(0, ev.damage));
    if (afterHp !== null) eState[ev.defenderIdx] = afterHp;
    const mHp = maxHpForShip("enemy", ev.defenderIdx, beforeHp, fleets);
    const tr = transitionState(beforeHp, afterHp, mHp);
    targets.push({
      defenderIdx: ev.defenderIdx,
      damage: ev.damage,
      crit: ev.crit,
      sunk: ev.sunk || tr.sunk,
      beforeHp,
      afterHp,
      maxHp: mHp,
      afterState: tr.afterState,
    });
  }

  return [
    {
      id: `${key}-salvo`,
      actorRole: "support",
      attackerSide: "friend",
      attackerIndices: [],
      attackerMstShipIds: shipIds,
      attackerPlaneIds: [],
      defenderSide: "enemy",
      salvoLabel: key === "NightSupportAttack" ? "夜間支援砲撃" : "砲撃支援",
      totalDmg: targets.reduce((s, t) => s + t.damage, 0),
      targets,
    },
  ];
}

// ── Exported Component (Variant 3: Unified Dense Matrix + Phase Tabs + Inline Drawer) ─

export default function BattlePhaseView(props: {
  battle: Record<string, unknown>;
  fleets: BattleFleets | null;
  mstSlotItemById: Map<number, MstSlotItemRecord> | null;
  mstShipById: Map<number, MstShipRecord> | null;
  showLegacyAirbasePhaseWarning?: boolean;
}): JSX.Element {
  const [selectedPhaseKey, setSelectedPhaseKey] = createSignal<string>("ALL");
  const [expandedRowId, setExpandedRowId] = createSignal<string | null>(null);

  const timelineEvents = createMemo(() =>
    buildTimelineEvents(props.battle, props.fleets),
  );

  const destructionBattle = createMemo(
    () => jsonRecordOf(props.battle["destruction_battle"]),
  );

  const phaseSections = createMemo<PhaseSection[]>(() => {
    const entries = extractPhaseEntries(props.battle);
    const allEvs = timelineEvents();
    let seq = 0;

    return entries.map((entry, entryIdx) => {
      const key = Object.keys(entry.type)[0] ?? "";
      const title = PHASE_NAMES[key] ?? key;
      const phaseEvs = allEvs.filter(
        (ev) => ev.phase === title && ev.separator !== true,
      );
      const tactics = extractPhaseTactics(key, props.battle, entry.data);

      let salvos: SalvoBlock[] = [];
      let actions: ResolvedActionRow[] = [];

      if (
        key === "OpeningAirAttack" ||
        key === "AirBaseAirAttack" ||
        key === "AirBaseAssult" ||
        key === "CarrierBaseAssault"
      ) {
        salvos = buildSalvosForAirPhase(key, phaseEvs, entry.data, props.fleets);
      } else if (key === "SupportAttack" || key === "NightSupportAttack") {
        salvos = buildSalvoForSupportPhase(key, phaseEvs, props.fleets);
      } else {
        const first = phaseEvs[0];
        const fState = Array.isArray(first?.fHps)
          ? first!.fHps.map((v) => normalizeNullableNumber(v))
          : [];
        const eState = Array.isArray(first?.eHps)
          ? first!.eHps.map((v) => normalizeNullableNumber(v))
          : [];

        actions = phaseEvs.map((ev) => {
          const defPool = ev.defenderSide === "friend" ? fState : eState;
          const beforeHp =
            ev.defenderIdx !== null ? (defPool[ev.defenderIdx] ?? null) : null;
          const afterHp =
            beforeHp === null ? null : Math.max(0, beforeHp - Math.max(0, ev.damage));
          if (ev.defenderIdx !== null && afterHp !== null) {
            defPool[ev.defenderIdx] = afterHp;
          }
          const mHp =
            ev.defenderIdx !== null
              ? maxHpForShip(ev.defenderSide, ev.defenderIdx, beforeHp, props.fleets)
              : null;
          const tr =
            beforeHp !== null && afterHp !== null
              ? transitionState(beforeHp, afterHp, mHp)
              : { sunk: false, afterState: "" };
          const group = Array.isArray(ev.attackerGroup)
            ? ev.attackerGroup.filter((v) => Number.isFinite(Number(v)) && Number(v) >= 0)
            : [];
          const attackerIndices =
            ev.attackerIdx !== null ? [ev.attackerIdx] : group;
          const slotIds = toPositiveIds(ev.slotItems);
          const attackTag =
            key === "OpeningTaisen"
              ? "先制対潜"
              : key === "OpeningRaigeki"
                ? "先制雷撃"
                : key === "ClosingRaigeki"
                  ? attackerIndices.length > 1
                    ? `集中雷撃 (${attackerIndices.length}隻)`
                    : "雷撃"
                  : key === "FriendlyForceAttack"
                    ? "友軍攻撃"
                    : key === "MidnightHougeki"
                      ? "夜戦攻撃"
                      : "砲撃";

          return {
            id: `${key}-${++seq}`,
            seq,
            phaseKey: key,
            phaseName: title,
            actorRole: ev.actorRole ?? "main",
            attackerSide: ev.attackerSide,
            attackerIndices,
            attackerMstShipId: ev.attackerMstShipId ?? null,
            defenderSide: ev.defenderSide,
            defenderIdx: ev.defenderIdx,
            damage: ev.damage,
            crit: ev.crit,
            // Single-ship shelling only; salvo / torpedo / air attacks never show cover.
            protect: false,
            sunk: ev.sunk || tr.sunk,
            beforeHp,
            afterHp,
            maxHp: mHp,
            afterState: tr.afterState,
            slotIds,
            attackTag,
          };
        });
      }

      let toEnemy = actions
        .filter((a) => a.defenderSide === "enemy")
        .reduce((s, a) => s + a.damage, 0);
      let toFriend = actions
        .filter((a) => a.defenderSide === "friend")
        .reduce((s, a) => s + a.damage, 0);
      let sunkEnemy = actions.filter((a) => a.defenderSide === "enemy" && a.sunk).length;

      for (const sv of salvos) {
        if (sv.defenderSide === "enemy") {
          toEnemy += sv.totalDmg;
          sunkEnemy += sv.targets.filter((t) => t.sunk).length;
        } else {
          toFriend += sv.totalDmg;
        }
      }

      return {
        id: `${key}-${entryIdx}`,
        key,
        title,
        tactics,
        salvos,
        actions,
        toEnemy,
        toFriend,
        sunkEnemy,
        showLegacyWarning:
          !!props.showLegacyAirbasePhaseWarning && isAirbaseInvolvedPhaseKey(key),
      };
    });
  });

  const visibleSections = createMemo(() => {
    const sel = selectedPhaseKey();
    if (sel === "ALL") return phaseSections();
    return phaseSections().filter((s) => s.key === sel);
  });

  const isReconOrPeaceCell = createMemo(
    () =>
      phaseSections().length === 0 &&
      !destructionBattle() &&
      (!props.fleets?.enemyShips || props.fleets.enemyShips.length === 0),
  );

  const renderSalvoAttackers = (salvo: SalvoBlock): JSX.Element => {
    if (salvo.attackerPlaneIds.length > 0) {
      return (
        <div class="flex flex-col gap-1">
          <For each={salvo.attackerPlaneIds}>
            {(slotId, idx) => (
              <DensePlaneRow
                slotId={slotId}
                index={idx()}
                mstSlotItemById={props.mstSlotItemById}
              />
            )}
          </For>
        </div>
      );
    }
    if (salvo.attackerIndices.length > 0) {
      return (
        <div class="flex flex-col gap-1">
          <For each={salvo.attackerIndices}>
            {(shipIdx) => (
              <DenseShipCell
                name={shipNameFromIndex(salvo.attackerSide, shipIdx, props.fleets)}
                bannerSrc={shipBannerForIndex(salvo.attackerSide, shipIdx, props.fleets)}
                prefix={salvo.attackerSide === "friend" ? `F${shipIdx + 1}` : `E${shipIdx + 1}`}
                prefixTone={salvo.attackerSide === "friend" ? "info" : "error"}
              />
            )}
          </For>
        </div>
      );
    }
    if (salvo.attackerMstShipIds.length > 0) {
      return (
        <div class="flex flex-col gap-1">
          <For each={salvo.attackerMstShipIds}>
            {(mstId, idx) => {
              const name =
                mstShipNameFromId(props.mstShipById, mstId) ?? `艦ID:${mstId}`;
              return (
                <DenseShipCell
                  name={name}
                  bannerSrc={bannerForMstShipId(mstId)}
                  prefix={salvo.actorRole === "support" ? `支${idx() + 1}` : `友${idx() + 1}`}
                  prefixTone={salvo.actorRole === "support" ? "warning" : "success"}
                />
              );
            }}
          </For>
        </div>
      );
    }
    return <span class="text-xs text-base-content/55">{salvo.salvoLabel}</span>;
  };

  return (
    <Show
      when={phaseSections().length > 0 || !!destructionBattle()}
      fallback={
        <Show
          when={isReconOrPeaceCell()}
          fallback={<EmptyState message="戦闘フェーズ情報がありません" size="compact" />}
        >
          <div class="rounded-xl border border-base-300/75 bg-base-200/40 p-6 text-center">
            <div class="badge badge-outline badge-info mb-2 text-xs">航空偵察 / 非戦闘マス</div>
            <p class="text-sm font-medium text-base-content/80">
              このマスは航空偵察または非戦闘セルのため、砲撃戦・雷撃戦などの戦闘フェーズは発生していません。
            </p>
            <p class="mt-1 text-xs text-base-content/60">
              味方艦隊の編成および装備状態は上記に表示されています。他の戦闘マスを確認する場合は、上部の戦目タブを切り替えてください。
            </p>
          </div>
        </Show>
      }
    >
      <div class="space-y-3">
        {/* Destruction Battle (基地空襲) */}
        <Show when={destructionBattle()}>
          {(db) => {
            const airSup = () => readNum(db(), "air_superiority") ?? -1;
            const lostKind = () => readNum(db(), "lost_kind");
            const spriteCounts = () => readSpriteCounts(db());
            return (
              <div class="rounded-xl border border-base-300/75 bg-base-100 overflow-hidden">
                <div class="px-3.5 py-2 border-b border-base-300/75 bg-base-200/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span class="font-semibold">基地空襲</span>
                  <div class="flex flex-wrap items-center gap-3">
                    <Show when={AIR_STATE[airSup()]}>
                      {(as) => (
                        <span>
                          <span class="text-base-content/55 mr-1">制空:</span>
                          <span class={`font-semibold ${as().cls}`}>{as().label}</span>
                        </span>
                      )}
                    </Show>
                    <span>
                      <span class="text-base-content/55 mr-1">被害:</span>
                      <span>{destructionLostKindLabel(lostKind())}</span>
                    </span>
                  </div>
                </div>
                <Show when={spriteCounts()}>
                  {(sc) => (
                    <div class="px-3.5 py-2 text-xs text-base-content/80">
                      <SpriteMotionCounts counts={sc()} />
                    </div>
                  )}
                </Show>
              </div>
            );
          }}
        </Show>

        {/* Unified Dense Matrix Card (Variant 3) */}
        <Show when={phaseSections().length > 0}>
          <div class="rounded-xl border border-base-300/75 bg-base-100 overflow-hidden">
            {/* Phase Filter Tab Strip */}
            <div class="px-3 py-2 border-b border-base-300/75 bg-base-200/50 flex items-center gap-1 overflow-x-auto">
              <button
                type="button"
                class={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5 ${
                  selectedPhaseKey() === "ALL"
                    ? "bg-base-100 border-base-300 text-base-content"
                    : "bg-transparent border-transparent text-base-content/60 hover:text-base-content"
                }`}
                onClick={() => setSelectedPhaseKey("ALL")}
              >
                <span>全フェーズ</span>
                <span class="font-mono tabular-nums text-[10px] text-base-content/50">
                  {phaseSections().length}
                </span>
              </button>
              <For each={phaseSections()}>
                {(sec) => {
                  const count = () => sec.actions.length + sec.salvos.length;
                  const active = () => selectedPhaseKey() === sec.key;
                  return (
                    <button
                      type="button"
                      class={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer inline-flex items-center gap-1.5 ${
                        active()
                          ? "bg-base-100 border-base-300 text-base-content"
                          : "bg-transparent border-transparent text-base-content/60 hover:text-base-content"
                      }`}
                      onClick={() => setSelectedPhaseKey(sec.key)}
                    >
                      <span>{sec.title}</span>
                      <span class="font-mono tabular-nums text-[10px] text-base-content/50">
                        {count()}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>

            {/* Unified 7-Column Matrix Table (responsive: zero horizontal scroll on mobile) */}
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="text-[11px] font-medium border-b border-base-300/75 bg-base-200/40 text-base-content/55">
                    <th class="hidden md:table-cell py-1.5 pl-3 pr-2 w-14">#</th>
                    <th class="py-1.5 pl-2 pr-1 md:px-2 w-[80px] sm:w-[132px] lg:w-[235px]">攻撃側</th>
                    <th class="py-1.5 px-1 md:px-2">
                      <span class="md:hidden">装備</span>
                      <span class="hidden md:inline">装備 / 種別</span>
                    </th>
                    <th class="py-1.5 px-0.5 md:px-1 w-4 md:w-6" />
                    <th class="py-1.5 px-1 md:px-2 w-[80px] sm:w-[132px] lg:w-[235px]">防御側</th>
                    <th class="py-1.5 px-1 md:px-2 w-[76px] md:w-[176px]">
                      <span class="md:hidden">残HP</span>
                      <span class="hidden md:inline">残HP推移</span>
                    </th>
                    <th class="py-1.5 pl-1 pr-2 md:pl-2 md:pr-3 w-[52px] md:w-[72px] text-right">
                      <span class="md:hidden">ダメ</span>
                      <span class="hidden md:inline">ダメージ</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={visibleSections()}>
                    {(sec) => (
                      <>
                        {/* Phase Divider Band */}
                        <tr class="bg-base-200/70 border-t border-base-300/75">
                          <td colspan={7} class="py-1.5 px-3">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <span class="text-xs font-semibold text-base-content">
                                {sec.title}
                              </span>
                              <div class="inline-grid grid-cols-[4.5rem_4.5rem_3.75rem] items-center gap-2 font-mono tabular-nums text-[11px] text-right">
                                <span class="text-info">与:{sec.toEnemy}</span>
                                <span
                                  class={
                                    sec.toFriend > 0
                                      ? "text-error"
                                      : "text-base-content/45"
                                  }
                                >
                                  被:{sec.toFriend}
                                </span>
                                <span
                                  class={
                                    sec.sunkEnemy > 0
                                      ? "text-success"
                                      : "text-base-content/35"
                                  }
                                >
                                  {sec.sunkEnemy > 0 ? `撃沈:${sec.sunkEnemy}` : ""}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>

                        {/* Legacy Airbase Warning */}
                        <Show when={sec.showLegacyWarning}>
                          <tr>
                            <td colspan={7} class="px-3 py-2 bg-base-100">
                              <AlertMessage type="warning">
                                この基地航空隊フェーズは table_version 0.6.0 未満の既知不具合により、参照解決結果が正確でない可能性があります。
                              </AlertMessage>
                            </td>
                          </tr>
                        </Show>

                        {/* Phase Tactical Strip (AirState / Touch / AACI / Flare / SpriteMotionCounts) */}
                        <Show when={sec.tactics}>
                          <tr>
                            <td colspan={7} class="p-0">
                              <PhaseTacticalStrip
                                tactics={sec.tactics}
                                fleets={props.fleets}
                                mstSlotItemById={props.mstSlotItemById}
                              />
                            </td>
                          </tr>
                        </Show>

                        {/* Coordinated Salvo Rows (Support, Night Support, Air Attacks, Jet Assaults) */}
                        <For each={sec.salvos}>
                          {(salvo) => (
                            <>
                              <Show when={salvo.waveTitle || salvo.waveSprite}>
                                <tr class="bg-base-200/35 border-t border-base-300/60">
                                  <td colspan={7} class="py-1 px-3">
                                    <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                      <span class="font-medium text-base-content/75">
                                        {salvo.waveTitle ?? ""}
                                      </span>
                                      <Show when={salvo.waveSprite}>
                                        {(sc) => (
                                          <span class="text-base-content/70">
                                            <SpriteMotionCounts counts={sc()} />
                                          </span>
                                        )}
                                      </Show>
                                    </div>
                                  </td>
                                </tr>
                              </Show>
                              <tr
                                class={`border-t border-base-300/60 ${
                                  salvo.attackerSide === "enemy" ? "bg-error/5" : ""
                                }`}
                              >
                                <td class="hidden md:table-cell py-2 pl-3 pr-2 font-mono text-[11px] whitespace-nowrap align-middle text-base-content/45">
                                  一斉
                                </td>
                                <td class="py-1.5 md:py-2 pl-2 pr-1 md:px-2 align-middle">
                                  {renderSalvoAttackers(salvo)}
                                </td>
                                <td class="py-1.5 md:py-2 px-1 md:px-2 align-middle">
                                  <div class="text-[10px] md:text-xs leading-tight text-base-content/80">
                                    {salvo.salvoLabel}
                                  </div>
                                  <div class="hidden md:block font-mono tabular-nums text-[10px] mt-0.5 text-base-content/50">
                                    {salvo.targets.length}隻対象 / 計 -{salvo.totalDmg}
                                  </div>
                                </td>
                                <td class="py-1.5 md:py-2 px-0.5 md:px-1 text-center font-mono text-[10px] md:text-xs align-middle text-base-content/45">
                                  →
                                </td>
                                <td class="py-1.5 md:py-2 px-1 md:px-2 align-middle">
                                  <Show
                                    when={salvo.targets.length > 0}
                                    fallback={
                                      <div class="h-6 sm:h-7 flex items-center text-xs text-base-content/45">
                                        対象なし
                                      </div>
                                    }
                                  >
                                    <div class="flex flex-col gap-1">
                                      <For each={salvo.targets}>
                                        {(t) => (
                                          <DenseShipCell
                                            name={shipNameFromIndex(
                                              salvo.defenderSide,
                                              t.defenderIdx as number,
                                              props.fleets,
                                            )}
                                            bannerSrc={shipBannerForIndex(
                                              salvo.defenderSide,
                                              t.defenderIdx as number,
                                              props.fleets,
                                            )}
                                            prefix={
                                              salvo.defenderSide === "friend"
                                                ? `F${(t.defenderIdx as number) + 1}`
                                                : `E${(t.defenderIdx as number) + 1}`
                                            }
                                            prefixTone={
                                              salvo.defenderSide === "friend"
                                                ? "info"
                                                : "error"
                                            }
                                            sunk={t.sunk}
                                          />
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </td>
                                <td class="py-1.5 md:py-2 px-1 md:px-2 whitespace-nowrap align-middle">
                                  <Show
                                    when={salvo.targets.length > 0}
                                    fallback={
                                      <div class="h-6 sm:h-7 flex items-center text-[11px] text-base-content/40">
                                        -
                                      </div>
                                    }
                                  >
                                    <div class="flex flex-col gap-1">
                                      <For each={salvo.targets}>
                                        {(t) => (
                                          <div class="h-6 sm:h-7 flex items-center">
                                            <HpDeltaBar
                                              before={t.beforeHp}
                                              after={t.afterHp}
                                              max={t.maxHp}
                                              layout="responsive"
                                            />
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </td>
                                <td class="py-1.5 md:py-2 pl-1 pr-2 md:pl-2 md:pr-3 text-right whitespace-nowrap align-middle">
                                  <Show
                                    when={salvo.targets.length > 0}
                                    fallback={
                                      <div class="h-6 sm:h-7 flex items-center justify-end">
                                        <FixedOutcomeCell
                                          damage={0}
                                          crit={false}
                                          protect={false}
                                          sunk={false}
                                          afterState=""
                                        />
                                      </div>
                                    }
                                  >
                                    <div class="flex flex-col gap-1">
                                      <For each={salvo.targets}>
                                        {(t) => (
                                          <div class="h-6 sm:h-7 flex items-center justify-end">
                                            <FixedOutcomeCell
                                              damage={t.damage}
                                              crit={t.crit}
                                              protect={false}
                                              sunk={t.sunk}
                                              afterState={t.afterState}
                                            />
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </td>
                              </tr>
                            </>
                          )}
                        </For>

                        {/* Individual Action Rows (1-line fixed rhythm + click-to-expand drawer) */}
                        <For each={sec.actions}>
                          {(row) => {
                            const isExpanded = () => expandedRowId() === row.id;
                            const isFriendlyForce = () =>
                              row.actorRole === "friendly_force" &&
                              row.attackerSide === "friend";

                            return (
                              <>
                                <tr
                                  class={`border-t border-base-300/60 cursor-pointer transition-colors hover:bg-base-200/50 ${
                                    isExpanded()
                                      ? "bg-primary/10"
                                      : row.attackerSide === "enemy"
                                        ? "bg-error/5"
                                        : row.sunk
                                          ? "bg-base-200/35"
                                          : ""
                                  }`}
                                  onClick={() =>
                                    setExpandedRowId(isExpanded() ? null : row.id)
                                  }
                                >
                                  <td
                                    class={`hidden md:table-cell py-1.5 pl-3 pr-2 font-mono tabular-nums text-[11px] whitespace-nowrap align-middle ${
                                      isExpanded()
                                        ? "text-primary font-semibold"
                                        : "text-base-content/45"
                                    }`}
                                  >
                                    <span class="inline-block w-3 text-[9px]">
                                      {isExpanded() ? "▾" : "▸"}
                                    </span>
                                    {String(row.seq).padStart(2, "0")}
                                  </td>
                                  <td class="py-1.5 pl-2 pr-1 md:px-2 align-middle">
                                    <Show
                                      when={row.attackerIndices.length > 0}
                                      fallback={
                                        <Show
                                          when={row.attackerMstShipId}
                                          fallback={
                                            <span class="text-xs text-base-content/55">
                                              {row.attackTag}
                                            </span>
                                          }
                                        >
                                          {(mstId) => (
                                            <DenseShipCell
                                              name={
                                                mstShipNameFromId(
                                                  props.mstShipById,
                                                  mstId(),
                                                ) ?? `艦ID:${mstId()}`
                                              }
                                              bannerSrc={bannerForMstShipId(mstId())}
                                              prefix={isFriendlyForce() ? "友" : "支"}
                                              prefixTone={
                                                isFriendlyForce() ? "success" : "warning"
                                              }
                                            />
                                          )}
                                        </Show>
                                      }
                                    >
                                      <div class="flex flex-col gap-1">
                                        <For each={row.attackerIndices}>
                                          {(shipIdx) => (
                                            <DenseShipCell
                                              name={
                                                isFriendlyForce() && row.attackerMstShipId
                                                  ? (mstShipNameFromId(
                                                      props.mstShipById,
                                                      row.attackerMstShipId,
                                                    ) ??
                                                    shipNameFromIndex(
                                                      row.attackerSide,
                                                      shipIdx,
                                                      props.fleets,
                                                    ))
                                                  : shipNameFromIndex(
                                                      row.attackerSide,
                                                      shipIdx,
                                                      props.fleets,
                                                    )
                                              }
                                              bannerSrc={
                                                isFriendlyForce() && row.attackerMstShipId
                                                  ? bannerForMstShipId(row.attackerMstShipId)
                                                  : shipBannerForIndex(
                                                      row.attackerSide,
                                                      shipIdx,
                                                      props.fleets,
                                                    )
                                              }
                                              prefix={
                                                isFriendlyForce()
                                                  ? `友${shipIdx + 1}`
                                                  : row.attackerSide === "friend"
                                                    ? `F${shipIdx + 1}`
                                                    : `E${shipIdx + 1}`
                                              }
                                              prefixTone={
                                                isFriendlyForce()
                                                  ? "success"
                                                  : row.attackerSide === "friend"
                                                    ? "info"
                                                    : "error"
                                              }
                                            />
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                  </td>
                                  <td class="py-1.5 px-1 md:px-2 max-w-[100px] md:max-w-[230px] align-middle">
                                    <SingleLineEquipmentCell
                                      slotIds={row.slotIds}
                                      fallbackTag={row.attackTag}
                                      mstSlotItemById={props.mstSlotItemById}
                                    />
                                  </td>
                                  <td class="py-1.5 px-0.5 md:px-1 text-center font-mono text-[10px] md:text-xs align-middle text-base-content/45">
                                    →
                                  </td>
                                  <td class="py-1.5 px-1 md:px-2 align-middle">
                                    <Show
                                      when={row.defenderIdx !== null}
                                      fallback={
                                        <span class="text-xs text-base-content/45">
                                          対象なし
                                        </span>
                                      }
                                    >
                                      <DenseShipCell
                                        name={shipNameFromIndex(
                                          row.defenderSide,
                                          row.defenderIdx as number,
                                          props.fleets,
                                        )}
                                        bannerSrc={shipBannerForIndex(
                                          row.defenderSide,
                                          row.defenderIdx as number,
                                          props.fleets,
                                        )}
                                        prefix={
                                          row.defenderSide === "friend"
                                            ? `F${(row.defenderIdx as number) + 1}`
                                            : `E${(row.defenderIdx as number) + 1}`
                                        }
                                        prefixTone={
                                          row.defenderSide === "friend" ? "info" : "error"
                                        }
                                        sunk={row.sunk}
                                      />
                                    </Show>
                                  </td>
                                  <td class="py-1.5 px-1 md:px-2 whitespace-nowrap align-middle">
                                    <Show
                                      when={row.beforeHp !== null && row.afterHp !== null}
                                      fallback={
                                        <span class="text-[11px] text-base-content/40">-</span>
                                      }
                                    >
                                      <HpDeltaBar
                                        before={row.beforeHp}
                                        after={row.afterHp}
                                        max={row.maxHp}
                                        layout="responsive"
                                      />
                                    </Show>
                                  </td>
                                  <td class="py-1.5 pl-1 pr-2 md:pl-2 md:pr-3 text-right whitespace-nowrap align-middle">
                                    <FixedOutcomeCell
                                      damage={row.damage}
                                      crit={row.crit}
                                      protect={row.protect}
                                      sunk={row.sunk}
                                      afterState={row.afterState}
                                    />
                                  </td>
                                </tr>

                                {/* Inline Detail Drawer on Row Click */}
                                <Show when={isExpanded()}>
                                  <tr class="bg-base-200/45 border-t border-primary/30">
                                    <td colspan={7} class="px-4 py-2.5">
                                      <div class="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-3 text-xs">
                                        <div>
                                          <div class="text-[11px] text-base-content/55 mb-1.5">
                                            使用装備 ({row.slotIds.length})
                                          </div>
                                          <Show
                                            when={row.slotIds.length > 0}
                                            fallback={
                                              <span class="text-[11px] text-base-content/45">
                                                {row.attackTag}
                                              </span>
                                            }
                                          >
                                            <div class="flex flex-wrap gap-1.5">
                                              <For each={row.slotIds}>
                                                {(slotId, idx) => {
                                                  const meta = createMemo(() =>
                                                    slotItemMeta(
                                                      slotId,
                                                      props.mstSlotItemById,
                                                    ),
                                                  );
                                                  return (
                                                    <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-base-300 bg-base-100 text-[11px] text-base-content">
                                                      <span class="font-mono text-[10px] text-base-content/50">
                                                        #{idx() + 1}
                                                      </span>
                                                      <WeaponIcon iconType={meta().iconType} />
                                                      <span>
                                                        {meta().name || `装備#${slotId}`}
                                                      </span>
                                                    </span>
                                                  );
                                                }}
                                              </For>
                                            </div>
                                          </Show>
                                        </div>
                                        <div>
                                          <div class="text-[11px] text-base-content/55 mb-1.5">
                                            命中・HP詳細
                                          </div>
                                          <div class="font-mono tabular-nums text-[11px] text-base-content">
                                            {row.damage > 0 ? `-${row.damage}` : "MISS"}
                                            {row.crit ? " [CRIT]" : ""}
                                            {row.sunk ? " [撃沈]" : ""}
                                          </div>
                                          <Show
                                            when={
                                              row.defenderIdx !== null &&
                                              row.beforeHp !== null &&
                                              row.afterHp !== null
                                            }
                                          >
                                            <div class="font-mono tabular-nums text-[11px] mt-1 text-base-content/60">
                                              {shipNameFromIndex(
                                                row.defenderSide,
                                                row.defenderIdx as number,
                                                props.fleets,
                                              )}
                                              : HP {formatNullableNumber(row.beforeHp)} →{" "}
                                              {formatNullableNumber(row.afterHp)} /{" "}
                                              {formatNullableNumber(
                                                row.maxHp ?? row.beforeHp,
                                              )}
                                            </div>
                                          </Show>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                </Show>
                              </>
                            );
                          }}
                        </For>

                        {/* Empty phase fallback */}
                        <Show when={sec.salvos.length === 0 && sec.actions.length === 0}>
                          <tr class="border-t border-base-300/60">
                            <td
                              colspan={7}
                              class="py-3 px-3 text-center text-xs text-base-content/45"
                            >
                              {sec.title}: 有効打なし
                            </td>
                          </tr>
                        </Show>
                      </>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
