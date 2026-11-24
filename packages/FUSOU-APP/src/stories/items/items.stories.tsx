import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";
import { untrack } from "solid-js";
import type { MstUseItemMetas, MstUseItems } from "@ipc-bindings/get_data";
import type { PayItems, SlotItems, UseItems } from "@ipc-bindings/require_info";
import type { Materials } from "@ipc-bindings/port";
import { ItemsComponent } from "../../components/items/items";
import {
  MaterialsContext,
  MstUseItemMetasContext,
  MstUseItemsContext,
  PayItemsContext,
  SlotItemsContext,
  UseItemsContext,
} from "../../utility/provider";

const sampleMstUseItems: MstUseItems = {
  mst_use_items: {
    1: { id: 1, name: "高速修復材" },
    2: { id: 2, name: "高速建造材" },
    3: { id: 3, name: "開発資材" },
    4: { id: 4, name: "改修資材" },
    10: { id: 10, name: "家具箱（小）" },
    44: { id: 44, name: "家具コイン" },
    50: { id: 50, name: "応急修理要員" },
    51: { id: 51, name: "応急修理女神" },
    52: { id: 52, name: "特注家具職人" },
    57: { id: 57, name: "勲章" },
    65: { id: 65, name: "試製甲板カタパルト" },
    66: { id: 66, name: "戦闘糧食" },
    67: { id: 67, name: "洋上補給" },
    69: { id: 69, name: "秋刀魚の缶詰" },
    75: { id: 75, name: "新型砲熕兵装資材" },
    76: { id: 76, name: "戦闘糧食(特別なおにぎり)" },
    91: { id: 91, name: "緊急修理資材" },
  },
};

const sampleMstUseItemMetas: MstUseItemMetas = {
  mst_use_item_metas: {
    10: {
      id: 10,
      usetype: 4,
      category: 3,
      name: "家具箱（小）",
      description: ["開けると家具コインを200入手できます。"],
      price: 0,
    },
    44: {
      id: 44,
      usetype: 0,
      category: 5,
      name: "家具コイン",
      description: ["家具の購入に使用します。"],
      price: 0,
    },
    50: {
      id: 50,
      usetype: 0,
      category: 1,
      name: "応急修理要員",
      description: [
        "艦のスロットに装備する。装備<br>した艦は1度だけ撃沈を回避で<br>きる。",
      ],
      price: 200,
    },
    57: {
      id: 57,
      usetype: 4,
      category: 17,
      name: "勲章",
      description: ["複数集めることで資源または改装設計図と交換可能です。"],
      price: 0,
    },
    75: {
      id: 75,
      usetype: 0,
      category: 19,
      name: "新型砲熕兵装資材",
      description: ["新型砲熕兵装の開発や改修に必要な特殊資材です。"],
      price: 0,
    },
    91: {
      id: 91,
      usetype: 0,
      category: 22,
      name: "緊急修理資材",
      description: ["洋上での緊急泊地修理等に使用する特殊資材です。"],
      price: 0,
    },
  },
};

const sampleUseItems: UseItems = {
  use_items: {
    10: { id: 10, count: 24 },
    44: { id: 44, count: 12000 },
    52: { id: 52, count: 1 },
    57: { id: 57, count: 14 },
    65: { id: 65, count: 1 },
    75: { id: 75, count: 9 },
    91: { id: 91, count: 6 },
  },
};

const sampleSlotItems: SlotItems = {
  slot_items: {
    1001: { id: 1001, slotitem_id: 42, locked: 0, level: 0, alv: null },
    1002: { id: 1002, slotitem_id: 42, locked: 0, level: 0, alv: null },
    1003: { id: 1003, slotitem_id: 42, locked: 0, level: 0, alv: null },
    1004: { id: 1004, slotitem_id: 42, locked: 0, level: 0, alv: null },
    1005: { id: 1005, slotitem_id: 42, locked: 0, level: 0, alv: null },
    1006: { id: 1006, slotitem_id: 145, locked: 0, level: 0, alv: null },
    1007: { id: 1007, slotitem_id: 145, locked: 0, level: 0, alv: null },
    1008: { id: 1008, slotitem_id: 145, locked: 0, level: 0, alv: null },
    1009: { id: 1009, slotitem_id: 145, locked: 0, level: 0, alv: null },
    1010: { id: 1010, slotitem_id: 146, locked: 0, level: 0, alv: null },
    1011: { id: 1011, slotitem_id: 146, locked: 0, level: 0, alv: null },
    1012: { id: 1012, slotitem_id: 146, locked: 0, level: 0, alv: null },
    1013: { id: 1013, slotitem_id: 150, locked: 0, level: 0, alv: null },
    1014: { id: 1014, slotitem_id: 150, locked: 0, level: 0, alv: null },
    1015: { id: 1015, slotitem_id: 241, locked: 0, level: 0, alv: null },
    1016: { id: 1016, slotitem_id: 241, locked: 0, level: 0, alv: null },
  },
};

const samplePayItems: PayItems = {
  pay_items: {
    15: {
      payitem_id: 15,
      item_type: 1,
      name: "特注家具職人",
      description: "特注家具を購入する際に使用します。",
      price: 300,
      count: 2,
    },
    16: {
      payitem_id: 16,
      item_type: 2,
      name: "母港拡張",
      description: "保有艦数の上限を+10隻拡張します。",
      price: 1000,
      count: 1,
    },
  },
};

function MockItemProviders(props: {
  useItems: UseItems;
  payItems: PayItems;
  mstUseItems: MstUseItems;
  mstUseItemMetas: MstUseItemMetas;
  materials?: Materials;
  slotItems?: SlotItems;
  children: JSX.Element;
}) {
  const initialMstUseItems = untrack(() => props.mstUseItems);
  const initialMstUseItemMetas = untrack(() => props.mstUseItemMetas);
  const initialUseItems = untrack(() => props.useItems);
  const initialPayItems = untrack(() => props.payItems);
  const initialMaterials = untrack(
    () =>
      props.materials ?? {
        materials: {},
      },
  );
  const initialSlotItems = untrack(
    () =>
      props.slotItems ?? {
        slot_items: {},
      },
  );

  return (
    <SlotItemsContext.Provider value={[initialSlotItems, () => {}] as any}>
      <MaterialsContext.Provider value={[initialMaterials, () => {}] as any}>
        <MstUseItemsContext.Provider
          value={[initialMstUseItems, () => {}] as any}
        >
          <MstUseItemMetasContext.Provider
            value={[initialMstUseItemMetas, () => {}] as any}
          >
            <UseItemsContext.Provider
              value={[initialUseItems, () => {}] as any}
            >
              <PayItemsContext.Provider
                value={[initialPayItems, () => {}] as any}
              >
                {props.children}
              </PayItemsContext.Provider>
            </UseItemsContext.Provider>
          </MstUseItemMetasContext.Provider>
        </MstUseItemsContext.Provider>
      </MaterialsContext.Provider>
    </SlotItemsContext.Provider>
  );
}

const meta: Meta<typeof ItemsComponent> = {
  title: "Components/Items",
  component: ItemsComponent,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ItemsComponent>;

export const Shelves: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-xl p-3">
      <MockItemProviders
        useItems={sampleUseItems}
        payItems={samplePayItems}
        mstUseItems={sampleMstUseItems}
        mstUseItemMetas={sampleMstUseItemMetas}
        slotItems={sampleSlotItems}
        materials={{
          materials: {
            0: 120000,
            1: 150000,
            2: 90444,
            3: 50247,
            4: 24,
            5: 1420,
            6: 8,
            7: 65,
          },
          furniture_coin: 12000,
        }}
      >
        <ItemsComponent />
      </MockItemProviders>
    </ul>
  ),
};

export const EmptyItems: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-xl p-3">
      <MockItemProviders
        useItems={{ use_items: {} }}
        payItems={{ pay_items: {} }}
        mstUseItems={{ mst_use_items: {} }}
        mstUseItemMetas={{ mst_use_item_metas: {} }}
      >
        <ItemsComponent />
      </MockItemProviders>
    </ul>
  ),
};

export const LoadedEmptyShelves: Story = {
  render: () => (
    <ul class="menu menu-xs bg-base-100 rounded-box border border-base-300 w-full max-w-xl p-3">
      <MockItemProviders
        useItems={{ use_items: { 1: { id: 1, count: 100 } } }}
        payItems={{ pay_items: {} }}
        mstUseItems={{ mst_use_items: {} }}
        mstUseItemMetas={{ mst_use_item_metas: {} }}
      >
        <ItemsComponent />
      </MockItemProviders>
    </ul>
  ),
};
