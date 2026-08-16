import type {
  MstSlotItemRecord,
  TimelineEvent,
  TimelineStep,
} from "./types";
import type { BattleFleets } from "./types";
import {
  PHASE_NAMES,
  FRIEND_COLORS,
  ENEMY_COLORS,
  DAMAGE_ZONES,
} from "./constants";
import { escHtml, normalizeNullableNumber } from "./helpers";
import {
  shipNameFromIndex,
  renderEquipmentBadgesFromSlotIds,
} from "./render-helpers";
import {
  jsonRecordOf,
  jsonRecordsOf,
  safeNumber,
  safeNumberArray,
  safeNumberOrNull,
  nullableNumberArray,
  unknownArrayOf,
} from "./payload-guards";

const phaseName = (key: string): string => PHASE_NAMES[key] ?? key;

function normalizeSlotItemIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const id = normalizeNullableNumber(item);
    return id === null ? [] : [id];
  });
}

// ── Layout constants (shared by builder + renderer) ───────────────────────

const ROW_H = 28;
const CHART_W = 420;
const PAD_L = 10;
const PAD_R = 10;
const PAD_TOP = 26;
const PAD_BOT = 8;
const INNER_W = CHART_W - PAD_L - PAD_R;
const EXTEND = ROW_H / 2;

function xHP(pct: number): string {
  return (PAD_L + (pct / 100) * INNER_W).toFixed(1);
}

function yStep(si: number): string {
  return (PAD_TOP + si * ROW_H + ROW_H / 2).toFixed(1);
}

// ── Event extraction ──────────────────────────────────────────────────────

function normalizeShellingRows(data: unknown): Array<Record<string, unknown>> {
  const normalizeSi = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    const n = safeNumber(value);
    return Number.isFinite(n) && n > 0 ? [n] : [];
  };

  if (Array.isArray(data)) return jsonRecordsOf(data);
  const obj = jsonRecordOf(data);
  if (obj && (obj["at"] !== undefined || Array.isArray(obj["df"]))) {
    return [
      {
        ...obj,
        si: normalizeSi(obj["si"]),
      },
    ];
  }
  if (obj?.["at_list"]) {
    const atList = unknownArrayOf(obj["at_list"]);
    const dfList = unknownArrayOf(obj["df_list"]);
    const damageList = unknownArrayOf(obj["damage"]);
    const clList = unknownArrayOf(obj["cl_list"]);
    const siList = unknownArrayOf(obj["si_list"]);
    const protectFlagList = unknownArrayOf(obj["protect_flag"]);
    const fNowHpsList = unknownArrayOf(obj["f_now_hps"]);
    const eNowHpsList = unknownArrayOf(obj["e_now_hps"]);
    return atList.map((at, idx) => ({
      at,
      df: dfList[idx] ?? [],
      damage: damageList[idx] ?? [],
      cl: clList[idx] ?? [],
      at_eflag: unknownArrayOf(obj["at_eflag"])[idx] ?? 0,
      si: normalizeSi(siList[idx] ?? []),
      protect_flag: protectFlagList[idx] ?? [],
      f_now_hps: fNowHpsList[idx] ?? [],
      e_now_hps: eNowHpsList[idx] ?? [],
    }));
  }
  return [];
}

function pickHougekiRowsByRound(
  data: unknown,
  roundIdx: number | null,
): unknown {
  if (!Array.isArray(data)) return data;
  if (roundIdx == null) return data;

  const rows = jsonRecordsOf(data);
  const byIndex1 = rows.filter(
    (row) => Number(row["index_1"] ?? Number.NaN) === roundIdx,
  );
  if (byIndex1.length > 0) return byIndex1;

  return rows[roundIdx] ?? data;
}

export function buildTimelineEvents(
  battle: Record<string, unknown>,
  fleets: BattleFleets | null = null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let airBatchSeq = 0;

  function normalizeNightSupportAttack(
    source: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const nested = jsonRecordOf(source["night_support_attack"]);
    const hourai =
      jsonRecordOf(nested?.["hourai"]) ??
      jsonRecordOf(source["night_support_hourai"]);
    const airatack =
      jsonRecordOf(nested?.["airatack"]) ??
      jsonRecordOf(nested?.["airattack"]) ??
      jsonRecordOf(source["night_support_airatack"]) ??
      jsonRecordOf(source["night_support_airattack"]);

    if (!hourai && !airatack) return null;
    return { hourai, airatack };
  }

  function toValidIndex(value: unknown, limit: number): number | null {
    const idx = Number(value);
    if (!Number.isFinite(idx)) return null;
    const normalized = Math.trunc(idx);
    if (normalized < 0) return null;
    if (normalized >= limit) return null;
    return normalized;
  }

  type EventOptions = {
    actorRole?: "main" | "airbase" | "support" | "friendly_force";
    affectsHp?: boolean;
    friendlyForceNowHps?: Array<number | null>;
    friendlyForceMaxHps?: Array<number | null>;
    airBatchId?: number;
  };

  function extractShellingEvents(
    rows: unknown,
    phaseLabel: string,
    options?: EventOptions,
  ): void {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const r = jsonRecordOf(row);
      if (!r) continue;
      const atkEnemy = safeNumber(r["at_eflag"]) !== 0;
      const attackerSide: "friend" | "enemy" = atkEnemy ? "enemy" : "friend";
      const defenderSide: "friend" | "enemy" = atkEnemy ? "friend" : "enemy";
      const defs = unknownArrayOf(r["df"]);
      const dmgs = unknownArrayOf(r["damage"]);
      const clsMask = unknownArrayOf(r["cl"]);
      const sis = normalizeSlotItemIds(r["si"]);
      const fHps = nullableNumberArray(r["f_now_hps"] ?? r["f_nowhps"]);
      const eHps = nullableNumberArray(r["e_now_hps"] ?? r["e_nowhps"]);

      const attackerLimit =
        attackerSide === "friend" ? fHps.length : eHps.length;
      const defenderLimit =
        defenderSide === "friend" ? fHps.length : eHps.length;
      const attackerIdx = toValidIndex(safeNumber(r["at"], -1), attackerLimit);

      for (let i = 0; i < defs.length; i++) {
        const rawDef = safeNumber(defs[i], -1);
        const defenderIdx = toValidIndex(rawDef, defenderLimit);
        if (defenderIdx === null) continue;
        const dmg = safeNumberOrNull(dmgs[i]);
        if (dmg === null) continue;
        const crit = safeNumber(clsMask[i]) >= 2;
        const beforeHp =
          defenderSide === "friend"
            ? fHps[defenderIdx] ?? null
            : eHps[defenderIdx] ?? null;
        const afterHp =
          beforeHp === null ? null : Math.max(0, beforeHp - dmg);
        const ffNowHp =
          options?.actorRole === "friendly_force" &&
          attackerSide === "friend" &&
          attackerIdx !== null
            ? safeNumberOrNull(
                (options.friendlyForceNowHps ?? [])[attackerIdx] ??
                  fHps[attackerIdx],
              )
            : null;
        const ffMaxHp =
          options?.actorRole === "friendly_force" &&
          attackerSide === "friend" &&
          attackerIdx !== null
            ? safeNumberOrNull(
                (options.friendlyForceMaxHps ?? [])[attackerIdx] ??
                  (options.friendlyForceNowHps ?? [])[attackerIdx] ??
                  fHps[attackerIdx],
              )
            : null;
        events.push({
          phase: phaseLabel,
          type: "shelling",
          actorRole: options?.actorRole ?? "main",
          affectsHp: options?.affectsHp ?? true,
          attackerSide,
          attackerIdx,
          attackerNowHp: ffNowHp,
          attackerMaxHp: ffMaxHp,
          defenderSide,
          defenderIdx,
          damage: dmg,
          crit,
          sunk: afterHp !== null && beforeHp !== null && afterHp <= 0 && beforeHp > 0,
          slotItems: sis,
          fHps,
          eHps,
        });
      }
    }
  }

  function extractAirAttackEvents(
    data: unknown,
    phaseLabel: string,
    slotItemOverride?: number[],
    options?: EventOptions,
  ): void {
    const d = jsonRecordOf(data);
    if (!d) return;
    // Do not normalize/shift damage arrays here: leading zero is often a valid
    // no-damage slot, not a 1-based dummy. Shifting causes defender index drift.
    const fDam = nullableNumberArray(d["f_damages"]);
    const eDam = nullableNumberArray(d["e_damages"]);
    const fFrom = safeNumberArray(d["f_plane_from"]).filter((v) => v >= 0);
    const eFrom = safeNumberArray(d["e_plane_from"]).filter((v) => v >= 0);
    const fNow = nullableNumberArray(d["f_now_hps"] ?? d["f_nowhps"]);
    const eNow = nullableNumberArray(d["e_now_hps"] ?? d["e_nowhps"]);
    const effectiveSlotItems = slotItemOverride ?? [];
    const airBatchId = options?.airBatchId;
    let eventCount = 0;

    for (let i = 0; i < fDam.length; i++) {
      const dmg = fDam[i] ?? null;
      if (dmg === null || dmg < 0) continue;
      const beforeHp = fNow[i] ?? null;
      const afterHp =
        beforeHp === null ? null : Math.max(0, beforeHp - dmg);
      events.push({
        phase: phaseLabel,
        type: "air",
        actorRole: options?.actorRole ?? "main",
        affectsHp: options?.affectsHp ?? true,
        attackerSide: "enemy",
        attackerIdx: null,
        attackerGroup: eFrom,
        defenderSide: "friend",
        defenderIdx: i,
        damage: dmg,
        crit: false,
        sunk: afterHp !== null && beforeHp !== null && afterHp <= 0 && beforeHp > 0,
        slotItems: effectiveSlotItems,
        fHps: fNow,
        eHps: eNow,
        ...(airBatchId === undefined ? {} : { airBatchId }),
      });
      eventCount++;
    }
    for (let i = 0; i < eDam.length; i++) {
      const dmg = eDam[i] ?? null;
      if (dmg === null || dmg < 0) continue;
      const beforeHp = eNow[i] ?? null;
      const afterHp =
        beforeHp === null ? null : Math.max(0, beforeHp - dmg);
      events.push({
        phase: phaseLabel,
        type: "air",
        actorRole: options?.actorRole ?? "main",
        affectsHp: options?.affectsHp ?? true,
        attackerSide: "friend",
        attackerIdx: null,
        attackerGroup: fFrom,
        defenderSide: "enemy",
        defenderIdx: i,
        damage: dmg,
        crit: false,
        sunk: afterHp !== null && beforeHp !== null && afterHp <= 0 && beforeHp > 0,
        slotItems: effectiveSlotItems,
        fHps: fNow,
        eHps: eNow,
        ...(airBatchId === undefined ? {} : { airBatchId }),
      });
      eventCount++;
    }

    if (eventCount === 0 && options?.affectsHp === false) {
      events.push({
        phase: phaseLabel,
        type: "air",
        actorRole: options?.actorRole ?? "airbase",
        affectsHp: false,
        attackerSide: "friend",
        attackerIdx: null,
        attackerGroup: fFrom,
        defenderSide: "enemy",
        defenderIdx: null,
        damage: 0,
        crit: false,
        sunk: false,
        slotItems: effectiveSlotItems,
        fHps: fNow,
        eHps: eNow,
        ...(airBatchId === undefined ? {} : { airBatchId }),
      });
    }
  }

  function extractRaigekiEvents(data: unknown, phaseLabel: string): void {
    const d = jsonRecordOf(data);
    if (!d) return;
    const fDam = unknownArrayOf(d["fdam"] ?? d["f_dam"]);
    const eDam = unknownArrayOf(d["edam"] ?? d["e_dam"]);
    const fCl = unknownArrayOf(d["fcl_list"] ?? d["fcl"]);
    const eCl = unknownArrayOf(d["ecl_list"] ?? d["ecl"]);

    // Support both flat array format (ClosingRaigeki: f_rai/e_rai) and nested format (OpeningRaigeki: frai_list_items/erai_list_items).
    // Opening uses per-attacker slots (Array<Array<number>|null>), so preserve slot index instead of flattening.
    const fRaiFromSnake =
      !Array.isArray(d["frai"]) && Array.isArray(d["f_rai"]);
    let fRai = unknownArrayOf(d["frai"] ?? d["f_rai"]);
    if (fRai.length === 0 && Array.isArray(d["frai_list_items"])) {
      fRai = unknownArrayOf(d["frai_list_items"]);
    }
    const eRaiFromSnake =
      !Array.isArray(d["erai"]) && Array.isArray(d["e_rai"]);
    let eRai = unknownArrayOf(d["erai"] ?? d["e_rai"]);
    if (eRai.length === 0 && Array.isArray(d["erai_list_items"])) {
      eRai = unknownArrayOf(d["erai_list_items"]);
    }

    const fNow = nullableNumberArray(d["f_now_hps"] ?? d["f_nowhps"]);
    const eNow = nullableNumberArray(d["e_now_hps"] ?? d["e_nowhps"]);
    const friendLimit =
      fleets?.friendlyShips && fleets.friendlyShips.length > 0
        ? fleets.friendlyShips.length
        : fNow.length;
    const enemyLimit =
      fleets?.enemyShips && fleets.enemyShips.length > 0
        ? fleets.enemyShips.length
        : eNow.length;

    // Build per-defender attacker map from rai array (1-based targets → 0-based).
    // Returns Map<defIdx, atkIdx[]> — only attackers that target that specific defender.
    function parseRaiTargets(
      raiRows: unknown[],
      defenderLimit: number,
      preferZeroBased: boolean,
      attackerLimit: number,
    ): Map<number, number[]> {
      const defToAtk = new Map<number, number[]>();
      const toNumericTarget = (raw: unknown): number | null => {
        if (raw == null) return null;
        if (typeof raw === "string" && raw.trim() === "") return null;
        const n = safeNumberOrNull(raw);
        return n === null ? null : Math.trunc(n);
      };
      const numericTargets: number[] = [];
      for (const row of raiRows) {
        if (Array.isArray(row)) {
          for (const target of unknownArrayOf(row)) {
            const n = toNumericTarget(target);
            if (n != null) numericTargets.push(n);
          }
        } else {
          const n = toNumericTarget(row);
          if (n != null) numericTargets.push(n);
        }
      }

      const hasNegative = numericTargets.some((v) => v < 0);
      const hasZero = numericTargets.some((v) => v === 0);
      const maxTarget = numericTargets.length
        ? Math.max(...numericTargets)
        : Number.NEGATIVE_INFINITY;
      const zeroBased = preferZeroBased
        ? maxTarget < defenderLimit
        : hasNegative || hasZero
          ? true
          : maxTarget >= defenderLimit
            ? false
            : false;

      const addTarget = (atkIdx: number, rawTarget: unknown): void => {
        const normalizedTarget = toNumericTarget(rawTarget);
        if (normalizedTarget == null) return;
        if (zeroBased && normalizedTarget < 0) return;
        if (!zeroBased && normalizedTarget < 0) return;
        const defIdx = zeroBased ? normalizedTarget : normalizedTarget - 1;
        if (defIdx < 0 || defIdx >= defenderLimit) return;
        if (!defToAtk.has(defIdx)) defToAtk.set(defIdx, []);
        defToAtk.get(defIdx)!.push(atkIdx);
      };

      for (let atkIdx = 0; atkIdx < raiRows.length; atkIdx++) {
        if (attackerLimit > 0 && atkIdx >= attackerLimit) break;
        const row = raiRows[atkIdx];
        if (Array.isArray(row)) {
          for (const target of unknownArrayOf(row)) addTarget(atkIdx, target);
          continue;
        }
        addTarget(atkIdx, row);
      }
      return defToAtk;
    }

    if (fRai.length > 0 || eRai.length > 0) {
      // Friend fleet → enemy: one event per targeted enemy slot
      const fDefToAtk = parseRaiTargets(
        fRai,
        enemyLimit,
        fRaiFromSnake,
        friendLimit,
      );
      for (const [defIdx, atkList] of fDefToAtk) {
        const dmg = safeNumberOrNull(eDam[defIdx]);
        if (dmg === null) continue;
        const beforeHp = eNow[defIdx] ?? null;
        const afterHp =
          beforeHp === null ? null : Math.max(0, beforeHp - dmg);
        events.push({
          phase: phaseLabel,
          type: "raigeki",
          attackerSide: "friend",
          attackerIdx: atkList.length === 1 ? (atkList[0] ?? null) : null,
          attackerGroup: atkList.length > 1 ? atkList : [],
          defenderSide: "enemy",
          defenderIdx: defIdx,
          damage: dmg,
          crit: dmg > 0 && Number(eCl[defIdx] ?? 0) >= 2,
          sunk: afterHp !== null && beforeHp !== null && afterHp <= 0 && beforeHp > 0,
          slotItems: [],
          fHps: fNow,
          eHps: eNow,
        });
      }

      // Enemy fleet → friend: one event per targeted friend slot
      const eDefToAtk = parseRaiTargets(
        eRai,
        friendLimit,
        eRaiFromSnake,
        enemyLimit,
      );
      for (const [defIdx, atkList] of eDefToAtk) {
        const dmg = safeNumberOrNull(fDam[defIdx]);
        if (dmg === null) continue;
        const beforeHp = fNow[defIdx] ?? null;
        const afterHp =
          beforeHp === null ? null : Math.max(0, beforeHp - dmg);
        events.push({
          phase: phaseLabel,
          type: "raigeki",
          attackerSide: "enemy",
          attackerIdx: atkList.length === 1 ? (atkList[0] ?? null) : null,
          attackerGroup: atkList.length > 1 ? atkList : [],
          defenderSide: "friend",
          defenderIdx: defIdx,
          damage: dmg,
          crit: dmg > 0 && Number(fCl[defIdx] ?? 0) >= 2,
          sunk: afterHp !== null && beforeHp !== null && afterHp <= 0 && beforeHp > 0,
          slotItems: [],
          fHps: fNow,
          eHps: eNow,
        });
      }
    } else {
      // Fallback: no rai data, emit damage-only events (no MISS)
      for (let i = 0; i < Math.min(eDam.length, enemyLimit); i++) {
        const dmg = safeNumberOrNull(eDam[i]);
        if (dmg === null || dmg < 0) continue;
        const beforeHp = eNow[i] ?? null;
        events.push({
          phase: phaseLabel,
          type: "raigeki",
          attackerSide: "friend",
          attackerIdx: null,
          attackerGroup: [],
          defenderSide: "enemy",
          defenderIdx: i,
          damage: dmg,
          crit: Number(eCl[i] ?? 0) >= 2,
          sunk: beforeHp !== null && Math.max(0, beforeHp - dmg) <= 0 && beforeHp > 0,
          slotItems: [],
          fHps: fNow,
          eHps: eNow,
        });
      }
      for (let i = 0; i < Math.min(fDam.length, friendLimit); i++) {
        const dmg = safeNumberOrNull(fDam[i]);
        if (dmg === null || dmg < 0) continue;
        const beforeHp = fNow[i] ?? null;
        events.push({
          phase: phaseLabel,
          type: "raigeki",
          attackerSide: "enemy",
          attackerIdx: null,
          attackerGroup: [],
          defenderSide: "friend",
          defenderIdx: i,
          damage: dmg,
          crit: Number(fCl[i] ?? 0) >= 2,
          sunk: beforeHp !== null && Math.max(0, beforeHp - dmg) <= 0 && beforeHp > 0,
          slotItems: [],
          fHps: fNow,
          eHps: eNow,
        });
      }
    }
  }

  function hasRaigekiActivity(data: unknown): boolean {
    const d = jsonRecordOf(data);
    if (!d) return false;
    const raiCandidates = [
      d["frai"],
      d["f_rai"],
      d["frai_list_items"],
      d["erai"],
      d["e_rai"],
      d["erai_list_items"],
    ];
    const hasTarget = raiCandidates.some((candidate) => {
      if (!Array.isArray(candidate)) return false;
      return candidate.some((row) => {
        if (Array.isArray(row)) {
          return row.some((v) => {
            return safeNumberOrNull(v) !== null && safeNumber(v) >= 0;
          });
        }
        return safeNumberOrNull(row) !== null && safeNumber(row) >= 0;
      });
    });
    if (hasTarget) return true;

    const damages = [d["fdam"], d["f_dam"], d["edam"], d["e_dam"]];
    return damages.some(
      (arr) =>
        Array.isArray(arr) &&
        arr.some((v) => {
          const n = safeNumberOrNull(v);
          return n !== null && n >= 0;
        }),
    );
  }

  const rawOrder = unknownArrayOf(battle["battle_order"]);
  const hasObjectOrder =
    Array.isArray(rawOrder) &&
    rawOrder.length > 0 &&
    rawOrder[0] !== null &&
    typeof rawOrder[0] === "object";

  if (hasObjectOrder) {
    const presentKeys = new Set<string>();
    for (const phaseType of rawOrder) {
      const phaseObj = jsonRecordOf(phaseType);
      if (!phaseObj) continue;
      const key = Object.keys(phaseObj)[0];
      if (!key) continue;
      presentKeys.add(key);
      const idx = safeNumberOrNull(phaseObj[key]);
      const phaseLabel = PHASE_NAMES[key] ?? key;

      if (
        key === "Hougeki" ||
        key === "OpeningTaisen" ||
        key === "MidnightHougeki"
      ) {
        const raw =
          key === "Hougeki"
            ? pickHougekiRowsByRound(battle["hougeki"], idx)
            : key === "OpeningTaisen"
              ? battle["opening_taisen"]
              : battle["midnight_hougeki"];
        extractShellingEvents(normalizeShellingRows(raw), phaseLabel);
      } else if (key === "OpeningAirAttack") {
        const rawAir = Array.isArray(battle["opening_air_attack"])
          ? (unknownArrayOf(battle["opening_air_attack"])[idx ?? 0] ??
            battle["opening_air_attack"])
          : battle["opening_air_attack"];
        const airRow = Array.isArray(rawAir)
          ? (unknownArrayOf(rawAir)[0] ?? null)
          : rawAir;
        if (airRow) {
          extractAirAttackEvents(airRow, phaseLabel, undefined, {
            airBatchId: ++airBatchSeq,
          });
        }
      } else if (key === "OpeningRaigeki") {
        extractRaigekiEvents(battle["opening_raigeki"], phaseLabel);
      } else if (key === "ClosingRaigeki") {
        extractRaigekiEvents(battle["closing_raigeki"], phaseLabel);
      } else if (
        key === "AirBaseAirAttack" ||
        key === "AirBaseAssult" ||
        key === "CarrierBaseAssault"
      ) {
        let rawAirBase: unknown;
        if (key === "AirBaseAirAttack") {
          rawAirBase = Array.isArray(battle["air_base_air_attacks"])
            ? unknownArrayOf(battle["air_base_air_attacks"])[idx ?? 0]
            : (() => {
                const attacks = jsonRecordOf(
                  battle["air_base_air_attacks"],
                )?.["attacks"];
                return Array.isArray(attacks) ? attacks[idx ?? 0] : null;
              })();
        } else if (key === "AirBaseAssult") {
          rawAirBase = battle["air_base_assault"];
        } else {
          rawAirBase = battle["carrier_base_assault"];
        }
        if (rawAirBase) {
          const squads = (() => {
            const raw = jsonRecordOf(rawAirBase);
            return raw
              ? safeNumberArray(raw["squadron_plane"]).filter((n) => n > 0)
              : [];
          })();
          extractAirAttackEvents(
            rawAirBase,
            phaseLabel,
            squads.length > 0 ? squads : undefined,
            {
              actorRole: "airbase",
              affectsHp: false,
              airBatchId: ++airBatchSeq,
            },
          );
        }
      } else if (key === "SupportAttack") {
        // support_attack may be nested or top-level depending on data layout
        const sa = jsonRecordOf(battle["support_attack"]) ?? battle;
        const hourai = jsonRecordOf(sa["support_hourai"]);
        const airatack =
          jsonRecordOf(sa["support_airatack"]) ??
          jsonRecordOf(sa["support_airattack"]);
        if (hourai?.["damage"]) {
          const dmgs = unknownArrayOf(hourai["damage"]);
          const eNow = nullableNumberArray(hourai["now_hps"]);
          const shipIds = unknownArrayOf(hourai["ship_id"]);
          const cls = unknownArrayOf(hourai["cl_list"]);
          for (let i = 0; i < dmgs.length; i++) {
            const dmg = safeNumberOrNull(dmgs[i]);
            if (dmg === null || dmg < 0) continue;
            const beforeHp = eNow[i] ?? null;
            events.push({
              phase: phaseLabel,
              type: "shelling",
              actorRole: "support",
              affectsHp: false,
              attackerSide: "friend",
              attackerIdx: null,
              attackerGroup: [],
              defenderSide: "enemy",
              defenderIdx: i,
              damage: dmg,
              crit: safeNumber(cls[i]) >= 2,
              sunk: beforeHp !== null && Math.max(0, beforeHp - dmg) <= 0 && beforeHp > 0,
              slotItems: [],
              fHps: [],
              eHps: eNow,
              ...(safeNumberOrNull(shipIds[i]) !== null && safeNumber(shipIds[i]) > 0
                ? { attackerMstShipId: safeNumber(shipIds[i]) }
                : {}),
            });
          }
        }
        if (airatack?.["e_damage"]) {
          const ed = jsonRecordOf(airatack["e_damage"]);
          const fd = jsonRecordOf(airatack["f_damage"]);
          if (!ed) continue;
          extractAirAttackEvents(
            {
              e_damages: ed["damages"],
              f_damages: fd?.["damages"],
              e_now_hps: ed["now_hps"],
              f_now_hps: fd?.["now_hps"],
              e_plane_from: [],
              f_plane_from: [],
            },
            phaseLabel,
            undefined,
            {
              actorRole: "support",
              affectsHp: false,
              airBatchId: ++airBatchSeq,
            },
          );
        }
      } else if (key === "NightSupportAttack") {
        const night = normalizeNightSupportAttack(battle);
        if (!night) continue;
        const hourai = jsonRecordOf(night["hourai"]);
        if (hourai?.["damage"]) {
          const dmgs = unknownArrayOf(hourai["damage"]);
          const eNow = nullableNumberArray(hourai["now_hps"]);
          const shipIds = unknownArrayOf(hourai["ship_id"]);
          const cls = unknownArrayOf(hourai["cl_list"]);
          for (let i = 0; i < dmgs.length; i++) {
            const dmg = safeNumberOrNull(dmgs[i]);
            if (dmg === null || dmg < 0) continue;
            const beforeHp = eNow[i] ?? null;
            events.push({
              phase: phaseLabel,
              type: "shelling",
              actorRole: "support",
              affectsHp: false,
              attackerSide: "friend",
              attackerIdx: null,
              attackerGroup: [],
              defenderSide: "enemy",
              defenderIdx: i,
              damage: dmg,
              crit: safeNumber(cls[i]) >= 2,
              sunk: beforeHp !== null && Math.max(0, beforeHp - dmg) <= 0 && beforeHp > 0,
              slotItems: [],
              fHps: [],
              eHps: eNow,
              ...(safeNumberOrNull(shipIds[i]) !== null && safeNumber(shipIds[i]) > 0
                ? { attackerMstShipId: safeNumber(shipIds[i]) }
                : {}),
            });
          }
        }
        const nightAir = jsonRecordOf(night["airatack"]);
        if (nightAir?.["e_damage"]) {
          const ed = jsonRecordOf(nightAir["e_damage"]);
          const fd = jsonRecordOf(nightAir["f_damage"]);
          if (!ed) continue;
          extractAirAttackEvents(
            {
              e_damages: ed["damages"],
              f_damages: fd?.["damages"],
              e_now_hps: ed["now_hps"],
              f_now_hps: fd?.["now_hps"],
              e_plane_from: [],
              f_plane_from: [],
            },
            phaseLabel,
            undefined,
            {
              actorRole: "support",
              affectsHp: false,
              airBatchId: ++airBatchSeq,
            },
          );
        }
      } else if (key === "FriendlyForceAttack") {
        const ffa = jsonRecordOf(battle["friendly_force_attack"]);
        const fleetInfo = jsonRecordOf(ffa?.["fleet_info"]);
        const ffShipIds = nullableNumberArray(fleetInfo?.["ship_id"]);
        const supportHourai = jsonRecordOf(ffa?.["support_hourai"]);
        if (supportHourai?.["hougeki"]) {
          const beforeCount = events.length;
          const rawHougeki = supportHourai["hougeki"];
          const hougeki = jsonRecordOf(rawHougeki);
          const atList = unknownArrayOf(hougeki?.["at_list"]);
          const rows = normalizeShellingRows(rawHougeki);
          const ffNowHps = nullableNumberArray(fleetInfo?.["now_hps"]);
          const ffMaxHps = nullableNumberArray(fleetInfo?.["max_hps"]);

          extractShellingEvents(rows, phaseLabel, {
            actorRole: "friendly_force",
            affectsHp: true,
            friendlyForceNowHps: ffNowHps,
            friendlyForceMaxHps: ffMaxHps,
          });

          // Annotate newly added events with the MST ship ID of the attacker.
          // Reconstruct the exact sequence of (row, validDefender) pairs to match
          // the events built in extractShellingEvents.
          if (ffShipIds.length > 0) {
            let rowEventIdx = beforeCount;
            for (let ri = 0; ri < rows.length; ri++) {
              const row = rows[ri];
              if (!row) continue;
              const at0 = safeNumber(row["at"] ?? atList[ri], -1);
              const mstId =
                at0 >= 0 && at0 < ffShipIds.length
                  ? (ffShipIds[at0] ?? undefined)
                  : undefined;
              const defs = unknownArrayOf(row["df"]);
              // Use the same HP array length that extractShellingEvents does (e_now_hps or e_nowhps)
              const eHpsList = unknownArrayOf(
                row["e_now_hps"] ?? row["e_nowhps"],
              );
              const defenderLimit = eHpsList.length;

              // Iterate through defenders in same order as extractShellingEvents.
              for (let di = 0; di < defs.length; di++) {
                const defenderIdx = toValidIndex(defs[di], defenderLimit);
                // Only annotate events for valid defenders (matching extractShellingEvents skip pattern).
                if (defenderIdx !== null && rowEventIdx < events.length) {
                  if (mstId && Number.isFinite(mstId) && mstId > 0) {
                    const event = events[rowEventIdx];
                    if (event) event.attackerMstShipId = mstId;
                  }
                  rowEventIdx++;
                }
              }
            }
          }
        }
      }
    }
    if (
      !presentKeys.has("OpeningRaigeki") &&
      hasRaigekiActivity(battle["opening_raigeki"])
    ) {
      extractRaigekiEvents(
        battle["opening_raigeki"],
        phaseName("OpeningRaigeki"),
      );
    }
    if (
      !presentKeys.has("ClosingRaigeki") &&
      hasRaigekiActivity(battle["closing_raigeki"])
    ) {
      extractRaigekiEvents(
        battle["closing_raigeki"],
        phaseName("ClosingRaigeki"),
      );
    }
  } else {
    // Air base / carrier base assaults (processed first in battle flow)
    if (battle["air_base_assault"]) {
      const squads =
        (jsonRecordOf(battle["air_base_assault"])?.["squadron_plane"] as
          | unknown[]
          | undefined)
          ?.map(Number)
          .filter((n) => n > 0) ?? [];
      extractAirAttackEvents(
        battle["air_base_assault"],
        phaseName("AirBaseAssult"),
        squads.length > 0 ? squads : undefined,
        {
          actorRole: "airbase",
          affectsHp: false,
          airBatchId: ++airBatchSeq,
        },
      );
    }
    if (battle["carrier_base_assault"]) {
      extractAirAttackEvents(
        battle["carrier_base_assault"],
        phaseName("CarrierBaseAssault"),
        undefined,
        {
          actorRole: "airbase",
          affectsHp: false,
          airBatchId: ++airBatchSeq,
        },
      );
    }
    if (battle["air_base_air_attacks"]) {
      const attacks = Array.isArray(battle["air_base_air_attacks"])
        ? unknownArrayOf(battle["air_base_air_attacks"])
        : unknownArrayOf(jsonRecordOf(battle["air_base_air_attacks"])?.["attacks"]);
      attacks.forEach((a) => {
        const attack = jsonRecordOf(a);
        const squads = safeNumberArray(attack?.["squadron_plane"]).filter(
          (n) => n > 0,
        );
        extractAirAttackEvents(
          attack ?? {},
            phaseName("AirBaseAirAttack"),
          squads.length > 0 ? squads : undefined,
          {
            actorRole: "airbase",
            affectsHp: false,
            airBatchId: ++airBatchSeq,
          },
        );
      });
    }
    // Support attack
    const sa = jsonRecordOf(battle["support_attack"]) ?? battle;
    const hourai = jsonRecordOf(sa["support_hourai"]);
    if (hourai?.["damage"]) {
      const dmgs = nullableNumberArray(hourai["damage"]);
      const eNow = nullableNumberArray(hourai["now_hps"]);
      const shipIds = nullableNumberArray(hourai["ship_id"]);
      const cls = nullableNumberArray(hourai["cl_list"]);
      for (let i = 0; i < dmgs.length; i++) {
        const dmg = dmgs[i] ?? null;
        if (dmg === null || dmg < 0) continue;
        const beforeHp = eNow[i] ?? null;
        const shipId = safeNumberOrNull(shipIds[i]);
        events.push({
          phase: phaseName("SupportAttack"),
          type: "shelling",
          actorRole: "support",
          affectsHp: false,
          attackerSide: "friend",
          attackerIdx: null,
          attackerGroup: [],
          defenderSide: "enemy",
          defenderIdx: i,
          damage: dmg,
          crit: safeNumber(cls[i]) >= 2,
          sunk: beforeHp !== null && Math.max(0, beforeHp - dmg) <= 0 && beforeHp > 0,
          slotItems: [],
          fHps: [],
          eHps: eNow,
          ...(shipId !== null && shipId > 0
            ? { attackerMstShipId: shipId }
            : {}),
        });
      }
    }
    const supportAir =
      jsonRecordOf(sa["support_airatack"]) ??
      jsonRecordOf(sa["support_airattack"]);
    if (supportAir?.["e_damage"]) {
      const ed = jsonRecordOf(supportAir["e_damage"]);
      const fd = jsonRecordOf(supportAir["f_damage"]);
      if (ed) {
        extractAirAttackEvents(
          {
            e_damages: ed["damages"],
            f_damages: fd?.["damages"],
            e_now_hps: ed["now_hps"],
            f_now_hps: fd?.["now_hps"],
            e_plane_from: [],
            f_plane_from: [],
          },
          phaseName("SupportAttack"),
          undefined,
          {
            actorRole: "support",
            affectsHp: false,
            airBatchId: ++airBatchSeq,
          },
        );
      }
    }
    const night = normalizeNightSupportAttack(battle);
    const nightHourai = jsonRecordOf(night?.["hourai"]);
    if (nightHourai?.["damage"]) {
      const hourai = nightHourai;
      const dmgs = unknownArrayOf(hourai["damage"]);
      const eNow = nullableNumberArray(hourai["now_hps"]);
      const shipIds = unknownArrayOf(hourai["ship_id"]);
      const cls = unknownArrayOf(hourai["cl_list"]);
      for (let i = 0; i < dmgs.length; i++) {
        const dmg = safeNumberOrNull(dmgs[i]);
        if (dmg === null || dmg < 0) continue;
        const beforeHp = eNow[i] ?? null;
        events.push({
          phase: phaseName("NightSupportAttack"),
          type: "shelling",
          actorRole: "support",
          affectsHp: false,
          attackerSide: "friend",
          attackerIdx: null,
          attackerGroup: [],
          defenderSide: "enemy",
          defenderIdx: i,
            damage: dmg,
            crit: safeNumber(cls[i]) >= 2,
          sunk: beforeHp !== null && Math.max(0, beforeHp - dmg) <= 0 && beforeHp > 0,
          slotItems: [],
          fHps: [],
          eHps: eNow,
          ...(safeNumberOrNull(shipIds[i]) !== null && safeNumber(shipIds[i]) > 0
            ? { attackerMstShipId: safeNumber(shipIds[i]) }
            : {}),
        });
      }
    }
    const nightAir = jsonRecordOf(night?.["airatack"]);
    if (nightAir?.["e_damage"]) {
      const ed = jsonRecordOf(nightAir["e_damage"]);
      const fd = jsonRecordOf(nightAir["f_damage"]);
      if (ed) {
        extractAirAttackEvents(
          {
            e_damages: ed["damages"],
            f_damages: fd?.["damages"],
            e_now_hps: ed["now_hps"],
            f_now_hps: fd?.["now_hps"],
            e_plane_from: [],
            f_plane_from: [],
          },
          phaseName("NightSupportAttack"),
          undefined,
          {
            actorRole: "support",
            affectsHp: false,
            airBatchId: ++airBatchSeq,
          },
        );
      }
    }
    // Main battle phases
    if (battle["opening_taisen"]) {
      extractShellingEvents(
        normalizeShellingRows(battle["opening_taisen"]),
        phaseName("OpeningTaisen"),
      );
    }
    if (battle["opening_air_attack"]) {
      const raw = battle["opening_air_attack"];
      const airRow = Array.isArray(raw) ? unknownArrayOf(raw)[0] : raw;
      if (airRow) {
        extractAirAttackEvents(airRow, phaseName("OpeningAirAttack"), undefined, {
          airBatchId: ++airBatchSeq,
        });
      }
    }
    if (battle["opening_raigeki"]) {
      extractRaigekiEvents(
        battle["opening_raigeki"],
        phaseName("OpeningRaigeki"),
      );
    }
    if (battle["hougeki"]) {
      const rows = Array.isArray(battle["hougeki"])
        ? unknownArrayOf(battle["hougeki"])
        : [battle["hougeki"]];
      rows.forEach((h) => {
        extractShellingEvents(
          normalizeShellingRows(h),
          phaseName("Hougeki"),
        );
      });
    }
    if (battle["closing_raigeki"]) {
      extractRaigekiEvents(
        battle["closing_raigeki"],
        phaseName("ClosingRaigeki"),
      );
    }
    // Friendly force attack (after day battle, before midnight)
    const ffaFallback = jsonRecordOf(battle["friendly_force_attack"]);
    const fallbackFleetInfo = jsonRecordOf(ffaFallback?.["fleet_info"]);
    const fallbackSupportHourai = jsonRecordOf(ffaFallback?.["support_hourai"]);
    if (fallbackSupportHourai?.["hougeki"]) {
      const ffShipIds = nullableNumberArray(fallbackFleetInfo?.["ship_id"]);
      const beforeCount = events.length;
      const rawHougeki = fallbackSupportHourai["hougeki"];
      const hougeki = jsonRecordOf(rawHougeki);
      {
        const atList = unknownArrayOf(hougeki?.["at_list"]);
        const rows = normalizeShellingRows(rawHougeki);
        const ffNowHps = nullableNumberArray(fallbackFleetInfo?.["now_hps"]);
        const ffMaxHps = nullableNumberArray(fallbackFleetInfo?.["max_hps"]);

      extractShellingEvents(rows, phaseName("FriendlyForceAttack"), {
        actorRole: "friendly_force",
        affectsHp: true,
        friendlyForceNowHps: ffNowHps,
        friendlyForceMaxHps: ffMaxHps,
      });

        if (ffShipIds.length > 0) {
        let rowEventIdx = beforeCount;
        for (let ri = 0; ri < rows.length; ri++) {
          const row = rows[ri];
          if (!row) continue;
          const at0 = safeNumber(row["at"] ?? atList[ri], -1);
          const mstId =
            at0 >= 0 && at0 < ffShipIds.length
              ? (ffShipIds[at0] ?? undefined)
              : undefined;
          const defs = unknownArrayOf(row["df"]);
          const eHpsList = unknownArrayOf(
            row["e_now_hps"] ?? row["e_nowhps"],
          );
          const defenderLimit = eHpsList.length;

          for (let di = 0; di < defs.length; di++) {
            const defenderIdx = toValidIndex(defs[di], defenderLimit);
            if (defenderIdx !== null && rowEventIdx < events.length) {
              if (mstId && Number.isFinite(mstId) && mstId > 0) {
                const event = events[rowEventIdx];
                if (event) event.attackerMstShipId = mstId;
              }
              rowEventIdx++;
            }
          }
        }
        }
      }
    }
    // Midnight phase (last)
    if (battle["midnight_hougeki"]) {
      extractShellingEvents(
        normalizeShellingRows(battle["midnight_hougeki"]),
        phaseName("MidnightHougeki"),
      );
    }
  }

  // Insert separator events between phase transitions so the right panel and SVG chart align.
  const withSeps: TimelineEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    const previous = i > 0 ? events[i - 1] : undefined;
    if (previous && previous.phase !== ev.phase) {
      withSeps.push({
        phase: previous.phase,
        type: "separator",
        actorRole: "main",
        affectsHp: false,
        attackerSide: "friend",
        attackerIdx: null,
        attackerGroup: [],
        defenderSide: "enemy",
        defenderIdx: null,
        damage: 0,
        crit: false,
        sunk: false,
        slotItems: [],
        fHps: ev.fHps,
        eHps: ev.eHps,
        separator: true,
      });
    }
    withSeps.push(ev);
  }
  return withSeps;
}

export function buildInitialHps(battle: Record<string, unknown>): {
  fInit: Array<number | null>;
  eInit: Array<number | null>;
} {
  const fInit = nullableNumberArray(
    battle["f_nowhps"] ?? battle["midnight_f_nowhps"],
  );
  const eInit = nullableNumberArray(
    battle["e_nowhps"] ?? battle["midnight_e_nowhps"],
  );
  return { fInit, eInit };
}

// ── SVG Renderer ──────────────────────────────────────────────────────────

function buildSteps(
  events: TimelineEvent[],
  fInit: Array<number | null>,
  eInit: Array<number | null>,
): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const fHpsCurrent = fInit.length > 0 ? [...fInit] : [];
  const eHpsCurrent = eInit.length > 0 ? [...eInit] : [];
  steps.push({
    fHps: [...fHpsCurrent],
    eHps: [...eHpsCurrent],
    eventIdx: -1,
  });
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    if (ev.affectsHp === false) {
      steps.push({
        fHps: [...fHpsCurrent],
        eHps: [...eHpsCurrent],
        eventIdx: i,
      });
      continue;
    }
    if (ev.defenderSide === "friend" && ev.defenderIdx !== null) {
      const current = fHpsCurrent[ev.defenderIdx];
      if (current !== null && current !== undefined) {
        fHpsCurrent[ev.defenderIdx] = Math.max(0, current - ev.damage);
      }
    } else if (ev.defenderSide === "enemy" && ev.defenderIdx !== null) {
      const current = eHpsCurrent[ev.defenderIdx];
      if (current !== null && current !== undefined) {
        eHpsCurrent[ev.defenderIdx] = Math.max(0, current - ev.damage);
      }
    }
    steps.push({
      fHps: [...fHpsCurrent],
      eHps: [...eHpsCurrent],
      eventIdx: i,
    });
  }
  return steps;
}

function buildPhaseRegions(events: TimelineEvent[]): Array<{
  phase: string;
  start: number;
  end: number;
}> {
  const regions: Array<{ phase: string; start: number; end: number }> = [];
  let ph = "";
  let phStart = 0;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;
    if (event.phase !== ph) {
      if (ph !== "") regions.push({ phase: ph, start: phStart, end: i });
      ph = event.phase;
      phStart = i;
    }
  }
  if (ph !== "")
    regions.push({ phase: ph, start: phStart, end: events.length });
  return regions;
}

function renderShipLine(
  side: "friend" | "enemy",
  si: number,
  hpKey: "fHps" | "eHps",
  colors: string[],
  dashed: boolean,
  steps: TimelineStep[],
  fInit: Array<number | null>,
  eInit: Array<number | null>,
  fleets: BattleFleets | null,
): string {
  const ship = (
    side === "friend" ? fleets?.friendlyShips : fleets?.enemyShips
  )?.[si];
  const initArr = side === "friend" ? fInit : eInit;
  const initHp = initArr[si];
  const maxHp = ship?.maxhp ?? initHp ?? null;
  if (initHp === null || initHp === undefined || maxHp === null || maxHp <= 0) {
    return "";
  }
  const color = colors[si % colors.length];

  const points = steps.map((step, s) => {
    const hp = step[hpKey][si];
    if (hp === null || hp === undefined) return null;
    const pct = Math.min(100, (hp / maxHp) * 100);
    return { x: Number(xHP(pct)), y: Number(yStep(s)) };
  });

  const p0 = points.find((point) => point !== null) ?? null;
  const pLast = [...points].reverse().find((point) => point !== null) ?? null;
  if (!p0 || !pLast) return "";

  // Build path: upward stem → diagonal/vertical segments → downward stem
  let d =
    `M ${p0.x.toFixed(1)} ${(p0.y - EXTEND).toFixed(1)}` +
    ` L ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`;

  for (let p = 1; p < points.length; p++) {
    const prev = points[p - 1];
    const curr = points[p];
    if (!prev || !curr) continue;
    const dx = Math.abs(curr.x - prev.x);
    if (dx < 0.1) {
      d += ` L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    } else {
      const diagDy = Math.min((dx * ROW_H) / INNER_W, ROW_H);
      const midY = (prev.y + diagDy).toFixed(1);
      d += ` L ${curr.x.toFixed(1)} ${midY} L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }
  }

  // Downward stem at end (symmetric with upward stem at start)
  const endX = pLast.x;
  const endY = pLast.y + EXTEND;
  d += ` L ${endX.toFixed(1)} ${endY.toFixed(1)}`;

  const dashAttr = dashed ? `stroke-dasharray="6,2"` : "";
  let svg = `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" ${dashAttr} opacity="0.9"/>`;

  // Start dot
  const initPct = Math.min(100, (initHp / maxHp) * 100);
  svg += `<circle cx="${xHP(initPct)}" cy="${(Number(yStep(0)) - EXTEND).toFixed(1)}" r="3" fill="${color}" opacity="0.9"/>`;

  // End marker
  const lastStep = steps[steps.length - 1];
  const lastHp = lastStep?.[hpKey][si] ?? null;
  if (lastHp !== null && lastHp !== undefined && lastHp <= 0) {
    const r = 3.5;
    svg +=
      `<line x1="${(endX - r).toFixed(1)}" y1="${(endY - r).toFixed(1)}" x2="${(endX + r).toFixed(1)}" y2="${(endY + r).toFixed(1)}" stroke="${color}" stroke-width="2"/>` +
      `<line x1="${(endX + r).toFixed(1)}" y1="${(endY - r).toFixed(1)}" x2="${(endX - r).toFixed(1)}" y2="${(endY + r).toFixed(1)}" stroke="${color}" stroke-width="2"/>`;
  } else {
    svg += `<circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="3" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
  }

  return svg;
}

function renderLegendRow(
  side: "friend" | "enemy",
  count: number,
  colors: string[],
  dashed: boolean,
  fleets: BattleFleets | null,
): string {
  const sideLabel = side === "friend" ? "味方" : "敵";
  const textCls = side === "friend" ? "text-info" : "text-error";
  let row = `<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5"><span class="text-[10px] font-bold ${textCls} w-7 shrink-0">${sideLabel}</span>`;
  for (let si = 0; si < count; si++) {
    const name = shipNameFromIndex(side, si, fleets);
    const color = colors[si % colors.length];
    const short = name.length > 6 ? name.slice(0, 5) + "…" : name;
    const lineSvg = dashed
      ? `<svg width="16" height="4" style="vertical-align:middle;"><line x1="0" y1="2" x2="16" y2="2" stroke="${color}" stroke-width="2" stroke-dasharray="5,2"/></svg>`
      : `<span style="display:inline-block;width:16px;height:2px;background:${color};border-radius:1px;vertical-align:middle;"></span>`;
    row += `<span class="inline-flex items-center gap-0.5 text-[10px]">${lineSvg}${si + 1}番 ${escHtml(short)}</span>`;
  }
  row += `</div>`;
  return row;
}

export function renderTimelineView(
  battle: Record<string, unknown>,
  fleets: BattleFleets | null,
  mstSlotItemById: Map<number, MstSlotItemRecord> | null = null,
): string {
  const events = buildTimelineEvents(battle, fleets);
  const { fInit, eInit } = buildInitialHps(battle);
  const steps = buildSteps(events, fInit, eInit);

  const fCount = fleets?.friendlyShips?.length || fInit.length || 6;
  const eCount = fleets?.enemyShips?.length || eInit.length || 6;

  const chartH = PAD_TOP + steps.length * ROW_H + PAD_BOT;

  // ── Zone backgrounds ──────────────────────────────────────────────
  let zoneBgs = "";
  for (const z of DAMAGE_ZONES) {
    const x = xHP(z.from);
    const w = (((z.to - z.from) / 100) * INNER_W).toFixed(1);
    zoneBgs += `<rect x="${x}" y="${PAD_TOP}" width="${w}" height="${steps.length * ROW_H}" fill="${z.fill}" opacity="0.06"/>`;
  }

  // ── X-axis grid + labels ──────────────────────────────────────────
  let xAxis = "";
  for (const pct of [0, 25, 50, 75, 100]) {
    const x = xHP(pct);
    const heavy = pct === 0 || pct === 100;
    xAxis += `<line x1="${x}" y1="${PAD_TOP}" x2="${x}" y2="${(PAD_TOP + steps.length * ROW_H).toFixed(1)}" stroke="currentColor" stroke-width="${heavy ? 0.7 : 0.4}" opacity="${heavy ? 0.25 : 0.15}"/>`;
    xAxis += `<text x="${x}" y="${(PAD_TOP - 9).toFixed(1)}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.5">${pct}%</text>`;
  }
  for (const z of DAMAGE_ZONES) {
    if (!z.label) continue;
    const mx = xHP((z.from + z.to) / 2);
    xAxis += `<text x="${mx}" y="${(PAD_TOP - 1).toFixed(1)}" text-anchor="middle" font-size="7" fill="${z.fill}" opacity="0.65">${z.label}</text>`;
  }

  // ── Horizontal step guides ────────────────────────────────────────
  let guides = "";
  for (let s = 0; s < steps.length; s++) {
    const y = yStep(s);
    guides += `<line x1="${PAD_L}" y1="${y}" x2="${(CHART_W - PAD_R).toFixed(1)}" y2="${y}" stroke="currentColor" stroke-width="0.3" opacity="0.07"/>`;
  }

  // ── Phase boundaries + night-battle background ────────────────────
  const phaseRegions = buildPhaseRegions(events);
  let phaseBounds = "";
  let nightBg = "";
  for (let ri = 0; ri < phaseRegions.length; ri++) {
    const reg = phaseRegions[ri];
    if (!reg) continue;
    const isNight = reg.phase === "夜戦";
    if (isNight) {
      const nyY = (PAD_TOP + reg.start * ROW_H).toFixed(1);
      const nyH = ((reg.end - reg.start) * ROW_H).toFixed(1);
      nightBg += `<rect x="${PAD_L}" y="${nyY}" width="${INNER_W}" height="${nyH}" fill="#818cf8" opacity="0.07"/>`;
    }
    if (ri > 0) {
      const yB = (PAD_TOP + reg.start * ROW_H).toFixed(1);
      const lnColor = isNight ? "#818cf8" : "#94a3b8";
      const lnDash = isNight
        ? `stroke-dasharray="3,3"`
        : `stroke-dasharray="4,3"`;
      phaseBounds += `<line x1="${PAD_L}" y1="${yB}" x2="${(CHART_W - PAD_R).toFixed(1)}" y2="${yB}" stroke="${lnColor}" stroke-width="${isNight ? 1.2 : 1}" opacity="0.6" ${lnDash}/>`;
      phaseBounds += `<text x="${(PAD_L + 3).toFixed(1)}" y="${(Number(yB) + 9).toFixed(1)}" font-size="8" fill="${lnColor}" opacity="0.75">${escHtml(reg.phase)}</text>`;
    }
  }

  // ── Ship polylines ────────────────────────────────────────────────
  let lines = "";
  for (let si = 0; si < fCount; si++) {
    lines += renderShipLine(
      "friend",
      si,
      "fHps",
      FRIEND_COLORS,
      false,
      steps,
      fInit,
      eInit,
      fleets,
    );
  }
  for (let si = 0; si < eCount; si++) {
    lines += renderShipLine(
      "enemy",
      si,
      "eHps",
      ENEMY_COLORS,
      true,
      steps,
      fInit,
      eInit,
      fleets,
    );
  }

  // ── Hover bands, anchors, bridge lines ────────────────────────────
  let chartBands = "";
  let bridgeLines = "";
  let chartAnchors = "";
  const bridgeW = 34;

  for (let i = 0; i < events.length; i++) {
    const yCenter = Number(yStep(i));
    const ev = events[i];
    if (!ev) continue;

    if (ev.defenderIdx !== null) {
      const hpKey: "fHps" | "eHps" =
        ev.defenderSide === "friend" ? "fHps" : "eHps";
      const ship = (
        ev.defenderSide === "friend"
          ? fleets?.friendlyShips
          : fleets?.enemyShips
      )?.[ev.defenderIdx];
      const initArr = ev.defenderSide === "friend" ? fInit : eInit;
      const initHp = initArr[ev.defenderIdx];
      const maxHp = ship?.maxhp ?? initHp ?? null;
      const hpFrom = steps[i]?.[hpKey]?.[ev.defenderIdx] ?? null;
      const hpTo = steps[i + 1]?.[hpKey]?.[ev.defenderIdx] ?? null;
      if (
        initHp === null ||
        initHp === undefined ||
        maxHp === null ||
        maxHp <= 0 ||
        hpFrom === null ||
        hpFrom === undefined ||
        hpTo === null ||
        hpTo === undefined
      ) {
        continue;
      }
      const xFrom = Number(xHP(Math.min(100, (hpFrom / maxHp) * 100)));
      const xTo = Number(xHP(Math.min(100, (hpTo / maxHp) * 100)));
      const yFrom = Number(yStep(i));
      const dx = Math.abs(xFrom - xTo);
      if (dx >= 0.1) {
        const diagDy = Math.min((dx * ROW_H) / INNER_W, ROW_H);
        const midY = (yFrom + diagDy).toFixed(1);
        const bandD = `M ${xFrom.toFixed(1)} ${yFrom.toFixed(1)} L ${xTo.toFixed(1)} ${midY}`;
        chartBands += `<path d="${bandD}" fill="none" stroke="#3b82f6" stroke-linecap="round" stroke-linejoin="round" stroke-width="9" opacity="0" data-timeline-step="${i}" data-timeline-kind="band"/>`;
      }
    }

    chartAnchors += `<circle cx="${(CHART_W - PAD_R).toFixed(1)}" cy="${yCenter.toFixed(1)}" r="1.8" fill="#64748b" opacity="0.35" data-timeline-step="${i}" data-timeline-kind="anchor"/>`;
    bridgeLines += `<line x1="2" y1="${yCenter.toFixed(1)}" x2="${(bridgeW - 2).toFixed(1)}" y2="${yCenter.toFixed(1)}" stroke="#94a3b8" stroke-width="1" opacity="0.22" data-timeline-step="${i}" data-timeline-kind="connector"/>`;
  }

  // ── Legend ─────────────────────────────────────────────────────────
  const legendBlock = `<div class="space-y-1 mb-2 select-none">${renderLegendRow("friend", fCount, FRIEND_COLORS, false, fleets)}${renderLegendRow("enemy", eCount, ENEMY_COLORS, true, fleets)}</div>`;

  // ── Left panel (SVG chart) ────────────────────────────────────────
  const leftPanel =
    `<div class="shrink-0 select-none" style="width:${CHART_W}px;">` +
    `<svg width="${CHART_W}" height="${chartH}" style="overflow:visible;display:block;" class="text-base-content">` +
    zoneBgs +
    nightBg +
    xAxis +
    guides +
    phaseBounds +
    chartBands +
    lines +
    chartAnchors +
    `</svg></div>`;

  // ── Bridge panel ──────────────────────────────────────────────────
  const bridgePanel =
    `<div class="shrink-0" style="width:${bridgeW}px;">` +
    `<svg width="${bridgeW}" height="${chartH}" style="display:block;overflow:visible;">${bridgeLines}</svg>` +
    `</div>`;

  // ── Right panel (event list) ──────────────────────────────────────

  let rightPanel = `<div class="min-w-0 flex-1 border-l border-base-300/60 pl-3 overflow-hidden">`;
  rightPanel +=
    `<div style="height:${PAD_TOP}px;" class="flex items-end pb-1">` +
    `<span class="text-[9px] text-base-content/35 uppercase tracking-wide">攻撃者</span>` +
    `<span class="ml-auto text-[9px] text-base-content/35 uppercase tracking-wide pr-1">対象 / 結果</span>` +
    `</div>`;

  let lastPhaseEv = "";
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev) continue;
    const phaseChanged = ev.phase !== lastPhaseEv;
    if (phaseChanged) lastPhaseEv = ev.phase;

    if (ev.separator) {
      rightPanel += `<div style="height:${ROW_H}px"></div>`;
      continue;
    }

    const atkIdx = ev.attackerIdx;
    const defIdx = ev.defenderIdx;
    if (defIdx === null) continue;
    const atkGroup = Array.isArray(ev.attackerGroup) ? ev.attackerGroup : [];
    const atkGroupLabel =
      atkGroup.length > 0
        ? atkGroup.map((v) => `${v + 1}`).join("+") + "番"
        : "航空";
    const atkName =
      atkIdx !== null
        ? shipNameFromIndex(ev.attackerSide, atkIdx, fleets)
        : (ev.type === "air" || ev.type === "raigeki") && atkGroup.length > 0
          ? atkGroup
              .map((v) => shipNameFromIndex(ev.attackerSide, v, fleets))
              .join("+")
          : "-";
    const defName = shipNameFromIndex(ev.defenderSide, defIdx, fleets);
    const atkLabel =
      atkIdx !== null
        ? `${atkIdx + 1}番`
        : (ev.type === "air" || ev.type === "raigeki") && atkGroup.length > 0
          ? atkGroupLabel
          : "?";
    const defLabel = `${defIdx + 1}番`;
    const atkShort = atkName.length > 6 ? atkName.slice(0, 5) + "…" : atkName;
    const defShort = defName.length > 6 ? defName.slice(0, 5) + "…" : defName;
    const atkColor = ev.attackerSide === "friend" ? "#3b82f6" : "#ef4444";
    const defColor = ev.defenderSide === "friend" ? "#3b82f6" : "#ef4444";

    const dmgHtml =
      ev.damage > 0
        ? ev.crit
          ? `<span class="font-mono font-bold text-[12px] tabular-nums" style="color:#f97316;min-width:52px;display:inline-block;text-align:right">-${ev.damage}</span>`
          : `<span class="font-mono font-semibold text-[11px] tabular-nums" style="color:${defColor};min-width:52px;display:inline-block;text-align:right">-${ev.damage}</span>`
        : `<span class="font-mono text-[9px] text-base-content/30" style="min-width:52px;display:inline-block;text-align:right">MISS</span>`;

    const ciItems = Array.isArray(ev.slotItems)
      ? ev.slotItems.filter((id) => Number(id) > 0).slice(0, 3)
      : [];
    const ciText =
      ciItems.length > 0
        ? `<span class="inline-flex shrink-0 items-center gap-0.5 text-[9px]">${renderEquipmentBadgesFromSlotIds(ciItems, mstSlotItemById)}</span>`
        : "";

    const topBorder =
      phaseChanged && i > 0
        ? "border-t-2 border-t-slate-400/45"
        : "border-t border-t-base-300/20";

    rightPanel +=
      `<div class="flex items-center gap-1.5 ${topBorder} transition-all duration-100 min-w-0" style="height:${ROW_H}px;overflow:hidden;" data-timeline-step="${i}" data-timeline-kind="row" onmouseenter="setTimelineStepHover(${i})" onmouseleave="setTimelineStepHover(null)">` +
      `<span class="shrink-0 font-bold text-[10px] tabular-nums" style="color:${atkColor}">${atkLabel}</span>` +
      `<span class="shrink-0 text-[9px] opacity-55 w-11 truncate">${escHtml(atkShort)}</span>` +
      `<span class="text-[9px] text-base-content/30 shrink-0">→</span>` +
      `<span class="shrink-0 font-bold text-[10px] tabular-nums" style="color:${defColor}">${defLabel}</span>` +
      `<span class="shrink-0 text-[9px] opacity-55 w-11 truncate">${escHtml(defShort)}</span>` +
      dmgHtml +
      ciText +
      `</div>`;
  }

  if (events.length === 0) {
    rightPanel += `<div class="py-4 text-xs text-base-content/40">詳細イベントなし</div>`;
  }
  rightPanel += `</div>`;

  return `<div class="overflow-hidden">${legendBlock}<div class="flex gap-0">${leftPanel}${bridgePanel}${rightPanel}</div></div>`;
}

// ── Hover interaction (to be bound to window) ─────────────────────────────

export function setTimelineStepHover(stepIdx: number | null): void {
  const timelineContent = document.getElementById("timeline-content");
  if (!timelineContent) return;

  const normalized = Number.isInteger(stepIdx) ? stepIdx : null;
  const nodes = Array.from(
    timelineContent.querySelectorAll("[data-timeline-step]"),
  );
  for (const el of nodes) {
    const htmlEl = el as HTMLElement;
    const elStep = Number(htmlEl.getAttribute("data-timeline-step"));
    const kind = htmlEl.getAttribute("data-timeline-kind") || "";
    const active = normalized !== null && elStep === normalized;

    if (kind === "row") {
      htmlEl.style.backgroundColor = active ? "rgba(59, 130, 246, 0.08)" : "";
      htmlEl.style.transform = active ? "translateX(2px)" : "";
    } else if (kind === "connector") {
      htmlEl.style.opacity = active ? "0.9" : "0.22";
      htmlEl.style.strokeWidth = active ? "2.2" : "1";
    } else if (kind === "anchor") {
      htmlEl.style.opacity = active ? "1" : "0.35";
      htmlEl.style.r = active ? "3.2" : "1.8";
    } else if (kind === "band") {
      htmlEl.style.opacity = active ? "0.45" : "0";
      htmlEl.style.strokeWidth = active ? "9" : "8";
    }
  }
}

export function switchPhaseView(mode: "phase" | "timeline"): void {
  const phaseView = document.getElementById("phase-view");
  const timelineView = document.getElementById("timeline-view");
  const btnPhase = document.getElementById("btn-phase-view");
  const btnTimeline = document.getElementById("btn-timeline-view");
  if (mode === "timeline") {
    phaseView?.classList.add("hidden");
    timelineView?.classList.remove("hidden");
    btnPhase?.classList.remove("btn-active");
    btnTimeline?.classList.add("btn-active");
  } else {
    phaseView?.classList.remove("hidden");
    timelineView?.classList.add("hidden");
    btnPhase?.classList.add("btn-active");
    btnTimeline?.classList.remove("btn-active");
  }
}
