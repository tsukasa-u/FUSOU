import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";
import { untrack } from "solid-js";
import type { MstUseItemMetas, MstUseItems } from "@ipc-bindings/get_data";
import type { PayItems, UseItems } from "@ipc-bindings/require_info";
import { ItemsComponent } from "../../components/items/items";
import {
  MstUseItemMetasContext,
  MstUseItemsContext,
  PayItemsContext,
  UseItemsContext,
} from "../../utility/provider";

const sampleMstUseItems: MstUseItems = {
  mst_use_items: {
    10: { id: 10, name: "家具箱（小）" },
    50: { id: 50, name: "応急修理要員" },
    57: { id: 57, name: "勲章" },
    75: { id: 75, name: "新型砲熕兵装資材" },
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
    1: { id: 1, count: 1420 },
    31: { id: 31, count: 120000 },
    10: { id: 10, count: 24 },
    50: { id: 50, count: 5 },
    57: { id: 57, count: 14 },
    75: { id: 75, count: 9 },
    91: { id: 91, count: 6 },
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
  children: JSX.Element;
}) {
  const initialMstUseItems = untrack(() => props.mstUseItems);
  const initialMstUseItemMetas = untrack(() => props.mstUseItemMetas);
  const initialUseItems = untrack(() => props.useItems);
  const initialPayItems = untrack(() => props.payItems);

  return (
    <MstUseItemsContext.Provider value={[initialMstUseItems, () => {}] as any}>
      <MstUseItemMetasContext.Provider
        value={[initialMstUseItemMetas, () => {}] as any}
      >
        <UseItemsContext.Provider value={[initialUseItems, () => {}] as any}>
          <PayItemsContext.Provider value={[initialPayItems, () => {}] as any}>
            {props.children}
          </PayItemsContext.Provider>
        </UseItemsContext.Provider>
      </MstUseItemMetasContext.Provider>
    </MstUseItemsContext.Provider>
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
