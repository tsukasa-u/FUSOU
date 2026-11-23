import { describe, expect, it } from "vitest";
import {
  buildItemShelves,
  buildOwnedItemNumbers,
  buildUseItemNameMap,
  classifyUseItemShelf,
} from "./item_shelves";

describe("classifyUseItemShelf", () => {
  it("routes normal, special, purchased, and furniture store items to matching shelves", () => {
    expect(classifyUseItemShelf(50)).toBe("normal");
    expect(classifyUseItemShelf(74)).toBe("normal");
    expect(classifyUseItemShelf(75)).toBe("special");
    expect(classifyUseItemShelf(93)).toBe("special");
    expect(classifyUseItemShelf(89)).toBe("special");
    expect(classifyUseItemShelf(95)).toBe("normal");
    expect(classifyUseItemShelf(97)).toBe("normal");
    expect(classifyUseItemShelf(53)).toBe("purchased");
    expect(classifyUseItemShelf(44)).toBe("furniture");
  });
});

describe("buildUseItemNameMap", () => {
  it("prefers metadata names and falls back to use-item master names", () => {
    expect(
      buildUseItemNameMap(
        {
          mst_use_items: {
            50: { id: 50, name: "Master name" },
            57: { id: 57, name: "勲章" },
            75: { id: 75, name: "Fallback name" },
          },
        },
        {
          mst_use_item_metas: {
            50: {
              id: 50,
              usetype: 0,
              category: 1,
              name: "Metadata name",
              description: [],
              price: 0,
            },
            75: {
              id: 75,
              usetype: 0,
              category: 1,
              name: " ",
              description: [],
              price: 0,
            },
          },
        },
      ),
    ).toEqual({
      1: "高速修復材",
      2: "高速建造材",
      3: "開発資材",
      4: "改修資材",
      50: "Metadata name",
      57: "勲章",
      75: "Fallback name",
      31: "燃料",
      32: "弾薬",
      33: "鋼材",
      34: "ボーキサイト",
    });
  });
});

describe("buildOwnedItemNumbers", () => {
  it("merges use-items with material-backed inventory and honors zero material counts", () => {
    expect(
      buildOwnedItemNumbers(
        {
          use_items: {
            1: { id: 1, count: 10 },
            50: { id: 50, count: 3 },
            51: { id: 51, count: 0 },
          },
        },
        {
          materials: {
            0: 50000,
            4: 80,
            5: 0,
          },
        },
        [44],
      ),
    ).toEqual([50, 31, 2, 44]);
  });

  it("uses slot-item-backed counts instead of stale use-item counts", () => {
    expect(
      buildOwnedItemNumbers(
        {
          use_items: {
            66: { id: 66, count: 9 },
            67: { id: 67, count: 9 },
            69: { id: 69, count: 9 },
            76: { id: 76, count: 9 },
          },
        },
        undefined,
        [],
        {
          slot_items: {
            1: { id: 1, slotitem_id: 145, locked: 0, level: 0, alv: null },
            2: { id: 2, slotitem_id: 145, locked: 0, level: 0, alv: null },
            3: { id: 3, slotitem_id: 150, locked: 0, level: 0, alv: null },
          },
        },
      ),
    ).toEqual([66, 69]);
  });
});

describe("buildItemShelves", () => {
  it("derives ration and canned-food counts from their owned slot items", () => {
    const result = buildItemShelves({
      useItems: {
        use_items: {
          65: { id: 65, count: 1 },
        },
      },
      payItems: { pay_items: {} },
      mstUseItems: { mst_use_items: {} },
      mstUseItemMetas: { mst_use_item_metas: {} },
      slotItems: {
        slot_items: {
          1: { id: 1, slotitem_id: 42, locked: 0, level: 0, alv: null },
          2: { id: 2, slotitem_id: 43, locked: 0, level: 0, alv: null },
          3: { id: 3, slotitem_id: 145, locked: 0, level: 0, alv: null },
          4: { id: 4, slotitem_id: 145, locked: 0, level: 0, alv: null },
          5: { id: 5, slotitem_id: 146, locked: 0, level: 0, alv: null },
          6: { id: 6, slotitem_id: 150, locked: 0, level: 0, alv: null },
          7: { id: 7, slotitem_id: 241, locked: 0, level: 0, alv: null },
        },
      },
    });

    expect(result.normal.map((item) => item.id)).toEqual([
      50, 51, 65, 66, 67, 69,
    ]);
    expect(
      result.normal
        .filter((item) => [50, 51, 66, 67, 69].includes(item.id))
        .map(({ id, count }) => [id, count]),
    ).toEqual([
      [50, 1],
      [51, 1],
      [66, 2],
      [67, 1],
      [69, 1],
    ]);
    expect(result.special.map((item) => item.id)).toEqual([76]);
    expect(result.special[0].count).toBe(1);
  });

  it("keeps owned-item shelf materials and excludes only resource-shelf materials", () => {
    const result = buildItemShelves({
      useItems: {
        use_items: {
          31: { id: 31, count: 50000 },
          32: { id: 32, count: 40000 },
          33: { id: 33, count: 30000 },
          34: { id: 34, count: 20000 },
          44: { id: 44, count: 2 }, // API furniture-coin count must take precedence
          50: { id: 50, count: 3 },
          57: { id: 57, count: 12 },
          75: { id: 75, count: 4 },
          95: { id: 95, count: 9 },
          91: { id: 91, count: 0 }, // unowned skipped
        },
      },
      materials: {
        materials: {
          4: 80,
          5: 1500,
          6: 120,
          7: 35,
        },
      },
      payItems: {
        pay_items: {
          11: {
            payitem_id: 11,
            item_type: 1,
            name: "応急修理要員",
            description:
              "出撃中に艦が轟沈した際、一度だけ回復します。<br />※ストックアイテム",
            price: 200,
            count: 2,
          },
        },
      },
      furnitureCoin: 12000,
      mstUseItems: {
        mst_use_items: {
          50: { id: 50, name: "応急修理要員" },
          95: { id: 95, name: "潜水艦補給物資" },
        },
      },
      mstUseItemMetas: {
        mst_use_item_metas: {
          50: {
            id: 50,
            usetype: 0,
            category: 1,
            name: "応急修理要員",
            description: [
              "艦のスロットに装備する。装備<br>した艦は1度だけ撃沈を回避で<br>きる。",
              "",
            ],
            price: 200,
          },
          44: {
            id: 44,
            usetype: 0,
            category: 5,
            name: "家具コイン",
            description: ["家具の購入に使用します。"],
            price: 0,
          },
          57: {
            id: 57,
            usetype: 4,
            category: 17,
            name: "勲章",
            description: ["資源や改装設計図と交換できます。", "交換可能"],
            price: 0,
          },
          75: {
            id: 75,
            usetype: 0,
            category: 19,
            name: "新型砲熕兵装資材",
            description: ["兵装開発に必要な特殊資材です。"],
            price: 0,
          },
        },
      },
    });

    expect(result.normal.map((i) => i.id)).toEqual([1, 2, 3, 4, 50, 57, 95]);
    expect(result.normal.slice(0, 4).map((i) => i.count)).toEqual([
      1500, 80, 120, 35,
    ]);
    expect(result.normal.find((i) => i.id === 50)?.description).toBe(
      "艦のスロットに装備する。装備した艦は1度だけ撃沈を回避できる。",
    );
    expect(result.normal.find((i) => i.id === 57)?.usable).toBe(true);
    expect(result.special.map((i) => i.id)).toEqual([75]);
    expect(result.special[0].iconNumber).toBe(75);
    expect(result.normal.find((i) => i.id === 95)).toMatchObject({
      id: 95,
      iconNumber: 95,
      name: "潜水艦補給物資",
    });
    expect(result.furniture.map((i) => i.id)).toEqual([44]);
    expect(result.furniture[0]).toMatchObject({
      iconNumber: 44,
      name: "家具コイン",
      count: 12000,
    });
    expect(result.purchased).toHaveLength(1);
    expect(result.purchased[0].iconNumber).toBe(50);
    expect(result.purchased[0].description).toBe(
      "出撃中に艦が轟沈した際、一度だけ回復します。\n※ストックアイテム",
    );
  });

  it("adds furniture coins from the independent API count, even when the count is zero", () => {
    const result = buildItemShelves({
      useItems: { use_items: {} },
      payItems: { pay_items: {} },
      mstUseItems: { mst_use_items: {} },
      mstUseItemMetas: { mst_use_item_metas: {} },
      furnitureCoin: 0,
    });

    expect(result.furniture).toEqual([
      expect.objectContaining({
        id: 44,
        iconNumber: 44,
        name: "家具コイン",
        count: 0,
      }),
    ]);
  });

  it("unwraps mid-word breaks while keeping note lines separated", () => {
    const result = buildItemShelves({
      useItems: {
        use_items: {
          10: { id: 10, count: 5 },
          97: { id: 97, count: 2 },
        },
      },
      payItems: { pay_items: {} },
      mstUseItems: { mst_use_items: {} },
      mstUseItemMetas: {
        mst_use_item_metas: {
          10: {
            id: 10,
            usetype: 4,
            category: 6,
            name: "家具箱（小）",
            description: [
              "開けると、中から少量の家具コ<br>インが出現する。",
              "200",
            ],
            price: 0,
          },
          97: {
            id: 97,
            usetype: 0,
            category: 32,
            name: "てるてる坊主",
            description: [
              "艦娘が集めたり、作ったりした<br>「てるてる坊主」です。　　　<br>※海色リボンや限定家具、装備<br>　や資材などと交換可能です。<br>※夏本格到来時に消滅します。",
              "",
            ],
            price: 0,
          },
        },
      },
    });

    expect(result.normal[0].description).toBe(
      "開けると、中から少量の家具コインが出現する。\n200",
    );
    expect(result.normal[1].description).toBe(
      "艦娘が集めたり、作ったりした「てるてる坊主」です。\n※海色リボンや限定家具、装備や資材などと交換可能です。\n※夏本格到来時に消滅します。",
    );
  });
});
