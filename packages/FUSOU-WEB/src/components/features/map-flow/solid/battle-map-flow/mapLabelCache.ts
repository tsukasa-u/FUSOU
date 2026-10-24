import { createSignal } from "solid-js";
import { getBattleMapAsset } from "@/data/battleMapAssets";
import { cellLabel } from "./dataUtils";

/**
 * 海域ごとの公式セルラベル（data.json の labels / ports）を共有キャッシュする。
 *
 * cell_id は海域ごとに「ルート分岐用のエイリアス ID」を含むため（例: 1-5 のボス J は 10/11/12）、
 * cell_id を単純にアルファベット変換すると誤ったマス名（K, L など）になる。
 * 一覧・ドロップなど data.json を個別に読まないタブでも正しいマス名を出すために使用する。
 */
export type MapLabelEntry = {
  labels: Record<number, string>;
  ports: number[];
};

const [labelStore, setLabelStore] = createSignal<Record<string, MapLabelEntry>>({});
const pendingLoads = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseMapLabelEntry(payload: unknown): MapLabelEntry {
  const data = isRecord(payload) ? payload : {};
  const labels: Record<number, string> = {};
  if (isRecord(data["labels"])) {
    for (const [key, value] of Object.entries(data["labels"])) {
      const id = Number(key);
      if (Number.isFinite(id) && typeof value === "string" && value.trim()) {
        labels[id] = value.trim();
      }
    }
  }
  const ports = Array.isArray(data["ports"])
    ? data["ports"].map(Number).filter(Number.isFinite)
    : [];
  return { labels, ports };
}

/** 指定海域のラベルを（未取得なら）非同期で読み込む。失敗時も再試行ループを避けるため空エントリを保存する。 */
export function ensureMapLabels(mapKey: string | null | undefined): void {
  if (!mapKey || mapKey === "unknown" || mapKey === "-") return;
  if (labelStore()[mapKey] || pendingLoads.has(mapKey)) return;
  if (typeof fetch === "undefined") return;
  const asset = getBattleMapAsset(mapKey);
  const url = asset?.dataUrl || asset?.infoUrl;
  if (!url) return;

  pendingLoads.add(mapKey);
  fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((payload: unknown) => parseMapLabelEntry(payload))
    .catch((): MapLabelEntry => ({ labels: {}, ports: [] }))
    .then((entry) => {
      setLabelStore((prev) => ({ ...prev, [mapKey]: entry }));
    })
    .finally(() => {
      pendingLoads.delete(mapKey);
    });
}

/** 複数海域をまとめて読み込む。 */
export function ensureMapLabelsFor(mapKeys: Iterable<string>): void {
  for (const mapKey of new Set(mapKeys)) ensureMapLabels(mapKey);
}

/**
 * 海域の公式ラベルでマス名を解決する（リアクティブ）。
 * ラベル未取得の間はアルファベットのフォールバック表示になる。
 */
export function resolveMapCellLabel(
  mapKey: string | null | undefined,
  cellId: number | string,
): string {
  const entry = mapKey ? labelStore()[mapKey] : undefined;
  return cellLabel(cellId, entry?.labels, entry?.ports);
}

/** テスト用: キャッシュを直接設定する。 */
export function setMapLabelsForTest(mapKey: string, entry: MapLabelEntry): void {
  setLabelStore((prev) => ({ ...prev, [mapKey]: entry }));
}
