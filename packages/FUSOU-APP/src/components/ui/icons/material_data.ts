export const item_list: { [key: number]: [string, number] } = {
  0: ["  ", 0], //  undifined
  1: ["A3", 1], //  高速修復材
  2: ["B3", 1], //  高速建造材
  3: ["C3", 1], //  開発資材
  4: ["C1", 1], //  改修資材
  5: ["UN", 0], //  undifined
  6: ["UN", 0], //  undifined
  7: ["UN", 0], //  undifined
  8: ["UN", 0], //  undifined
  9: ["UN", 0], //  undifined
  10: ["A2", 1], //  家具箱（小）
  11: ["B2", 1], //  家具箱（中）
  12: ["C2", 1], //  家具箱（大）
  13: ["UN", 0], //  undifined
  14: ["UN", 0], //  undifined
  15: ["UN", 0], //  undifined
  16: ["UN", 0], //  undifined
  17: ["UN", 0], //  undifined
  18: ["UN", 0], //  undifined
  19: ["UN", 0], //  undifined
  20: ["UN", 0], //  undifined
  21: ["UN", 0], //  undifined
  22: ["UN", 0], //  undifined
  23: ["UN", 0], //  undifined
  24: ["UN", 0], //  undifined
  25: ["UN", 0], //  undifined
  26: ["UN", 0], //  undifined
  27: ["UN", 0], //  undifined
  28: ["UN", 0], //  undifined
  29: ["UN", 0], //  undifined
  30: ["UN", 0], //  undifined
  31: ["A0", 4], //  燃料
  32: ["B0", 4], //  弾薬
  33: ["C0", 4], //  鋼材
  34: ["D0", 4], //  ボーキサイト
  35: ["UN", 0], //  undifined
  36: ["UN", 0], //  undifined
  37: ["UN", 0], //  undifined
  38: ["UN", 0], //  undifined
  39: ["UN", 0], //  undifined
  40: ["UN", 0], //  undifined
  41: ["UN", 0], //  undifined
  42: ["UN", 0], //  undifined
  43: ["UN", 0], //  undifined
  44: ["E0", 5], //  家具コイン
  45: ["UN", 0], //  undifined
  46: ["UN", 0], //  undifined
  47: ["UN", 0], //  undifined
  48: ["UN", 0], //  undifined
  49: ["D3", 1], //  ドック開放キー
  50: ["E3", 1], //  応急修理要員
  51: ["F3", 1], //  応急修理女神
  52: ["F2", 1], //  特注家具職人
  53: ["D3", 3], //  母港拡張
  54: ["D2", 1], //  給糧艦「間宮」
  55: ["A1", 1], //  書類一式＆指輪
  56: ["F1", 1], //  艦からのチョコ
  57: ["B1", 1], //  勲章
  58: ["E2", 1], //  改装設計図
  59: ["D1", 1], //  給糧艦「伊良湖」
  60: ["E1", 1], //  プレゼント箱
  61: ["G1", 1], //  甲種勲章
  62: ["LT", 1], //  菱餅
  63: ["G2", 1], //  司令部要員
  64: ["H2", 1], //  補強増設
  65: ["B4", 1], //  試製カタパルト
  66: ["E4", 1], //  戦闘糧食
  67: ["F4", 1], //  洋上補給
  68: ["LT", 1], //  秋刀魚
  69: ["D4", 1], //  秋刀魚の缶詰
  70: ["A4", 1], //  熟練搭乗員
  71: ["C4", 1], //  ネ式エンジン
  72: ["LT", 1], //  お飾り材料
  73: ["G4", 1], //  設営隊
  74: ["H1", 1], //  新型航空機設計図
  75: ["A2", 2], //  新型砲熕兵装資材
  76: ["A3", 2], //  戦闘糧食(特別なおにぎり)
  77: ["B2", 2], //  新型航空兵装資材
  78: ["C1", 2], //  戦闘詳報
  79: ["UC", 6], //  海峡章
  80: ["LT", 2], //  Xmas Select Gift Box
  81: ["UC", 6], //  捷号章
  82: ["UC", 6], //  捷号章
  83: ["UC", 6], //  捷号章
  84: ["UC", 6], //  捷号章
  85: ["LT", 2], //  お米
  86: ["LT", 2], //  梅干し
  87: ["LT", 2], //  海苔
  88: ["LT", 2], //  お茶
  89: ["LT", 2], //  鳳翔さん鳳翔食券
  90: ["LT", 2], //  節分の豆
  91: ["B3", 2], //  緊急修理資材
  92: ["C2", 2], //  新型噴進装備開発資材
  93: ["LT", 2], //  鰯
  94: ["C3", 2], //  新型兵装資材
  95: ["H4", 1], //  潜水艦補給物資
  96: ["LT", 2], //  南瓜
  97: ["LT", 2], //  てるてる坊主
  98: ["A4", 2], //  海色リボン
  99: ["B4", 2], //  白たすき
  100: ["D2", 2], //  海外艦最新技術
  101: ["D1", 2], //  夜間熟練搭乗員
  102: ["D4", 2], //  航空特別増加食
  103: ["E1", 2], //  工廠拡張キー
  104: ["E2", 2], //  工廠資源
  105: ["D3", 2], //  格納庫増設
};

export const material_icon_tables: Record<
  number,
  { name: string; color: string }
> = {
  0: { name: "Undefined", color: "#FFFFFF" },
  1: { name: "Owned items", color: "#684329" },
  2: { name: "Expansion items", color: "#595959" },
  3: { name: "Purchased items", color: "#1E1E1E" },
  4: { name: "Front display only", color: "#CCCC00" },
  5: { name: "Furniture store only", color: "#00CCCC" },
  6: { name: "Information only", color: "#CC00CC" },
};

export const material_icon_rows = [1, 2, 3, 4];
export const material_icon_columns = ["A", "B", "C", "D", "E", "F", "G", "H"];

export type MaterialIconShelfCell = {
  cell: string;
  row: number;
  column: string;
  present: boolean;
  occupied: boolean;
  label?: string;
};

const expansion_shelf_columns = material_icon_columns.slice(0, 5);
const resource_shelf_layout = [
  ["A0", "C0"],
  ["B0", "D0"],
];
const absent_shelf_cells: Record<number, ReadonlySet<string>> = {
  1: new Set(["A1", "G1", "D3"]),
  2: new Set(["E1"]),
};

function getOccupiedMaterialIconCells(tableId: number) {
  return new Set(
    Object.values(item_list).flatMap(([rawCell, itemTableId]) => {
      const cell = rawCell.trim();
      return itemTableId === tableId && /^[A-H][0-4]$/.test(cell) ? [cell] : [];
    }),
  );
}

function createMaterialIconShelfCell(
  cell: string,
  occupied: boolean,
  present = true,
) {
  const match = /^([A-H])([0-4])$/.exec(cell);
  return {
    cell,
    row: Number(match?.[2]),
    column: match?.[1] ?? "",
    present,
    occupied: present && occupied,
  };
}

export function getMaterialIconShelfRows(
  tableId: number,
  columns = material_icon_columns,
) {
  const occupiedCells = getOccupiedMaterialIconCells(tableId);
  const absentCells = absent_shelf_cells[tableId] ?? new Set<string>();

  return material_icon_rows.map((row) =>
    columns.map((column) => {
      const cell = `${column}${row}`;
      return createMaterialIconShelfCell(
        cell,
        occupiedCells.has(cell),
        !absentCells.has(cell),
      );
    }),
  );
}

export function getMaterialIconItemNumbersAtCell(
  tableId: number,
  cell: string,
) {
  if (absent_shelf_cells[tableId]?.has(cell)) return [];

  const itemCell = tableId === 2 && cell === "A1" ? "LT" : cell;

  return Object.entries(item_list).flatMap(
    ([itemNumber, [rawCell, itemTableId]]) =>
      itemTableId === tableId && rawCell.trim() === itemCell
        ? [Number(itemNumber)]
        : [],
  );
}

export function getMaterialIconResourceShelfRows() {
  const occupiedCells = getOccupiedMaterialIconCells(4);
  return resource_shelf_layout.map((row) =>
    row.map((cell) =>
      createMaterialIconShelfCell(cell, occupiedCells.has(cell)),
    ),
  );
}

export function getMaterialIconFurnitureStoreRows() {
  const occupiedCells = getOccupiedMaterialIconCells(5);
  return [[createMaterialIconShelfCell("E0", occupiedCells.has("E0"))]];
}

export function getMaterialIconExpansionShelfRows() {
  const rows = getMaterialIconShelfRows(2, expansion_shelf_columns);
  const hasLtItem = Object.values(item_list).some(
    ([cell, tableId]) => tableId === 2 && cell.trim() === "LT",
  );

  if (!hasLtItem) return rows;

  return rows.map((row) =>
    row.map((cell) =>
      cell.cell === "A1" ? { ...cell, occupied: true, label: "LT" } : cell,
    ),
  );
}

export function getMaterialIconShelfCell(itemNumber: number) {
  const { cell, tableId } = getMaterialIconLocation(itemNumber);
  if (absent_shelf_cells[tableId]?.has(cell)) return null;

  if (tableId === 2 && cell === "LT") return "A1";
  if (tableId === 4 && /^[A-D]0$/.test(cell)) return cell;
  if (tableId === 1 && /^[A-H][1-4]$/.test(cell)) return cell;
  if (tableId === 2 && /^[A-E][1-4]$/.test(cell)) return cell;
  if (tableId === 3 && /^[A-H][1-4]$/.test(cell)) return cell;
  if (tableId === 5 && cell === "E0") return cell;

  return null;
}

export function getMaterialIconLocation(itemNumber: number) {
  const [rawCell, tableId] = item_list[itemNumber] ?? ["UN", 0];
  const cell = rawCell.trim() || "UN";
  const match = /^([A-H])([0-4])$/.exec(cell);

  return {
    cell,
    tableId,
    row: match ? Number(match[2]) : null,
    column: match?.[1] ?? null,
  };
}
