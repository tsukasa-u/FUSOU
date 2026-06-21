/** @jsxImportSource solid-js */

/**
 * ItemPickerModal — 艦・装備選択モーダルの共通コンポーネント。
 * カテゴリフィルター・テキスト検索・VList 表示を共通化する。
 * ヘッダー行（カテゴリ仕切り）と通常行の描画はコールバックで切り替える。
 */

import { For, createEffect, createSignal, type JSX } from "solid-js";
import { VList } from "virtua/solid";
import {
  PickerQuickAccess,
  type PickerQuickAccessEntry,
} from "./picker-quick-access";
import { SelectionModalShell } from "./selection-modal-shell";

/** flatItems の各要素の型 */
export type FlatPickerItem =
  | { type: "header"; key: string }
  | { type: string; data: unknown };

export interface ItemPickerModalProps {
  /** <dialog> の id 属性 */
  id: string;
  /** <dialog> の ref コールバック（catalog 側が showModal/close を呼ぶ用） */
  dialogRef?: (el: HTMLDialogElement) => void;
  /** モーダルに追加する Tailwind クラス（任意） */
  class?: string;
  /** モーダルタイトル例: "艦選択" | "装備選択" */
  title: string;
  /** 現在選択中のアイテムの概要テキスト */
  currentSummary: string;
  /** 現在選択中のカテゴリ値 */
  category: string;
  /** カテゴリ変更ハンドラ */
  onCategoryChange: (cat: string) => void;
  /** カテゴリ一覧 */
  categories: string[];
  /** "すべての○○" のラベルテキスト（select の all オプションと aria-label に使用） */
  allOptionLabel: string;
  /** 検索 input の id（省略可） */
  searchId?: string;
  /** 検索 input の aria-label */
  searchAriaLabel: string;
  /** 検索 input の placeholder */
  searchPlaceholder: string;
  /** 検索テキストの現在値 */
  searchValue: string;
  /** 検索 input 変更ハンドラ */
  onSearchInput: (q: string) => void;
  /** VList に渡すフラット化済みデータ */
  flatItems: FlatPickerItem[];
  /** カテゴリのクイックアクセス（左サイドに表示） */
  quickAccessItems?: Array<{
    key: string;
    label: string;
    icon?: () => JSX.Element;
  }>;
  /** ダイアログ close 時のハンドラ */
  onClose: () => void;
  /** 非ヘッダー行の描画コールバック（item.data を受け取る） */
  renderRow: (item: unknown) => JSX.Element;
}

export function ItemPickerModal(props: ItemPickerModalProps): JSX.Element {
  let vlistRef: any;
  const [activeQuickAccessId, setActiveQuickAccessId] = createSignal<string | null>(null);

  const scrollToCategory = (categoryKey: string) => {
    const targetIndex = props.flatItems.findIndex(
      (item) =>
        item.type === "header" &&
        (item as { type: "header"; key: string }).key === categoryKey,
    );
    if (targetIndex >= 0 && vlistRef) {
      vlistRef.scrollToIndex(targetIndex, { align: "start" });
    }
  };

  const quickAccessEntries = (): PickerQuickAccessEntry[] =>
    (props.quickAccessItems ?? []).map((entry) => ({
      id: entry.key,
      label: entry.label,
      icon: entry.icon?.(),
      onSelect: () => {
        setActiveQuickAccessId(entry.key);
        scrollToCategory(entry.key);
      },
    }));

  const updateActiveQuickAccessByScroll = () => {
    const entries = quickAccessEntries();
    if (entries.length === 0) {
      setActiveQuickAccessId(null);
      return;
    }
    if (!vlistRef || typeof vlistRef.findStartIndex !== "function") {
      setActiveQuickAccessId(entries[0]?.id ?? null);
      return;
    }

    const startIdx = Number(vlistRef.findStartIndex() ?? 0);
    let activeKey: string | null = null;

    for (let i = Math.min(startIdx, props.flatItems.length - 1); i >= 0; i--) {
      const item = props.flatItems[i];
      if (item?.type === "header") {
        activeKey = (item as { type: "header"; key: string }).key;
        break;
      }
    }

    if (!activeKey) {
      const fallback = props.flatItems.find((item) => item.type === "header") as
        | { type: "header"; key: string }
        | undefined;
      activeKey = fallback?.key ?? entries[0]?.id ?? null;
    }

    setActiveQuickAccessId(activeKey);
  };

  createEffect(() => {
    props.flatItems;
    props.quickAccessItems;
    requestAnimationFrame(() => updateActiveQuickAccessByScroll());
  });

  return (
    <SelectionModalShell
      id={props.id}
      dialogRef={props.dialogRef}
      dialogClass={`xl:hidden${props.class ? " " + props.class : ""}`}
      boxClass="w-[min(96vw,72rem)] max-w-[72rem] overflow-hidden"
      onClose={props.onClose}
    >
        {/* ヘッダー */}
        <div class="px-4 py-3 border-b border-base-200 bg-base-100">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="font-semibold">{props.title}</h3>
              <p class="text-xs text-base-content/60 truncate">
                現在: {props.currentSummary}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle shrink-0"
              aria-label="閉じる"
              onClick={props.onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* フィルター */}
        <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
          <select
            class="select select-bordered select-sm w-full"
            aria-label={props.allOptionLabel}
            value={props.category}
            onChange={(e) => props.onCategoryChange(e.currentTarget.value)}
          >
            <option value="all">{props.allOptionLabel}</option>
            <For each={props.categories}>
              {(cat) => <option value={cat}>{cat}</option>}
            </For>
          </select>
          <input
            id={props.searchId}
            class="input input-bordered input-sm w-full"
            aria-label={props.searchAriaLabel}
            placeholder={props.searchPlaceholder}
            value={props.searchValue}
            onInput={(e) => props.onSearchInput(e.currentTarget.value)}
          />
        </div>

        {/* 共通クイックアクセス + リスト（画面サイズ共通） */}
        <div class="h-[52vh] flex min-h-0">
          <PickerQuickAccess
            entries={quickAccessEntries()}
            widthClass="w-32"
            activeId={activeQuickAccessId()}
          />
          <div class="p-2 flex-1 min-h-0">
            <VList
              data={props.flatItems}
              ref={vlistRef}
              class="h-full overflow-y-auto overflow-x-hidden"
              onScroll={updateActiveQuickAccessByScroll}
            >
              {(item) =>
                item.type === "header" ? (
                  <div class="mb-2 mt-1 first:mt-0">
                    <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase bg-base-100/95 backdrop-blur-sm z-10">
                      {(item as { type: "header"; key: string }).key}
                    </h4>
                  </div>
                ) : (
                  <div class="mb-0.5">
                    {props.renderRow((item as { type: string; data: unknown }).data)}
                  </div>
                )
              }
            </VList>
          </div>
        </div>
    </SelectionModalShell>
  );
}
