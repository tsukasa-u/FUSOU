/** @jsxImportSource solid-js */

/**
 * ItemPickerModal — 艦・装備選択モーダルの共通コンポーネント。
 * カテゴリフィルター・テキスト検索・VList 表示を共通化する。
 * ヘッダー行（カテゴリ仕切り）と通常行の描画はコールバックで切り替える。
 */

import { For, type JSX } from "solid-js";
import { VList } from "virtua/solid";

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
    icon?: JSX.Element;
  }>;
  /** ダイアログ close 時のハンドラ */
  onClose: () => void;
  /** 非ヘッダー行の描画コールバック（item.data を受け取る） */
  renderRow: (item: unknown) => JSX.Element;
}

export function ItemPickerModal(props: ItemPickerModalProps): JSX.Element {
  let vlistRef: any;

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

  return (
    <dialog
      id={props.id}
      ref={props.dialogRef}
      class={`modal xl:hidden${props.class ? " " + props.class : ""}`}
      onClose={props.onClose}
    >
      <div class="modal-box rounded-xl max-w-xl w-[min(100vw-1rem,42rem)] max-h-[82vh] p-0 overflow-hidden">
        {/* ヘッダー */}
        <div class="px-4 py-3 border-b border-base-200 bg-base-100">
          <h3 class="font-semibold">{props.title}</h3>
          <p class="text-xs text-base-content/60 truncate">
            現在: {props.currentSummary}
          </p>
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

        {/* リスト + クイックアクセス */}
        <div class="sm:hidden border-b border-base-200 bg-base-200/20 overflow-x-auto hide-scrollbar">
          <div class="px-2 py-1.5 inline-flex gap-1.5 min-w-max">
            <For each={props.quickAccessItems ?? []}>
              {(entry) => (
                <button
                  type="button"
                  class="px-2 py-1 rounded-md text-[11px] leading-tight hover:bg-primary/10 active:bg-primary/15 transition-colors text-base-content/65 hover:text-base-content inline-flex items-center gap-1.5"
                  title={entry.label}
                  onClick={() => scrollToCategory(entry.key)}
                >
                  <span class="inline-flex w-4 h-4 items-center justify-center shrink-0">
                    {entry.icon}
                  </span>
                  <span class="truncate">{entry.label}</span>
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="h-[52vh] flex min-h-0">
          <div class="w-28 border-r border-base-200 bg-base-200/20 overflow-y-auto hidden sm:block hide-scrollbar">
            <div class="p-2 space-y-1">
              <For each={props.quickAccessItems ?? []}>
                {(entry) => (
                  <button
                    type="button"
                    class="w-full text-left px-2 py-1.5 rounded-md text-[11px] leading-tight hover:bg-primary/10 active:bg-primary/15 transition-colors text-base-content/65 hover:text-base-content flex items-center gap-1.5"
                    title={entry.label}
                    onClick={() => scrollToCategory(entry.key)}
                  >
                    <span class="inline-flex w-4 h-4 items-center justify-center shrink-0">
                      {entry.icon}
                    </span>
                    <span class="truncate">{entry.label}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="p-2 flex-1 min-h-0">
            <VList
              data={props.flatItems}
              ref={vlistRef}
              class="h-full overflow-y-auto overflow-x-hidden"
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
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}
