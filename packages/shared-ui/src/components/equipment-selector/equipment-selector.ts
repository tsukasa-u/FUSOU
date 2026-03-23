import { html, css, LitElement, unsafeCSS, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { MstSlotItem } from "@ipc-bindings/get_data";
import type { MstSlotItemEquipType } from "@ipc-bindings/get_data";

import "../../icons/equipment";

export interface EquipmentSelectorProps {
  equipments: MstSlotItem[];
  equipTypes: MstSlotItemEquipType[];
  selectedEquipId: number | null;
}

@customElement("equipment-selector")
export class EquipmentSelector extends LitElement {
  static styles = [
    unsafeCSS(globalStyles),
    css`
      :host {
        display: block;
      }
      .dropdown-list {
        max-height: 300px;
        overflow-y: auto;
      }
    `,
  ];

  @property({ type: Array })
  equipments: MstSlotItem[] = [];

  @property({ type: Array })
  equipTypes: MstSlotItemEquipType[] = [];

  @property({ type: Number })
  selectedEquipId: number | null = null;

  @state()
  private _search = "";

  @state()
  private _typeFilter = 0;

  @state()
  private _open = false;

  private get _filteredEquipments(): MstSlotItem[] {
    let result = this.equipments;
    if (this._typeFilter > 0) {
      result = result.filter((e) => e.type[2] === this._typeFilter);
    }
    if (this._search) {
      const q = this._search.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) || String(e.id).includes(q),
      );
    }
    return result.slice(0, 100);
  }

  private get _selectedEquip(): MstSlotItem | undefined {
    return this.equipments.find((e) => e.id === this.selectedEquipId);
  }

  private _selectEquip(equip: MstSlotItem) {
    this.selectedEquipId = equip.id;
    this._open = false;
    this.dispatchEvent(
      new CustomEvent("equipment-selected", {
        detail: { equipment: equip },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _clear() {
    this.selectedEquipId = null;
    this.dispatchEvent(
      new CustomEvent("equipment-selected", {
        detail: { equipment: null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const selected = this._selectedEquip;

    return html`
      <div class="relative">
        <!-- Trigger -->
        <div
          class="flex items-center gap-2 border border-base-300 rounded-lg px-3 py-2 cursor-pointer hover:bg-base-200 transition-colors"
          @click=${() => (this._open = !this._open)}
        >
          ${selected
            ? html`
                <icon-equipment
                  equip_type=${selected.type[3] ?? 0}
                  size="xs"
                ></icon-equipment>
                <span class="flex-1 text-sm truncate">${selected.name}</span>
                <button
                  class="btn btn-ghost btn-xs"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this._clear();
                  }}
                >
                  ✕
                </button>
              `
            : html`<span class="flex-1 text-sm text-base-content/40"
                >装備を選択...</span
              >`}
        </div>

        <!-- Dropdown -->
        ${this._open
          ? html`
              <div
                class="absolute z-50 mt-1 w-full bg-base-100 border border-base-300 rounded-lg shadow-lg"
              >
                <!-- Search -->
                <div class="p-2 border-b border-base-200">
                  <input
                    type="text"
                    class="input input-bordered input-sm w-full"
                    placeholder="装備名・IDで検索..."
                    .value=${this._search}
                    @input=${(e: Event) => {
                      this._search = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>
                <!-- Type filter -->
                <div
                  class="p-2 border-b border-base-200 flex flex-wrap gap-1 max-h-20 overflow-y-auto"
                >
                  <button
                    class="btn btn-xs ${this._typeFilter === 0
                      ? "btn-primary"
                      : "btn-ghost"}"
                    @click=${() => (this._typeFilter = 0)}
                  >
                    全て
                  </button>
                  ${this.equipTypes.map(
                    (et) => html`
                      <button
                        class="btn btn-xs ${this._typeFilter === et.id
                          ? "btn-primary"
                          : "btn-ghost"}"
                        @click=${() => (this._typeFilter = et.id)}
                      >
                        ${et.name}
                      </button>
                    `,
                  )}
                </div>
                <!-- Equipment list -->
                <div class="dropdown-list">
                  ${this._filteredEquipments.length === 0
                    ? html`<div class="p-4 text-center text-base-content/40">
                        該当なし
                      </div>`
                    : this._filteredEquipments.map(
                        (equip) => html`
                          <div
                            class="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200 cursor-pointer transition-colors ${equip.id ===
                            this.selectedEquipId
                              ? "bg-primary/10"
                              : ""}"
                            @click=${() => this._selectEquip(equip)}
                          >
                            <icon-equipment
                              equip_type=${equip.type[3] ?? 0}
                              size="xs"
                            ></icon-equipment>
                            <span class="text-sm flex-1 truncate"
                              >${equip.name}</span
                            >
                            <div class="flex gap-1 text-xs text-base-content/40">
                              ${equip.houg
                                ? html`<span>火${equip.houg}</span>`
                                : nothing}
                              ${equip.tyku
                                ? html`<span>対空${equip.tyku}</span>`
                                : nothing}
                              ${equip.tais
                                ? html`<span>対潜${equip.tais}</span>`
                                : nothing}
                            </div>
                          </div>
                        `,
                      )}
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "equipment-selector": EquipmentSelector;
  }
}
