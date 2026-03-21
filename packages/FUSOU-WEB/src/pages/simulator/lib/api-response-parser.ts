// ── Parser for raw KanColle API responses (port, require_info, getData) ──
//
// Converts raw API JSON (with api_* prefixed keys) into the snapshot format
// consumed by applyFleetSnapshot() (abbreviated keys: s3s, s8s, d8k) and
// the master data format consumed by loadMasterDataFromJson().

// ── Type detection ──

export type ApiResponseKind = "port" | "requireInfo" | "getData" | "unknown";

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
  const data = (json.api_data ?? json) as Record<string, unknown>;

  // getData: has master data arrays
  if (data.api_mst_ship || data.api_mst_slotitem) {
    return "getData";
  }

  // port: has ship instances + deck compositions
  if (data.api_ship && data.api_deck_port) {
    return "port";
  }

  // require_info: has equipment instances
  if (data.api_slot_item && !data.api_ship) {
    return "requireInfo";
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

/**
 * Convert a raw `api_port/port` response into the snapshot format (s3s, d8k).
 * Returns ships and deck ports; slot items must come from require_info.
 */
export function convertPortToSnapshot(portJson: Record<string, unknown>): {
  s3s: Record<string, unknown>[];
  d8k: Record<string, unknown>[];
  combinedFlag?: number;
} {
  const data = (portJson.api_data ?? portJson) as Record<string, unknown>;
  const rawShips = (data.api_ship ?? []) as ApiShipRaw[];
  const rawDeckPorts = (data.api_deck_port ?? []) as ApiDeckPortRaw[];
  const combinedFlag = data.api_combined_flag as number | undefined;

  const s3s = rawShips.map((ship) => ({
    i0d: ship.api_id,
    s5d: ship.api_ship_id,
    l0v: ship.api_lv,
    e1p: ship.api_exp?.[0] ?? 0,
    s2u: ship.api_soku,
    l2g: ship.api_leng,
    s2t: ship.api_slot,
    o4t: ship.api_onslot,
    s5x: ship.api_slot_ex,
    s5m: ship.api_slotnum,
    c2d: ship.api_cond,
    k5u: ship.api_karyoku?.[0] ?? 0,
    r4u: ship.api_raisou?.[0] ?? 0,
    t3u: ship.api_taiku?.[0] ?? 0,
    s4u: ship.api_soukou?.[0] ?? 0,
    k3i: ship.api_kaihi?.[0] ?? 0,
    t4n: ship.api_taisen?.[0] ?? 0,
    s6i: ship.api_sakuteki?.[0] ?? 0,
    l3y: ship.api_lucky?.[0] ?? 0,
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

  return { s3s, d8k, combinedFlag: combinedFlag ?? undefined };
}

/**
 * Convert a raw `api_get_member/require_info` response equipment list
 * into the snapshot format (s8s).
 */
export function convertRequireInfoToSnapshot(reqJson: Record<string, unknown>): {
  s8s: Record<string, unknown>[];
} {
  const data = (reqJson.api_data ?? reqJson) as Record<string, unknown>;
  const rawItems = (data.api_slot_item ?? []) as ApiSlotItemRaw[];

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
  const data = (json.api_data ?? json) as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  // ── Ships ──
  if (Array.isArray(data.api_mst_ship)) {
    result.mst_ships = (data.api_mst_ship as Record<string, unknown>[]).map((s) => ({
      id: s.api_id,
      sortno: s.api_sortno ?? null,
      sort_id: s.api_sort_id ?? 0,
      name: s.api_name,
      yomi: s.api_yomi,
      stype: s.api_stype,
      ctype: s.api_ctype,
      afterlv: s.api_afterlv ?? null,
      aftershipid: s.api_aftershipid ?? null,
      taik: s.api_taik ?? null,
      souk: s.api_souk ?? null,
      houg: s.api_houg ?? null,
      raig: s.api_raig ?? null,
      tyku: s.api_tyku ?? null,
      tais: s.api_tais ?? null,
      luck: s.api_luck ?? null,
      soku: s.api_soku ?? 0,
      leng: s.api_leng ?? 0,
      slot_num: s.api_slot_num ?? 0,
      maxeq: s.api_maxeq ?? null,
      buildtime: s.api_buildtime ?? null,
      broken: s.api_broken ?? null,
      powup: s.api_powup ?? null,
      backs: s.api_backs ?? null,
      getmes: s.api_getmes ?? null,
      afterfuel: s.api_afterfuel ?? null,
      afterbull: s.api_afterbull ?? null,
      fuel_max: s.api_fuel_max ?? null,
      bull_max: s.api_bull_max ?? null,
      voicef: s.api_voicef ?? null,
    }));
  }

  // ── Slot items (equipment) ──
  if (Array.isArray(data.api_mst_slotitem)) {
    result.mst_slot_items = (data.api_mst_slotitem as Record<string, unknown>[]).map((s) => {
      const apiType = s.api_type as number[] | undefined;
      let houm = (s.api_houm as number) ?? 0;
      let houk = (s.api_houk as number) ?? 0;
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
        id: s.api_id,
        sortno: s.api_sortno ?? 0,
        name: s.api_name,
        type: apiType,
        taik: s.api_taik ?? 0,
        souk: s.api_souk ?? 0,
        houg: s.api_houg ?? 0,
        raig: s.api_raig ?? 0,
        soku: s.api_soku ?? 0,
        baku: s.api_baku ?? 0,
        tyku: s.api_tyku ?? 0,
        tais: s.api_tais ?? 0,
        atap: s.api_atap ?? 0,
        houm,
        raim: s.api_raim ?? 0,
        houk,
        raik: s.api_raik ?? 0,
        bakk: s.api_bakk ?? 0,
        saku: s.api_saku ?? 0,
        sakb: s.api_sakb ?? 0,
        luck: s.api_luck ?? 0,
        leng: s.api_leng ?? 0,
        rare: s.api_rare ?? 0,
        geigeki,
        taibaku,
        broken: s.api_broken ?? [],
        usebull: s.api_usebull ?? "",
        version: s.api_version ?? null,
        cost: s.api_cost ?? null,
        distance: s.api_distance ?? null,
      };
    });
  }

  // ── Ship types ──
  if (Array.isArray(data.api_mst_stype)) {
    result.mst_stypes = (data.api_mst_stype as Record<string, unknown>[]).map((s) => ({
      id: s.api_id,
      sortno: s.api_sortno ?? 0,
      name: s.api_name,
      equip_type: s.api_equip_type ?? {},
    }));
  }

  // ── Equipment type names ──
  if (Array.isArray(data.api_mst_slotitem_equiptype)) {
    result.mst_slotitem_equiptypes = (data.api_mst_slotitem_equiptype as Record<string, unknown>[]).map((s) => ({
      id: s.api_id,
      name: s.api_name,
    }));
  }

  // ── Equipment compatibility per ship ──
  if (Array.isArray(data.api_mst_equip_ship)) {
    result.mst_equip_ships = (data.api_mst_equip_ship as Record<string, unknown>[]).map((s) => ({
      ship_id: s.api_ship_id,
      equip_type: s.api_equip_type ?? {},
    }));
  }

  // ── Exslot equipment IDs ──
  if (data.api_mst_equip_exslot && typeof data.api_mst_equip_exslot === "object") {
    const raw = data.api_mst_equip_exslot as Record<string, unknown>;
    const arr: { equip: number }[] = [];
    for (const [k, _v] of Object.entries(raw)) {
      arr.push({ equip: Number(k) });
    }
    result.mst_equip_exslots = arr;
  }

  // ── Exslot ship restrictions ──
  if (data.api_mst_equip_exslot_ship && typeof data.api_mst_equip_exslot_ship === "object") {
    const raw = data.api_mst_equip_exslot_ship as Record<string, unknown>;
    const arr: Record<string, unknown>[] = [];
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === "object") {
        const entry = v as Record<string, unknown>;
        arr.push({
          slotitem_id: Number(k),
          ship_ids: entry.api_ship_ids ?? null,
          stypes: entry.api_stypes ?? null,
          ctypes: entry.api_ctypes ?? null,
          req_level: entry.api_req_level ?? 0,
        });
      }
    }
    result.mst_equip_exslot_ships = arr;
  }

  // ── Per-ship exslot equipment limits ──
  // api_mst_equip_limit_exslot: HashMap<ship_id, equip_id[]>
  if (data.api_mst_equip_limit_exslot && typeof data.api_mst_equip_limit_exslot === "object") {
    const raw = data.api_mst_equip_limit_exslot as Record<string, unknown>;
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
    result.mst_equip_limit_exslots = arr;
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
