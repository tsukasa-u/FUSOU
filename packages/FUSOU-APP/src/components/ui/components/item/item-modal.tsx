import { createSignal, For, Show, type Component, type JSX } from "solid-js";
import { normalizeItemDescription } from "../../../../utility/item_shelves";
import { IconMaterial } from "../../icons/material";
import {
  getMaterialIconExpansionShelfRows,
  getMaterialIconFurnitureStoreRows,
  getMaterialIconItemNumbersAtCell,
  getMaterialIconLocation,
  getMaterialIconResourceShelfRows,
  getMaterialIconShelfCell,
  getMaterialIconShelfRows,
  type MaterialIconShelfCell,
  material_icon_tables,
} from "../../icons/material_data";

export interface ComponentItemModalProps {
  item_number: number;
  name: string;
  description: string;
  descriptionIsNormalized?: boolean;
  itemNames?: Readonly<Record<number, string>>;
  count?: number;
  size?: "full" | "none" | "xs" | "sm" | "md" | "lg" | "xl";
  class?: string;
  children?: JSX.Element;
}

interface ItemStorageShelfProps {
  name: string;
  tableId: number;
  rows: MaterialIconShelfCell[][];
  selectedTableId: number;
  selectedCell: string | null;
  selectedItemNumber: number;
  selectedItemName: string;
  itemNames?: Readonly<Record<number, string>>;
}

const ItemStorageShelf: Component<ItemStorageShelfProps> = (props) => (
  <div
    role="grid"
    aria-label={props.name}
    class="grid w-fit shrink-0 gap-y-1 border border-base-300 bg-base-200 p-1"
  >
    <For each={props.rows}>
      {(shelfRow) => (
        <div
          role="row"
          aria-label={`Shelf row ${shelfRow[0]?.row ?? ""}`}
          class="grid gap-x-px border-b border-base-300 pb-1 last:border-b-0 last:pb-0"
          style={{
            "grid-template-columns": `repeat(${shelfRow.length}, 1.5rem)`,
          }}
        >
          <For each={shelfRow}>
            {(cell) => {
              const isCurrentCell =
                props.tableId === props.selectedTableId &&
                cell.cell === props.selectedCell;
              const cellItemNames = getMaterialIconItemNumbersAtCell(
                props.tableId,
                cell.cell,
              )
                .map((itemNumber) =>
                  itemNumber === props.selectedItemNumber
                    ? props.selectedItemName
                    : props.itemNames?.[itemNumber],
                )
                .filter((name): name is string => Boolean(name));
              const itemName =
                [...new Set(cellItemNames)].join(", ") ||
                (isCurrentCell ? props.selectedItemName : undefined);
              return (
                <Show
                  when={cell.present}
                  fallback={<div class="size-6" aria-hidden="true" />}
                >
                  <div
                    role="gridcell"
                    aria-label={`${cell.cell}, ${itemName ? `occupied by ${itemName}` : cell.label ? `occupied by ${cell.label}` : cell.occupied ? "occupied" : "empty"}`}
                    aria-current={isCurrentCell ? "true" : undefined}
                    title={cell.occupied ? itemName : undefined}
                    class={`flex size-6 shrink-0 items-center justify-center border border-base-300 bg-base-100 ${
                      isCurrentCell
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-inset ring-primary"
                        : ""
                    }`}
                  >
                    <Show when={cell.occupied}>
                      <span class="font-mono text-[10px] font-semibold tracking-tight">
                        {cell.label ?? cell.cell}
                      </span>
                    </Show>
                  </div>
                </Show>
              );
            }}
          </For>
        </div>
      )}
    </For>
  </div>
);

const ItemStorageShelfTitle: Component<{
  name: string;
  tableId: number;
}> = (props) => (
  <div class="flex items-center gap-1.5">
    <span
      class="size-3 rounded-full border border-base-300"
      style={{ "background-color": material_icon_tables[props.tableId].color }}
      aria-hidden="true"
    />
    <h5 class="text-xs font-semibold">{props.name}</h5>
  </div>
);

export const ComponentItemModal: Component<ComponentItemModalProps> = (
  props,
) => {
  let dialogRef: HTMLDialogElement | undefined;
  const [showDialog, setShowDialog] = createSignal(false);

  const location = () => getMaterialIconLocation(props.item_number);
  const shelfCell = () => getMaterialIconShelfCell(props.item_number);
  const description = () =>
    props.descriptionIsNormalized
      ? props.description.trim()
      : normalizeItemDescription(props.description);

  const openModal = () => {
    setShowDialog(true);
    setTimeout(() => {
      if (dialogRef && !dialogRef.open) dialogRef.showModal();
    }, 0);
  };

  return (
    <>
      <button
        type="button"
        class={`inline-flex cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${props.class ?? ""}`}
        aria-label={`Show details for ${props.name}`}
        title={props.name}
        aria-haspopup="dialog"
        aria-expanded={showDialog()}
        onClick={openModal}
      >
        {props.children ?? (
          <IconMaterial
            item_number={props.item_number}
            size={props.size ?? "xs"}
          />
        )}
      </button>
      <Show when={showDialog()}>
        <dialog
          ref={dialogRef}
          class="modal"
          onClose={() => setShowDialog(false)}
        >
          <div class="modal-box modal-box-width border border-base-300">
            <button
              type="button"
              class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
              aria-label="Close item details"
              onClick={() => dialogRef?.close()}
            >
              ✕
            </button>

            <div class="min-w-0 pr-8">
              <h3 class="text-lg font-bold break-words">{props.name}</h3>
              <Show when={props.count !== undefined}>
                <p class="text-sm text-base-content/70 tabular-nums">
                  Owned: ×{props.count}
                </p>
              </Show>
            </div>

            <section class="mt-4">
              <h4 class="text-sm font-semibold">Description</h4>
              <p class="mt-1 text-sm whitespace-pre-wrap break-words">
                {description() || "No description available."}
              </p>
            </section>

            {/* <section class="mt-4 rounded-lg border border-base-300 p-3"> */}
            <section class="mt-4">
              <h4 class="text-sm font-semibold">Item placement</h4>

              <div class="mt-3 w-full max-w-[360px] space-y-3">
                <div class="flex w-full flex-wrap items-start gap-2">
                  <section class="w-fit shrink-0">
                    <ItemStorageShelfTitle name="Regular items" tableId={1} />
                    <div class="mt-1">
                      <ItemStorageShelf
                        name="Regular items shelf"
                        tableId={1}
                        rows={getMaterialIconShelfRows(1)}
                        selectedTableId={location().tableId}
                        selectedCell={shelfCell()}
                        selectedItemNumber={props.item_number}
                        selectedItemName={props.name}
                        itemNames={props.itemNames}
                      />
                    </div>
                  </section>

                  <section class="w-fit shrink-0">
                    <ItemStorageShelfTitle name="Expansion items" tableId={2} />
                    <div class="mt-1">
                      <ItemStorageShelf
                        name="Expansion items shelf"
                        tableId={2}
                        rows={getMaterialIconExpansionShelfRows()}
                        selectedTableId={location().tableId}
                        selectedCell={shelfCell()}
                        selectedItemNumber={props.item_number}
                        selectedItemName={props.name}
                        itemNames={props.itemNames}
                      />
                    </div>
                  </section>
                </div>

                <div class="flex w-full flex-wrap items-start gap-2">
                  <section class="w-fit shrink-0">
                    <ItemStorageShelfTitle name="Purchased items" tableId={3} />
                    <div class="mt-1">
                      <ItemStorageShelf
                        name="Purchased items shelf"
                        tableId={3}
                        rows={getMaterialIconShelfRows(3)}
                        selectedTableId={location().tableId}
                        selectedCell={shelfCell()}
                        selectedItemNumber={props.item_number}
                        selectedItemName={props.name}
                        itemNames={props.itemNames}
                      />
                    </div>
                  </section>

                  <div class="w-fit shrink-0 space-y-3">
                    <section>
                      <ItemStorageShelfTitle
                        name="Resource shelf"
                        tableId={4}
                      />
                      <div class="mt-1">
                        <ItemStorageShelf
                          name="Resource shelf"
                          tableId={4}
                          rows={getMaterialIconResourceShelfRows()}
                          selectedTableId={location().tableId}
                          selectedCell={shelfCell()}
                          selectedItemNumber={props.item_number}
                          selectedItemName={props.name}
                          itemNames={props.itemNames}
                        />
                      </div>
                    </section>

                    <section>
                      <ItemStorageShelfTitle
                        name="Furniture Store"
                        tableId={5}
                      />
                      <div class="mt-1 flex items-center gap-2">
                        <ItemStorageShelf
                          name="Furniture Store shelf"
                          tableId={5}
                          rows={getMaterialIconFurnitureStoreRows()}
                          selectedTableId={location().tableId}
                          selectedCell={shelfCell()}
                          selectedItemNumber={props.item_number}
                          selectedItemName={props.name}
                          itemNames={props.itemNames}
                        />
                        <span class="text-xs">家具コイン</span>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
              <Show when={shelfCell() === null}>
                <p class="mt-2 text-xs text-base-content/60">
                  This icon code does not identify a cell in these storage
                  shelves.
                </p>
              </Show>
            </section>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button aria-label="Close item details">close</button>
          </form>
        </dialog>
      </Show>
    </>
  );
};
