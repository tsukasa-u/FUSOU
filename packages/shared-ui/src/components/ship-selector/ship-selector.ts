import { html, css, LitElement, unsafeCSS, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import globalStyles from "../../global.css?inline";

import type { MstShip } from "@ipc-bindings/get_data";
import type { MstStype } from "@ipc-bindings/get_data";

import "../../icons/ship";

export interface ShipSelectorProps {
  ships: MstShip[];
  stypes: MstStype[];
  selectedShipId: number | null;
}

@customElement("ship-selector")
export class ShipSelector extends LitElement {
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
  ships: MstShip[] = [];

  @property({ type: Array })
  stypes: MstStype[] = [];

  @property({ type: Number })
  selectedShipId: number | null = null;

  @state()
  private _search = "";

  @state()
  private _stypeFilter = 0;

  @state()
  private _open = false;

  private get _filteredShips(): MstShip[] {
    let result = this.ships;
    if (this._stypeFilter > 0) {
      result = result.filter((s) => s.stype === this._stypeFilter);
    }
    if (this._search) {
      const q = this._search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.yomi.toLowerCase().includes(q) ||
          String(s.id).includes(q),
      );
    }
    return result.slice(0, 100);
  }

  private get _selectedShip(): MstShip | undefined {
    return this.ships.find((s) => s.id === this.selectedShipId);
  }

  private _selectShip(ship: MstShip) {
    this.selectedShipId = ship.id;
    this._open = false;
    this.dispatchEvent(
      new CustomEvent("ship-selected", {
        detail: { ship },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _clear() {
    this.selectedShipId = null;
    this.dispatchEvent(
      new CustomEvent("ship-selected", {
        detail: { ship: null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const selected = this._selectedShip;

    return html`
      <div class="relative">
        <!-- Trigger button -->
        <div
          class="flex items-center gap-2 border border-base-300 rounded-lg px-3 py-2 cursor-pointer hover:bg-base-200 transition-colors"
          @click=${() => (this._open = !this._open)}
        >
          ${selected
            ? html`
                <icon-ship
                  ship_stype=${selected.stype}
                  size="xs"
                ></icon-ship>
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
              >艦を選択...</span
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
                    placeholder="艦名・読み・IDで検索..."
                    .value=${this._search}
                    @input=${(e: Event) => {
                      this._search = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>
                <!-- Stype filter -->
                <div class="p-2 border-b border-base-200 flex flex-wrap gap-1">
                  <button
                    class="btn btn-xs ${this._stypeFilter === 0
                      ? "btn-primary"
                      : "btn-ghost"}"
                    @click=${() => (this._stypeFilter = 0)}
                  >
                    全て
                  </button>
                  ${this.stypes.map(
                    (st) => html`
                      <button
                        class="btn btn-xs ${this._stypeFilter === st.id
                          ? "btn-primary"
                          : "btn-ghost"}"
                        @click=${() => (this._stypeFilter = st.id)}
                      >
                        ${st.name}
                      </button>
                    `,
                  )}
                </div>
                <!-- Ship list -->
                <div class="dropdown-list">
                  ${this._filteredShips.length === 0
                    ? html`<div class="p-4 text-center text-base-content/40">
                        該当なし
                      </div>`
                    : this._filteredShips.map(
                        (ship) => html`
                          <div
                            class="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200 cursor-pointer transition-colors ${ship.id ===
                            this.selectedShipId
                              ? "bg-primary/10"
                              : ""}"
                            @click=${() => this._selectShip(ship)}
                          >
                            <icon-ship
                              ship_stype=${ship.stype}
                              size="xs"
                            ></icon-ship>
                            <span class="text-sm">${ship.name}</span>
                            <span class="text-xs text-base-content/40 ml-auto"
                              >#${ship.id}</span
                            >
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
    "ship-selector": ShipSelector;
  }
}
