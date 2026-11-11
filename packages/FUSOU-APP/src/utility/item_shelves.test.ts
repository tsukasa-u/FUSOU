import { describe, expect, it } from "vitest";
import { buildItemShelves, classifyUseItemShelf } from "./item_shelves";

describe("classifyUseItemShelf", () => {
  it("routes normal, special (>=75), and port expansion (53) items to matching shelves", () => {
    expect(classifyUseItemShelf(50)).toBe("normal");
    expect(classifyUseItemShelf(74)).toBe("normal");
    expect(classifyUseItemShelf(75)).toBe("special");
    expect(classifyUseItemShelf(93)).toBe("special");
    expect(classifyUseItemShelf(53)).toBe("purchased");
  });
});

describe("buildItemShelves", () => {
  it("excludes resource materials and classifies owned items with normalized metadata", () => {
    const result = buildItemShelves({
      useItems: {
        use_items: {
          1: { id: 1, count: 1500 }, // Bucket (resource strip)
          31: { id: 31, count: 50000 }, // Fuel (resource strip)
          44: { id: 44, count: 12000 }, // Furniture coin (resource strip)
          50: { id: 50, count: 3 },
          57: { id: 57, count: 12 },
          75: { id: 75, count: 4 },
          91: { id: 91, count: 0 }, // unowned skipped
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
      mstUseItems: {
        mst_use_items: {
          50: { id: 50, name: "応急修理要員" },
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

    expect(result.normal.map((i) => i.id)).toEqual([50, 57]);
    expect(result.normal[0].description).toBe(
      "艦のスロットに装備する。装備した艦は1度だけ撃沈を回避できる。",
    );
    expect(result.normal[1].usable).toBe(true);
    expect(result.special.map((i) => i.id)).toEqual([75]);
    expect(result.special[0].iconNumber).toBe(75);
    expect(result.purchased).toHaveLength(1);
    expect(result.purchased[0].iconNumber).toBe(50);
    expect(result.purchased[0].description).toBe(
      "出撃中に艦が轟沈した際、一度だけ回復します。\n※ストックアイテム",
    );
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
    expect(result.special[0].description).toBe(
      "艦娘が集めたり、作ったりした「てるてる坊主」です。\n※海色リボンや限定家具、装備や資材などと交換可能です。\n※夏本格到来時に消滅します。",
    );
  });
});
