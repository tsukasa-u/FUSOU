// ── Parser for raw KanColle API responses (port, require_info, getData) ──
//
// Converts raw API JSON (with api_* prefixed keys) into the snapshot format
// consumed by applyFleetSnapshot() (abbreviated keys: s3s, s8s, d8k) and
// the master data format consumed by loadMasterDataFromJson().

// ── Type detection ──

export type ApiResponseKind = "port" | "requireInfo" | "getData" | "exportedFleet" | "unknown";

/**
 * Strip the `svdata=` prefix that the game server prepends to JSON responses.
 */
export function stripSvdataPrefix(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("svdata=")) {
    return trimmed.slice(7);
  }
  return trimmed;
}

/**
 * Detect which API response type a parsed JSON object represents.
 */
export function detectResponseKind(json: Record<string, unknown>): ApiResponseKind {
  const data = recordOf(json["api_data"] ?? json) ?? {};

  // getData: has master data arrays
  if (data["api_mst_ship"] || data["api_mst_slotitem"]) {
    return "getData";
  }

  // port: has ship instances + deck compositions
  if (data["api_ship"] && data["api_deck_port"]) {
    return "port";
  }

  // require_info: has equipment instances
  if (data["api_slot_item"] && !data["api_ship"]) {
    return "requireInfo";
  }

  // exportedFleet: FUSOU internal format
  if (json["v"] === 2 && (json["fleet1"] || json["fleet2"])) {
    return "exportedFleet";
  }

  return "unknown";
}

// ── Port response → Snapshot format ──

interface ApiShipRaw {
  api_id: number;
  api_ship_id: number;
  api_lv: number;
  api_exp: number[];
  api_soku: number;
  api_leng: number;
  api_slot: number[];
  api_onslot: number[];
  api_slot_ex: number;
  api_slotnum: number;
  api_cond: number;
  api_karyoku: number[];
  api_raisou: number[];
  api_taiku: number[];
  api_soukou: number[];
  api_kaihi: number[];
  api_taisen: number[];
  api_sakuteki: number[];
  api_lucky: number[];
  api_sally_area?: number;
  api_sp_effect_items?: { api_kind: number; api_raig?: number; api_souk?: number; api_houg?: number; api_kaih?: number }[];
}

interface ApiDeckPortRaw {
  api_id: number;
  api_name: string;
  api_mission: number[];
  api_ship: number[];
}

interface ApiSlotItemRaw {
  api_id: number;
  api_slotitem_id: number;
  api_locked: number;
  api_level: number;
  api_alv?: number;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return isJsonRecord(value) ? value : null;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = recordOf(item);
        return record ? [record] : [];
      })
    : [];
}

function numberOf(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = numberOf(value, Number.NaN);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function numberArrayOf(value: unknown): number[] {
  return Array.isArray(value) ? value.map((item) => numberOf(item)) : [];
}

function isFiniteNumberArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => Number.isFinite(numberOf(item, Number.NaN)))
  );
}

function parseApiShip(record: Record<string, unknown>): ApiShipRaw | null {
  const apiId = positiveIntegerOrNull(record["api_id"]);
  const apiShipId = positiveIntegerOrNull(record["api_ship_id"]);
  const apiLevel = positiveIntegerOrNull(record["api_lv"]);
  if (apiId === null || apiShipId === null || apiLevel === null) return null;

  const statArrayFields = [
    "api_exp",
    "api_karyoku",
    "api_raisou",
    "api_taiku",
    "api_soukou",
    "api_kaihi",
    "api_taisen",
    "api_sakuteki",
    "api_lucky",
  ] as const;
  if (
    statArrayFields.some(
      (field) =>
        record[field] !== undefined && !isFiniteNumberArray(record[field]),
    )
  ) {
    return null;
  }

  const result: ApiShipRaw = {
    api_id: apiId,
    api_ship_id: apiShipId,
    api_lv: apiLevel,
    api_exp: numberArrayOf(record["api_exp"]),
    api_soku: numberOf(record["api_soku"]),
    api_leng: numberOf(record["api_leng"]),
    api_slot: numberArrayOf(record["api_slot"]),
    api_onslot: numberArrayOf(record["api_onslot"]),
    api_slot_ex: numberOf(record["api_slot_ex"]),
    api_slotnum: numberOf(record["api_slotnum"]),
    api_cond: numberOf(record["api_cond"]),
    api_karyoku: numberArrayOf(record["api_karyoku"]),
    api_raisou: numberArrayOf(record["api_raisou"]),
    api_taiku: numberArrayOf(record["api_taiku"]),
    api_soukou: numberArrayOf(record["api_soukou"]),
    api_kaihi: numberArrayOf(record["api_kaihi"]),
    api_taisen: numberArrayOf(record["api_taisen"]),
    api_sakuteki: numberArrayOf(record["api_sakuteki"]),
    api_lucky: numberArrayOf(record["api_lucky"]),
  };
  const sallyArea = numberOf(record["api_sally_area"], Number.NaN);
  if (Number.isFinite(sallyArea)) result.api_sally_area = sallyArea;

  const specialEffects = recordsOf(record["api_sp_effect_items"]).map((item) => {
    const effect: {
      api_kind: number;
      api_raig?: number;
      api_souk?: number;
      api_houg?: number;
      api_kaih?: number;
    } = { api_kind: numberOf(item["api_kind"]) };
    for (const [key, source] of [
      ["api_raig", "api_raig"],
      ["api_souk", "api_souk"],
      ["api_houg", "api_houg"],
      ["api_kaih", "api_kaih"],
    ] as const) {
      const value = numberOf(item[source], Number.NaN);
      if (Number.isFinite(value)) effect[key] = value;
    }
    return effect;
  });
  if (specialEffects.length > 0) result.api_sp_effect_items = specialEffects;
  return result;
}

function parseApiDeckPort(record: Record<string, unknown>): ApiDeckPortRaw | null {
  const apiId = positiveIntegerOrNull(record["api_id"]);
  if (apiId === null || !Array.isArray(record["api_ship"])) return null;

  return {
    api_id: apiId,
    api_name: typeof record["api_name"] === "string" ? record["api_name"] : "",
    api_mission: numberArrayOf(record["api_mission"]),
    api_ship: numberArrayOf(record["api_ship"]),
  };
}

function parseApiSlotItem(record: Record<string, unknown>): ApiSlotItemRaw | null {
  const apiId = positiveIntegerOrNull(record["api_id"]);
  const apiSlotItemId = positiveIntegerOrNull(record["api_slotitem_id"]);
  const apiLevel = numberOf(record["api_level"], Number.NaN);
  if (
    apiId === null ||
    apiSlotItemId === null ||
    !Number.isFinite(apiLevel)
  ) {
    return null;
  }

  const alv = numberOf(record["api_alv"], Number.NaN);
  return {
    api_id: apiId,
    api_slotitem_id: apiSlotItemId,
    api_locked: numberOf(record["api_locked"]),
    api_level: apiLevel,
    ...(Number.isFinite(alv) ? { api_alv: alv } : {}),
  };
}

/**
 * Convert a raw `api_port/port` response into the snapshot format (s3s, d8k).
 * Returns ships and deck ports; slot items must come from require_info.
 */
export function convertPortToSnapshot(portJson: Record<string, unknown>): {
  s3s: Record<string, unknown>[];
  d8k: Record<string, unknown>[];
  combinedFlag?: number;
} {
  const data = recordOf(portJson["api_data"] ?? portJson) ?? {};
  const rawShips = recordsOf(data["api_ship"]).flatMap((record) => {
    const parsed = parseApiShip(record);
    return parsed ? [parsed] : [];
  });
  const rawDeckPorts = recordsOf(data["api_deck_port"]).flatMap((record) => {
    const parsed = parseApiDeckPort(record);
    return parsed ? [parsed] : [];
  });
  const combinedFlagValue = numberOf(data["api_combined_flag"], Number.NaN);
  const combinedFlag = Number.isFinite(combinedFlagValue)
    ? combinedFlagValue
    : undefined;

  const s3s = rawShips.map((ship) => ({
    i0d: ship.api_id,
    s5d: ship.api_ship_id,
    l0v: ship.api_lv,
    e1p: ship.api_exp?.[0] ?? null,
    s2u: ship.api_soku,
    l2g: ship.api_leng,
    s2t: ship.api_slot,
    o4t: ship.api_onslot,
    s5x: ship.api_slot_ex,
    s5m: ship.api_slotnum,
    c2d: ship.api_cond,
    k5u: ship.api_karyoku?.[0] ?? null,
    r4u: ship.api_raisou?.[0] ?? null,
    t3u: ship.api_taiku?.[0] ?? null,
    s4u: ship.api_soukou?.[0] ?? null,
    k3i: ship.api_kaihi?.[0] ?? null,
    t4n: ship.api_taisen?.[0] ?? null,
    s6i: ship.api_sakuteki?.[0] ?? null,
    l3y: ship.api_lucky?.[0] ?? null,
    s8a: ship.api_sally_area ?? null,
    s13s: ship.api_sp_effect_items?.map((item) => ({
      k2d: item.api_kind,
      r2g: item.api_raig ?? null,
      s2k: item.api_souk ?? null,
      h2g: item.api_houg ?? null,
      k2h: item.api_kaih ?? null,
    })) ?? null,
  }));

  const d8k = rawDeckPorts.map((dp) => ({
    i0d: dp.api_id,
    n2e: dp.api_name,
    s3s: dp.api_ship,
  }));

  return combinedFlag === undefined
    ? { s3s, d8k }
    : { s3s, d8k, combinedFlag };
}

/**
 * Convert a raw `api_get_member/require_info` response equipment list
 * into the snapshot format (s8s).
 */
export function convertRequireInfoToSnapshot(reqJson: Record<string, unknown>): {
  s8s: Record<string, unknown>[];
} {
  const data = recordOf(reqJson["api_data"] ?? reqJson) ?? {};
  const rawItems = recordsOf(data["api_slot_item"]).flatMap((record) => {
    const parsed = parseApiSlotItem(record);
    return parsed ? [parsed] : [];
  });

  const s8s = rawItems.map((item) => ({
    i0d: item.api_id,
    s9d: item.api_slotitem_id,
    l3l: item.api_level,
    a1v: item.api_alv ?? null,
  }));

  return { s8s };
}

/**
 * Convert a raw `api_start2/getData` response into the master data format
 * expected by loadMasterDataFromJson().
 *
 * The simulator expects field names without the `api_` / `api_mst_` prefix
 * (e.g. `id`, `name`, `stype`) while the raw API uses `api_id`, `api_name`, etc.
 */
export function convertGetDataToMasterData(json: Record<string, unknown>): Record<string, unknown> {
  const data = recordOf(json["api_data"] ?? json) ?? {};
  const result: Record<string, unknown> = {};

  // ── Ships ──
  if (Array.isArray(data["api_mst_ship"])) {
    result["mst_ships"] = recordsOf(data["api_mst_ship"]).flatMap((s) => {
      const id = positiveIntegerOrNull(s["api_id"]);
      return id === null
        ? []
        : [{
      id,
      sortno: s["api_sortno"] ?? null,
      sort_id: s["api_sort_id"] ?? 0,
      name: s["api_name"],
      yomi: s["api_yomi"],
      stype: s["api_stype"],
      ctype: s["api_ctype"],
      afterlv: s["api_afterlv"] ?? null,
      aftershipid: s["api_aftershipid"] ?? null,
      taik: s["api_taik"] ?? null,
      souk: s["api_souk"] ?? null,
      houg: s["api_houg"] ?? null,
      raig: s["api_raig"] ?? null,
      tyku: s["api_tyku"] ?? null,
      tais: s["api_tais"] ?? null,
      kaih: s["api_kaih"] ?? s["api_houk"] ?? null,
      saku: s["api_saku"] ?? s["api_sakuteki"] ?? null,
      luck: s["api_luck"] ?? null,
      soku: s["api_soku"] ?? 0,
      leng: s["api_leng"] ?? 0,
      slot_num: s["api_slot_num"] ?? 0,
      maxeq: s["api_maxeq"] ?? null,
      buildtime: s["api_buildtime"] ?? null,
      broken: s["api_broken"] ?? null,
      powup: s["api_powup"] ?? null,
      backs: s["api_backs"] ?? null,
      getmes: s["api_getmes"] ?? null,
      afterfuel: s["api_afterfuel"] ?? null,
      afterbull: s["api_afterbull"] ?? null,
      fuel_max: s["api_fuel_max"] ?? null,
      bull_max: s["api_bull_max"] ?? null,
      voicef: s["api_voicef"] ?? null,
    }];
    });
  }

  // ── Slot items (equipment) ──
  if (Array.isArray(data["api_mst_slotitem"])) {
    result["mst_slot_items"] = recordsOf(data["api_mst_slotitem"]).map((s) => {
      const id = positiveIntegerOrNull(s["api_id"]);
      const apiType = numberArrayOf(s["api_type"]);
      if (id === null || apiType.length === 0) return null;
      let houm = numberOf(s["api_houm"]);
      let houk = numberOf(s["api_houk"]);
      let geigeki = 0;
      let taibaku = 0;

      // type[2] == 48: repurpose houk → geigeki (迎撃), houm → taibaku (対爆)
      if (apiType && apiType[2] === 48) {
        geigeki = houk;
        houk = 0;
        taibaku = houm;
        houm = 0;
      }

      return {
        id,
        sortno: s["api_sortno"] ?? 0,
        name: s["api_name"],
        type: apiType,
        taik: s["api_taik"] ?? 0,
        souk: s["api_souk"] ?? 0,
        houg: s["api_houg"] ?? 0,
        raig: s["api_raig"] ?? 0,
        soku: s["api_soku"] ?? 0,
        baku: s["api_baku"] ?? 0,
        tyku: s["api_tyku"] ?? 0,
        tais: s["api_tais"] ?? 0,
        atap: s["api_atap"] ?? 0,
        houm,
        raim: s["api_raim"] ?? 0,
        houk,
        raik: s["api_raik"] ?? 0,
        bakk: s["api_bakk"] ?? 0,
        saku: s["api_saku"] ?? 0,
        sakb: s["api_sakb"] ?? 0,
        luck: s["api_luck"] ?? 0,
        leng: s["api_leng"] ?? 0,
        rare: s["api_rare"] ?? 0,
        geigeki,
        taibaku,
        broken: s["api_broken"] ?? [],
        usebull: s["api_usebull"] ?? "",
        version: s["api_version"] ?? null,
        cost: s["api_cost"] ?? null,
        distance: s["api_distance"] ?? null,
      };
    }).filter((item) => item !== null);
  }

  // ── Ship types ──
  if (Array.isArray(data["api_mst_stype"])) {
    result["mst_stypes"] = recordsOf(data["api_mst_stype"]).flatMap((s) => {
      const id = positiveIntegerOrNull(s["api_id"]);
      return id === null
        ? []
        : [{
      id,
      sortno: s["api_sortno"] ?? 0,
      name: s["api_name"],
      equip_type: s["api_equip_type"] ?? {},
    }];
    });
  }

  // ── Equipment type names ──
  if (Array.isArray(data["api_mst_slotitem_equiptype"])) {
    result["mst_slotitem_equiptypes"] = recordsOf(data["api_mst_slotitem_equiptype"]).flatMap((s) => {
      const id = positiveIntegerOrNull(s["api_id"]);
      return id === null
        ? []
        : [{
      id,
      name: s["api_name"],
    }];
    });
  }

  // ── Equipment compatibility per ship ──
  if (Array.isArray(data["api_mst_equip_ship"])) {
    result["mst_equip_ships"] = recordsOf(data["api_mst_equip_ship"]).flatMap((s) => {
      const shipId = positiveIntegerOrNull(s["api_ship_id"]);
      return shipId === null
        ? []
        : [{
      ship_id: shipId,
      equip_type: s["api_equip_type"] ?? {},
    }];
    });
  }

  // ── Exslot equipment IDs ──
  const exslotData = recordOf(data["api_mst_equip_exslot"]);
  if (exslotData) {
    const raw = exslotData;
    const arr: { equip: number }[] = [];
    for (const [k, _v] of Object.entries(raw)) {
      arr.push({ equip: Number(k) });
    }
    result["mst_equip_exslots"] = arr;
  }

  // ── Exslot ship restrictions ──
  const exslotShipData = recordOf(data["api_mst_equip_exslot_ship"]);
  if (exslotShipData) {
    const raw = exslotShipData;
    const arr: Record<string, unknown>[] = [];
    for (const [k, v] of Object.entries(raw)) {
      const entry = recordOf(v);
      if (entry) {
        arr.push({
          slotitem_id: Number(k),
          ship_ids: entry["api_ship_ids"] ?? null,
          stypes: entry["api_stypes"] ?? null,
          ctypes: entry["api_ctypes"] ?? null,
          req_level: entry["api_req_level"] ?? 0,
        });
      }
    }
    result["mst_equip_exslot_ships"] = arr;
  }

  // ── Per-ship exslot equipment limits ──
  // api_mst_equip_limit_exslot: HashMap<ship_id, equip_id[]>
  const exslotLimitData = recordOf(data["api_mst_equip_limit_exslot"]);
  if (exslotLimitData) {
    const raw = exslotLimitData;
    const arr: Array<{ ship_id: number; equip: number[] }> = [];
    for (const [shipIdStr, equipList] of Object.entries(raw)) {
      const shipId = Number(shipIdStr);
      if (!Number.isFinite(shipId)) continue;
      if (!Array.isArray(equipList)) continue;

      const equipIds = equipList
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));

      arr.push({ ship_id: shipId, equip: equipIds });
    }
    result["mst_equip_limit_exslots"] = arr;
  }

  return result;
}

/**
 * Merge port snapshot (s3s, d8k) with require_info snapshot (s8s)
 * into a complete snapshot for applyFleetSnapshot().
 */
export function mergeSnapshots(
  port: { s3s: Record<string, unknown>[]; d8k: Record<string, unknown>[]; combinedFlag?: number },
  requireInfo: { s8s: Record<string, unknown>[] },
): Record<string, unknown> {
  return {
    s3s: port.s3s,
    s8s: requireInfo.s8s,
    d8k: port.d8k,
    c11g: port.combinedFlag ?? null,
  };
}
