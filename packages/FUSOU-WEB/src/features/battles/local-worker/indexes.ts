import type { AvroJsonRecord } from "@/features/avro/ocf-decoder";
import { battleRowIndexForSort } from "../helpers";

export type TableIndex = {
  rows: AvroJsonRecord[];
  byUuid: Map<string, number[]>;
  byEnvUuid: Map<string, number[]>;
  byIndex: Map<number, number[]>;
  byBattleId: Map<string, number[]>;
};

function addToIndex<T>(map: Map<T, number[]>, key: T, rowIndex: number): void {
  const indexes = map.get(key);
  if (indexes) {
    indexes.push(rowIndex);
  } else {
    map.set(key, [rowIndex]);
  }
}

function dedupeKey(table: string, row: AvroJsonRecord): string | null {
  const uuid = typeof row["uuid"] === "string" ? row["uuid"] : "";
  const index = typeof row["index"] === "number" ? row["index"] : null;
  if (uuid && index !== null) return `${table}\0${uuid}\0${index}`;
  return null;
}

export function buildTableIndex(
  table: string,
  sourceRows: AvroJsonRecord[],
): TableIndex {
  const rows: AvroJsonRecord[] = [];
  const seen = new Set<string>();
  const byUuid = new Map<string, number[]>();
  const byEnvUuid = new Map<string, number[]>();
  const byIndex = new Map<number, number[]>();
  const byBattleId = new Map<string, number[]>();

  for (const row of sourceRows) {
    const key = dedupeKey(table, row);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);

    const rowIndex = rows.length;
    rows.push(row);

    if (typeof row["uuid"] === "string" && row["uuid"]) {
      addToIndex(byUuid, row["uuid"], rowIndex);
    }
    if (typeof row["env_uuid"] === "string" && row["env_uuid"]) {
      addToIndex(byEnvUuid, row["env_uuid"], rowIndex);
    }
    if (
      typeof row["index"] === "number" &&
      Number.isSafeInteger(row["index"])
    ) {
      addToIndex(byIndex, row["index"], rowIndex);
    }
    for (const field of ["battle_id", "battles"]) {
      if (typeof row[field] === "string" && row[field]) {
        addToIndex(byBattleId, row[field], rowIndex);
      }
    }
  }

  return { rows, byUuid, byEnvUuid, byIndex, byBattleId };
}

export function rowsForIndexes(
  index: TableIndex,
  rowIndexes: Iterable<number>,
): AvroJsonRecord[] {
  return [...rowIndexes]
    .filter((rowIndex) => rowIndex >= 0 && rowIndex < index.rows.length)
    .flatMap((rowIndex) => {
      const row = index.rows[rowIndex];
      return row === undefined ? [] : [row];
    });
}

export function sortRowsByIndex(rows: AvroJsonRecord[]): AvroJsonRecord[] {
  return [...rows].sort(
    (left, right) =>
      battleRowIndexForSort(left["index"]) -
      battleRowIndexForSort(right["index"]),
  );
}