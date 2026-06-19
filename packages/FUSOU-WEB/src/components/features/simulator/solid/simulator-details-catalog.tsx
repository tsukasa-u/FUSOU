/** @jsxImportSource solid-js */

/**
 * SimulatorDetailsCatalog — Container component for Ship/Equip detail tabs.
 * Manages tab switching, list filtering, URL state, and settings dialogs.
 * Actual detail rendering is delegated to ShipDetailPanel and EquipDetailPanel.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";
import { buildShareDetailUrl, copyTextWithFallback } from "@/utils/share-url";
import { bannerUrl } from "@/features/simulator/equip-calc";
import { ShipListRow } from "@/components/common/solid/ship-list-row";
import {
  getMasterShip,
  getMasterShips,
  getMasterSlotItem,
  getMasterSlotItems,
  hasMasterData,
} from "@/features/simulator/simulator-selectors";
import {
  ENEMY_ID_THRESHOLD,
  STYPE_NAMES,
  STYPE_SHORT,
} from "@/features/simulator/constants";
import { VList } from "virtua/solid";
import type { VListHandle } from "virtua/solid";
import type {
  MstShipData,
  MstSlotItemData,
} from "@/features/simulator/types";
import { equipDisplayTypeName, groupBy } from "@/features/simulator/display-utils";
import {
  DEFAULT_EXPAND_SETTINGS,
  type ListExpandSettings,
} from "@/features/simulator/synergy-utils";
import { ShipDetailPanel } from "./ship-detail-panel";
import { EquipDetailPanel } from "./equip-detail-panel";
import {
  EquipListRow,
  WeaponIcon,
  ImageFallbackBox,
  ShipTypeIcon,
} from "./shared-ui";
import { ItemPickerModal } from "./item-picker-modal";

type DetailsTab = "ship" | "equip";
type MobilePickerDisplayMode = "sticky" | "floating";

function SimulatorDetailsCatalog(): JSX.Element {
  const [tab, setTab] = createSignal<DetailsTab>("ship");
  const [shipQuery, setShipQuery] = createSignal("");
  const [equipQuery, setEquipQuery] = createSignal("");
  const [selectedShipCategory, setSelectedShipCategory] = createSignal("all");
  const [selectedEquipCategory, setSelectedEquipCategory] = createSignal("all");
  const [selectedShipId, setSelectedShipId] = createSignal<number | null>(null);
  const [selectedEquipId, setSelectedEquipId] = createSignal<number | null>(
    null,
  );
  const [initialShipIdFromUrl, setInitialShipIdFromUrl] = createSignal<
    number | null
  >(null);
  const [initialEquipIdFromUrl, setInitialEquipIdFromUrl] = createSignal<
    number | null
  >(null);
  const [urlStateReady, setUrlStateReady] = createSignal(false);
  const [expandSettings, setExpandSettings] = createSignal<ListExpandSettings>(
    DEFAULT_EXPAND_SETTINGS,
  );
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  let settingsDialogRef!: HTMLDialogElement;
  const [helpOpen, setHelpOpen] = createSignal(false);
  let helpDialogRef!: HTMLDialogElement;
  const [shipPickerOpen, setShipPickerOpen] = createSignal(false);
  let shipPickerDialogRef!: HTMLDialogElement;
  const [equipPickerOpen, setEquipPickerOpen] = createSignal(false);
  let equipPickerDialogRef!: HTMLDialogElement;
  const [mobilePickerDisplayMode, setMobilePickerDisplayMode] =
    createSignal<MobilePickerDisplayMode>("sticky");

  const allExpanded = createMemo(() => {
    const s = expandSettings();
    return (
      s.expandEquippableEquip &&
      s.expandSingleSynergy &&
      s.expandPairSynergy &&
      s.expandMultiSynergy &&
      s.expandSynergyShips &&
      s.expandCompatibleShips
    );
  });

  createEffect(() => {
    if (settingsOpen()) settingsDialogRef.showModal();
    else settingsDialogRef.close();
  });

  createEffect(() => {
    if (helpOpen()) helpDialogRef.showModal();
    else helpDialogRef.close();
  });

  createEffect(() => {
    if (shipPickerOpen()) shipPickerDialogRef?.showModal();
    else shipPickerDialogRef?.close();
  });

  createEffect(() => {
    if (equipPickerOpen()) equipPickerDialogRef?.showModal();
    else equipPickerDialogRef?.close();
  });

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab");
    if (initialTab === "ship" || initialTab === "equip") {
      setTab(initialTab);
    }
    setInitialShipIdFromUrl(parsePositiveInt(params.get("ship")));
    setInitialEquipIdFromUrl(parsePositiveInt(params.get("equip")));
    setUrlStateReady(true);

    window.addEventListener("simulator-tab-changed", (e: any) => {
      const newTab = e.detail;
      if (newTab === "ship" || newTab === "equip") {
        setTab(newTab);
      }
    });

    window.addEventListener("simulator-master-data-loaded", () => {
      setDataLoaded(true);
    });
  });

  createEffect(() => {
    // Notify external tab system when tab changes internally
    window.dispatchEvent(
      new CustomEvent("simulator-tab-changed-sync", { detail: tab() }),
    );
  });

  const [dataLoaded, setDataLoaded] = createSignal(hasMasterData());

  const allShips = createMemo(() => {
    if (!dataLoaded()) return [];
    return Object.values(getMasterShips())
      .filter((ship) => ship.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => (a.sort_id ?? a.id) - (b.sort_id ?? b.id));
  });

  const allEquips = createMemo(() => {
    if (!dataLoaded()) return [];
    return Object.values(getMasterSlotItems())
      .filter((equip) => equip.id < ENEMY_ID_THRESHOLD)
      .sort((a, b) => a.sortno - b.sortno);
  });

  const shipCategories = createMemo(() =>
    [
      ...new Set(
        allShips().map(
          (ship) => STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`,
        ),
      ),
    ].sort((a, b) => a.localeCompare(b, "ja")),
  );

  const equipCategories = createMemo(() =>
    [...new Set(allEquips().map((equip) => equipDisplayTypeName(equip)))].sort(
      (a, b) => a.localeCompare(b, "ja"),
    ),
  );

  const filteredShips = createMemo(() => {
    const selectedCategory = selectedShipCategory();
    const q = shipQuery().trim().toLowerCase();
    return allShips().filter((ship) => {
      const category = STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`;
      if (selectedCategory !== "all" && category !== selectedCategory)
        return false;
      if (!q) return true;
      return ship.name.toLowerCase().includes(q) || String(ship.id).includes(q);
    });
  });

  const filteredEquips = createMemo(() => {
    const selectedCategory = selectedEquipCategory();
    const q = equipQuery().trim().toLowerCase();
    return allEquips().filter((equip) => {
      const category = equipDisplayTypeName(equip);
      if (selectedCategory !== "all" && category !== selectedCategory)
        return false;
      if (!q) return true;
      return (
        equip.name.toLowerCase().includes(q) || String(equip.id).includes(q)
      );
    });
  });

  const selectedShip = createMemo(() => {
    const id = selectedShipId();
    return id == null ? null : getMasterShip(id);
  });

  const selectedEquip = createMemo(() => {
    const id = selectedEquipId();
    return id == null ? null : getMasterSlotItem(id);
  });

  const selectedShipSummary = createMemo(() => {
    const ship = selectedShip();
    return ship ? ship.name : "未選択";
  });

  const selectedEquipSummary = createMemo(() => {
    const equip = selectedEquip();
    return equip ? equip.name : "未選択";
  });

  const groupedShips = createMemo(() =>
    groupBy(
      filteredShips(),
      (ship) => STYPE_NAMES[ship.stype] ?? `艦種${ship.stype}`,
    ),
  );

  const flatShips = createMemo(() => {
    const flat: Array<
      { type: "header"; key: string } | { type: "ship"; data: MstShipData }
    > = [];
    for (const group of groupedShips()) {
      flat.push({ type: "header", key: group.key });
      for (const ship of group.items) {
        flat.push({ type: "ship", data: ship });
      }
    }
    return flat;
  });

  const groupedEquips = createMemo(() =>
    groupBy(filteredEquips(), (equip) => equipDisplayTypeName(equip)),
  );

  const shipQuickAccessItems = createMemo(() =>
    groupedShips().map((group) => {
      const stype = group.items[0]?.stype ?? 0;
      return {
        key: group.key,
        label: STYPE_SHORT[stype] ?? group.key,
        icon: <ShipTypeIcon stype={stype} size={14} />,
      };
    }),
  );

  const equipQuickAccessItems = createMemo(() =>
    groupedEquips().map((group) => {
      const iconNum = group.items[0]?.type?.[3] ?? 0;
      return {
        key: group.key,
        label: group.key,
        icon: <WeaponIcon iconNum={iconNum} size={14} />,
      };
    }),
  );

  const flatEquips = createMemo(() => {
    const flat: Array<
      { type: "header"; key: string } | { type: "equip"; data: MstSlotItemData }
    > = [];
    for (const group of groupedEquips()) {
      flat.push({ type: "header", key: group.key });
      for (const equip of group.items) {
        flat.push({ type: "equip", data: equip });
      }
    }
    return flat;
  });

  let shipVListRef: VListHandle | undefined;
  let equipVListRef: VListHandle | undefined;

  // URLから直接開いた際など、一度だけ該当アイテムが見えるようにスクロールする
  let hasScrolledInitialShip = false;
  createEffect(() => {
    const id = selectedShipId();
    if (id && shipVListRef && !hasScrolledInitialShip) {
      const idx = flatShips().findIndex(
        (r) => r.type === "ship" && r.data.id === id,
      );
      if (idx >= 0) {
        hasScrolledInitialShip = true;
        shipVListRef.scrollToIndex(idx, { align: "center" });
      }
    }
  });

  let hasScrolledInitialEquip = false;
  createEffect(() => {
    const id = selectedEquipId();
    if (id && equipVListRef && !hasScrolledInitialEquip) {
      const idx = flatEquips().findIndex(
        (r) => r.type === "equip" && r.data.id === id,
      );
      if (idx >= 0) {
        hasScrolledInitialEquip = true;
        equipVListRef.scrollToIndex(idx, { align: "center" });
      }
    }
  });

  function parsePositiveInt(raw: string | null): number | null {
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
  }

  function buildCurrentShareUrl(): string | null {
    const currentTab = tab();
    const currentShipId = selectedShipId();
    const currentEquipId = selectedEquipId();
    const key =
      currentTab === "ship"
        ? currentShipId != null
          ? `ship:${currentShipId}`
          : null
        : currentEquipId != null
          ? `equip:${currentEquipId}`
          : null;
    if (!key) return null;

    return buildShareDetailUrl(window.location.origin, {
      kind: currentTab,
      id: currentTab === "ship" ? currentShipId! : currentEquipId!,
    });
  }

  async function issueShareUrl(): Promise<void> {
    const shareUrl = buildCurrentShareUrl();
    if (!shareUrl) {
      alert("共有URLを生成できませんでした。艦または装備を選択してください。");
      return;
    }

    const copied = await copyTextWithFallback(shareUrl);
    if (copied) {
      alert("共有URLをクリップボードにコピーしました");
      return;
    }

    window.prompt(
      "自動コピーに失敗しました。以下を手動でコピーしてください:",
      shareUrl,
    );
  }

  createEffect(() => {
    if (selectedShipId() == null && allShips().length > 0) {
      setSelectedShipId(allShips()[0].id);
    }
    if (selectedEquipId() == null && allEquips().length > 0) {
      setSelectedEquipId(allEquips()[0].id);
    }
  });

  // Apply URL-specified ship/equip IDs once master data loads.
  createEffect(() => {
    if (!urlStateReady() || !dataLoaded()) return;
    const shipFromQuery = initialShipIdFromUrl();
    if (shipFromQuery != null && getMasterShip(shipFromQuery)) {
      setSelectedShipId(shipFromQuery);
    }

    const equipFromQuery = initialEquipIdFromUrl();
    if (equipFromQuery != null && getMasterSlotItem(equipFromQuery)) {
      setSelectedEquipId(equipFromQuery);
    }
  });

  createEffect(() => {
    if (!urlStateReady()) return;
    const currentTab = tab();
    const currentShipId = selectedShipId();
    const currentEquipId = selectedEquipId();
    const url = new URL(window.location.href);
    url.searchParams.set("tab", currentTab);

    if (currentTab === "ship" && currentShipId != null) {
      url.searchParams.set("ship", String(currentShipId));
    } else {
      url.searchParams.delete("ship");
    }

    if (currentTab === "equip" && currentEquipId != null) {
      url.searchParams.set("equip", String(currentEquipId));
    } else {
      url.searchParams.delete("equip");
    }

    window.history.replaceState(window.history.state, "", url.toString());
  });

  onMount(() => {
    const btnSettings = document.getElementById("sim-details-settings-btn");
    const btnHelp = document.getElementById("sim-details-help-btn");
    const btnShare = document.getElementById("sim-details-share-btn");

    const onSettingsClick = () => setSettingsOpen(true);
    const onHelpClick = () => setHelpOpen(true);
    const onShareClick = () => void issueShareUrl();

    btnSettings?.addEventListener("click", onSettingsClick);
    btnHelp?.addEventListener("click", onHelpClick);
    btnShare?.addEventListener("click", onShareClick);

    onCleanup(() => {
      btnSettings?.removeEventListener("click", onSettingsClick);
      btnHelp?.removeEventListener("click", onHelpClick);
      btnShare?.removeEventListener("click", onShareClick);
    });
  });

  return (
    <div class="space-y-4">
      <dialog
        ref={settingsDialogRef}
        class="modal"
        onClose={() => setSettingsOpen(false)}
      >
        <div class="modal-box rounded-xl">
          <h3 class="font-bold text-lg mb-1">表示設定</h3>
          <p class="text-xs text-base-content/60 mb-4">
            各リストをスクロールなしで全件表示するかどうかを設定します。
          </p>
          <div class="space-y-3 text-sm">
            {/* ── すべて展開 ── */}
            <label class="label w-full cursor-pointer justify-start gap-3 py-1">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={allExpanded()}
                onChange={(e) =>
                  setExpandSettings((prev) => ({
                    ...prev,
                    expandEquippableEquip: e.currentTarget.checked,
                    expandSingleSynergy: e.currentTarget.checked,
                    expandPairSynergy: e.currentTarget.checked,
                    expandMultiSynergy: e.currentTarget.checked,
                    expandSynergyShips: e.currentTarget.checked,
                    expandCompatibleShips: e.currentTarget.checked,
                  }))
                }
              />
              <span class="label-text font-medium">すべてのリストを展開</span>
            </label>

            {/* ── モバイル選択ボタン表示 ── */}
            <div class="pt-1">
              <p class="text-xs text-base-content/50 font-medium">
                モバイル選択ボタン表示
              </p>
              <div class="mt-1 space-y-1 pl-1">
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    id="mobile-picker-mode-sticky"
                    type="radio"
                    name="mobile-picker-display-mode"
                    class="radio radio-sm"
                    checked={mobilePickerDisplayMode() === "sticky"}
                    onChange={() => setMobilePickerDisplayMode("sticky")}
                  />
                  <span class="label-text">スティッキー（ナビゲーション下に固定）</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    id="mobile-picker-mode-floating"
                    type="radio"
                    name="mobile-picker-display-mode"
                    class="radio radio-sm"
                    checked={mobilePickerDisplayMode() === "floating"}
                    onChange={() => setMobilePickerDisplayMode("floating")}
                  />
                  <span class="label-text">フローティング（画面左下）</span>
                </label>
              </div>
            </div>

            {/* ── 艦詳細 ── */}
            <div class="pt-1">
              <p class="text-xs text-base-content/50 font-medium">艦詳細</p>
              <div class="mt-1 space-y-0.5 pl-1">
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().showMultiSynergy}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        showMultiSynergy: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">3装備以上のシナジーを表示</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().expandEquippableEquip}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        expandEquippableEquip: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">装備可能な装備のリストを展開する</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().expandSingleSynergy}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        expandSingleSynergy: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">単体装備シナジーのリストを展開する</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().expandPairSynergy}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        expandPairSynergy: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">装備組み合わせシナジーのリストを展開する</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().expandMultiSynergy}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        expandMultiSynergy: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">3装備以上の装備組み合わせのリストを展開する</span>
                </label>
              </div>
            </div>

            {/* ── 装備詳細 ── */}
            <div class="pt-1">
              <p class="text-xs text-base-content/50 font-medium">装備詳細</p>
              <div class="mt-1 space-y-0.5 pl-1">
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().showMultiSynergyEquip}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        showMultiSynergyEquip: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">3装備以上の装備組み合わせを表示する</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().expandSynergyShips}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        expandSynergyShips: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">シナジー対象艦のリストを展開する</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().expandCompatibleShips}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        expandCompatibleShips: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">装備可能な艦のリストを展開する</span>
                </label>
                <label class="label w-full cursor-pointer justify-start gap-3 py-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm shrink-0"
                    checked={expandSettings().expandMultiSynergy}
                    onChange={(e) =>
                      setExpandSettings((prev) => ({
                        ...prev,
                        expandMultiSynergy: e.currentTarget.checked,
                      }))
                    }
                  />
                  <span class="label-text">3装備以上の装備組み合わせのリストを展開する</span>
                </label>
              </div>
            </div>
          </div>
          <div class="modal-action">
            <button
              class="btn btn-primary btn-sm"
              onClick={() => setSettingsOpen(false)}
            >
              閉じる
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      <dialog
        ref={helpDialogRef}
        class="modal"
        onClose={() => setHelpOpen(false)}
      >
        <div class="modal-box rounded-xl max-w-2xl max-h-[82vh] overflow-y-auto">
          <h3 class="font-bold text-lg mb-4">使い方 / 表示の見かた</h3>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-2 text-base-content/80">
              ページ概要
            </h4>
            <p class="text-sm text-base-content/70 leading-relaxed">
              艦・装備のマスターデータを検索・閲覧できます。
              <strong>艦詳細</strong>
              タブでは艦のステータス・搭載可能装備・装備シナジーを、
              <strong>装備詳細</strong>
              タブでは装備のステータス・シナジー対象艦・装備可能艦を確認できます。
            </p>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-2 text-base-content/80">
              表示ラベルの規則
            </h4>
            <div class="overflow-x-auto rounded-lg border border-base-300/70">
              <table class="table table-sm w-full text-sm">
                <thead>
                  <tr class="text-base-content/60">
                    <th class="w-32">ラベル</th>
                    <th>意味</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td class="font-medium">基本</td>
                    <td class="text-base-content/70">
                      ★0 で1枠装備したときの追加ステータス
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">改修★10</td>
                    <td class="text-base-content/70">
                      ★10
                      で1枠装備したときのボーナス（基本と値が異なる場合のみ表示）
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">2積み</td>
                    <td class="text-base-content/70">
                      同じ装備を2枠装備したときの<strong>合計</strong>
                      ボーナス（単純に 基本×2 と異なる場合のみ表示）
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">3積み以上</td>
                    <td class="text-base-content/70">
                      同じ装備を3枠以上装備したときの合計ボーナス（2積みと値が異なる場合のみ表示）
                    </td>
                  </tr>
                  <tr>
                    <td class="font-medium">2積み以上</td>
                    <td class="text-base-content/70">
                      2積みと3積みで合計ボーナスが同じとき、まとめて表示
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                        対空+2
                      </span>
                    </td>
                    <td class="text-base-content/70">
                      青バッジ — バフ（プラス効果）
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-sm font-mono border-error/45 text-error">
                        対空-2
                      </span>
                    </td>
                    <td class="text-base-content/70">
                      赤バッジ — デバフ（マイナス効果）
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-warning badge-xs">補強のみ</span>
                    </td>
                    <td class="text-base-content/70">
                      補強増設スロットにのみ装備可能
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span class="badge badge-outline badge-xs border-warning text-warning">
                        補強★5
                      </span>
                    </td>
                    <td class="text-base-content/70">
                      補強増設スロットへの装備に改修値またはそうていが必要
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-3 text-base-content/80">
              装備シナジーの計算方法
            </h4>
            <div class="space-y-3 text-sm text-base-content/70 leading-relaxed">
              <p>
                装備によるステータス増減は <strong>単体装備シナジー</strong> と{" "}
                <strong>装備組み合わせシナジー</strong>{" "}
                の2種類があり、それらの合計が実際の効果です。
              </p>
              <div class="rounded-lg bg-base-200 border border-base-300/70 px-4 py-3 font-mono text-xs text-center">
                合計効果 ＝ Σ（単体シナジー） ＋ Σ（組み合わせシナジー）
              </div>
              <ul class="space-y-1 list-disc list-inside text-base-content/65">
                <li>
                  <strong>単体装備シナジー</strong>
                  ：その装備を1枠でも持つだけで発動するボーナス
                </li>
                <li>
                  <strong>装備組み合わせシナジー</strong>
                  ：特定の2種類を同時装備したときに加算される追加効果（単体シナジーとは独立して加減算される）
                </li>
              </ul>
            </div>
          </section>

          <section class="mb-5">
            <h4 class="font-semibold text-sm mb-3 text-base-content/80">
              計算例
            </h4>
            <div class="space-y-4 text-sm">
              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">例1 — 単体バフ ＋ 組み合わせバフ</p>
                <div class="space-y-1 text-base-content/70">
                  <p>
                    装備A（単体シナジー:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+3
                    </span>
                    ）と 装備B（単体シナジー: なし）を同時装備
                  </p>
                  <p>
                    組み合わせシナジー A＋B:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+2
                    </span>
                  </p>
                  <p class="mt-2 font-medium text-base-content">
                    → 対空ボーナス合計 ＝ +3（単体A）＋ 0（単体B）＋
                    +2（組み合わせ）＝ <span class="text-info">+5</span>
                  </p>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">
                  例2 — 組み合わせシナジーがデバフ（赤）の場合
                </p>
                <div class="space-y-1 text-base-content/70">
                  <p>
                    装備X（単体シナジー:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+4
                    </span>
                    ）と 装備Z（単体シナジー:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+1
                    </span>
                    ）を同時装備
                  </p>
                  <p>
                    組み合わせシナジー X＋Z:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-error/45 text-error">
                      対空-2
                    </span>
                  </p>
                  <p class="mt-2 font-medium text-base-content">
                    → 対空ボーナス合計 ＝ +4（単体X）＋ +1（単体Z）＋
                    (−2)（組み合わせ）＝ <span class="text-info">+3</span>
                  </p>
                  <p class="text-xs text-base-content/55 mt-1">
                    組み合わせが赤（デバフ）でも単体シナジーは別途有効。単体の+効果が完全に消えるわけではない。
                  </p>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">
                  例3 — 2積みシナジーの読み方（表示値 ＝ <em>合計</em>）
                </p>
                <div class="space-y-1 text-base-content/70">
                  <p>装備Wの単体シナジー</p>
                  <p class="pl-3">
                    基本:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+3
                    </span>
                  </p>
                  <p class="pl-3">
                    2積み:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      対空+4
                    </span>
                    　← これは2枠装備時の<strong>合計</strong>ボーナス
                  </p>
                  <div class="mt-2 space-y-0.5 font-medium text-base-content">
                    <p>
                      1枠装備時の対空ボーナス ＝{" "}
                      <span class="text-info">+3</span>
                    </p>
                    <p>
                      2枠装備時の対空ボーナス ＝{" "}
                      <span class="text-info">+4</span>（単純な 2×3＝+6
                      にはならない）
                    </p>
                    <p>
                      2枠目の追加分 ＝ +4 − +3 ＝{" "}
                      <span class="text-base-content/70">+1 のみ</span>
                    </p>
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-base-300/70 p-3">
                <p class="font-medium mb-2">
                  例4 — 2積みと3積みでシナジーが異なる場合
                </p>
                <div class="space-y-1 text-base-content/70">
                  <p>
                    基本:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      火力+1
                    </span>
                    　2積み:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      火力+3
                    </span>
                    　3積み以上:{" "}
                    <span class="badge badge-outline badge-sm font-mono border-info/55 text-info">
                      火力+4
                    </span>
                  </p>
                  <div class="mt-2 space-y-0.5 font-medium text-base-content">
                    <p>
                      1枠: <span class="text-info">+1</span>　／　2枠:{" "}
                      <span class="text-info">+3</span>（2枠目の追加
                      +2）　／　3枠以上: <span class="text-info">+4</span>
                      （3枠目の追加 +1）
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="modal-action">
            <button
              class="btn btn-primary btn-sm"
              onClick={() => setHelpOpen(false)}
            >
              閉じる
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>

      <ItemPickerModal
        id="ship-mobile-picker-dialog"
        dialogRef={(el) => { shipPickerDialogRef = el; }}
        title="艦選択"
        currentSummary={selectedShipSummary()}
        category={selectedShipCategory()}
        onCategoryChange={setSelectedShipCategory}
        categories={shipCategories()}
        allOptionLabel="すべての艦種"
        searchId="sim-details-search-input-mobile"
        searchAriaLabel="艦名検索"
        searchPlaceholder="艦名 / ID で検索"
        searchValue={shipQuery()}
        onSearchInput={setShipQuery}
        flatItems={flatShips()}
        quickAccessItems={shipQuickAccessItems()}
        onClose={() => setShipPickerOpen(false)}
        renderRow={(item: any) => (
          <ShipListRow
            ship={item}
            active={selectedShipId() === item.id}
            onSelect={() => {
              setSelectedShipId(item.id);
              setShipPickerOpen(false);
            }}
          />
        )}
      />

      <ItemPickerModal
        id="equip-mobile-picker-dialog"
        dialogRef={(el) => { equipPickerDialogRef = el; }}
        title="装備選択"
        currentSummary={selectedEquipSummary()}
        category={selectedEquipCategory()}
        onCategoryChange={setSelectedEquipCategory}
        categories={equipCategories()}
        allOptionLabel="すべての装備種別"
        searchId="sim-details-equip-search-input-mobile"
        searchAriaLabel="装備名検索"
        searchPlaceholder="装備名 / ID で検索"
        searchValue={equipQuery()}
        onSearchInput={setEquipQuery}
        flatItems={flatEquips()}
        quickAccessItems={equipQuickAccessItems()}
        onClose={() => setEquipPickerOpen(false)}
        renderRow={(item: any) => (
          <EquipListRow
            equip={item}
            active={selectedEquipId() === item.id}
            onSelect={() => {
              setSelectedEquipId(item.id);
              setEquipPickerOpen(false);
            }}
          />
        )}
      />

      <Show when={tab() === "ship"}>
        <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
          <aside class="hidden xl:flex rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden flex-col xl:sticky xl:top-20 xl:h-[calc(100vh-5.5rem)]">
            <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
              <select
                class="select select-bordered select-sm w-full"
                aria-label="艦種フィルター"
                value={selectedShipCategory()}
                onChange={(event) =>
                  setSelectedShipCategory(event.currentTarget.value)
                }
              >
                <option value="all">すべての艦種</option>
                <For each={shipCategories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
              <input
                id="sim-details-search-input"
                class="input input-bordered input-sm w-full"
                aria-label="艦名検索"
                placeholder="艦名 / ID で検索"
                value={shipQuery()}
                onInput={(event) => setShipQuery(event.currentTarget.value)}
              />
            </div>
            <div class="p-2 flex-1 min-h-0">
              <VList
                ref={(el) => {
                  shipVListRef = el;
                }}
                data={flatShips()}
                class="h-full overflow-y-auto overflow-x-hidden"
              >
                {(item: any) =>
                  item.type === "header" ? (
                    <div class="mb-2 mt-1 first:mt-0">
                      <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase bg-base-100/95 backdrop-blur-sm z-10">
                        {item.key}
                      </h4>
                    </div>
                  ) : (
                    <div class="mb-0.5">
                      <ShipListRow
                        ship={item.data}
                        active={selectedShipId() === item.data.id}
                        onSelect={() => setSelectedShipId(item.data.id)}
                      />
                    </div>
                  )
                }
              </VList>
            </div>
          </aside>

          <div class="min-w-0 space-y-2">
            <div
              class={
                mobilePickerDisplayMode() === "sticky"
                  ? "sticky top-20 z-30 xl:hidden"
                  : "fixed bottom-4 left-4 z-40 xl:hidden max-w-[calc(100vw-2rem)]"
              }
            >
              <button
                id="ship-mobile-picker-btn"
                class={
                  mobilePickerDisplayMode() === "sticky"
                    ? "btn btn-sm btn-outline border-base-300 bg-base-100/95 text-base-content w-full justify-start gap-2 shadow-sm backdrop-blur"
                    : "btn btn-sm btn-outline border-base-300 bg-base-100/95 text-base-content justify-start gap-2 shadow-md backdrop-blur"
                }
                type="button"
                onClick={() => setShipPickerOpen(true)}
              >
                <Show
                  when={selectedShip()}
                  fallback={
                    <span class="inline-flex w-16 h-6 items-center justify-center rounded bg-base-200/70 text-[11px] text-base-content/55">
                      No Image
                    </span>
                  }
                >
                  {(ship) => (
                    <ImageFallbackBox
                      src={bannerUrl(ship().id, { f: "auto" })}
                      alt={ship().name}
                      class="w-16 h-6 rounded shrink-0"
                      fallbackText="No Image"
                      loading="lazy"
                    />
                  )}
                </Show>
                <span class="truncate max-w-[42vw]">{selectedShipSummary()}</span>
                {/* モーダル開示インジケーター */}
                <span class="ml-auto shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-primary/15 text-primary" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
                    <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                  </svg>
                </span>
              </button>
            </div>

            <Show
              when={selectedShip()}
              fallback={
                <div class="rounded-xl border border-base-300/70 bg-base-100 p-4 text-base-content/50">
                  艦を選択してください。
                </div>
              }
            >
              {(ship) => (
                <ShipDetailPanel
                  ship={ship()}
                  onOpenEquip={(equipId) => {
                    setSelectedEquipId(equipId);
                    setTab("equip");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  expandEquippableEquip={expandSettings().expandEquippableEquip}
                  expandSingleSynergy={expandSettings().expandSingleSynergy}
                  expandPairSynergy={expandSettings().expandPairSynergy}
                  expandMultiSynergy={expandSettings().expandMultiSynergy}
                  showMultiSynergy={expandSettings().showMultiSynergy}
                />
              )}
            </Show>
          </div>
        </section>
      </Show>

      <Show when={tab() === "equip"}>
        <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 items-start">
          <aside class="hidden xl:flex rounded-xl border border-base-300/70 bg-base-100 shadow-sm overflow-hidden flex-col xl:sticky xl:top-20 xl:h-[calc(100vh-5.5rem)]">
            <div class="p-3 border-b border-base-200 bg-base-50/50 space-y-2">
              <select
                class="select select-bordered select-sm w-full"
                aria-label="装備種別フィルター"
                value={selectedEquipCategory()}
                onChange={(event) =>
                  setSelectedEquipCategory(event.currentTarget.value)
                }
              >
                <option value="all">すべての装備種別</option>
                <For each={equipCategories()}>
                  {(category) => <option value={category}>{category}</option>}
                </For>
              </select>
              <input
                class="input input-bordered input-sm w-full"
                aria-label="装備名検索"
                placeholder="装備名 / ID で検索"
                value={equipQuery()}
                onInput={(event) => setEquipQuery(event.currentTarget.value)}
              />
            </div>
            <div class="p-2 flex-1 min-h-0">
              <VList
                ref={(el) => {
                  equipVListRef = el;
                }}
                data={flatEquips()}
                class="h-full overflow-y-auto overflow-x-hidden"
              >
                {(item: any) =>
                  item.type === "header" ? (
                    <div class="mb-2 mt-1 first:mt-0">
                      <h4 class="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-base-content/45 uppercase bg-base-100/95 backdrop-blur-sm z-10">
                        {item.key}
                      </h4>
                    </div>
                  ) : (
                    <div class="mb-0.5">
                      <EquipListRow
                        equip={item.data}
                        active={selectedEquipId() === item.data.id}
                        onSelect={() => setSelectedEquipId(item.data.id)}
                      />
                    </div>
                  )
                }
              </VList>
            </div>
          </aside>

          <div class="min-w-0 space-y-2">
            <div
              class={
                mobilePickerDisplayMode() === "sticky"
                  ? "sticky top-20 z-30 xl:hidden"
                  : "fixed bottom-4 left-4 z-40 xl:hidden max-w-[calc(100vw-2rem)]"
              }
            >
              <button
                id="equip-mobile-picker-btn"
                class={
                  mobilePickerDisplayMode() === "sticky"
                    ? "btn btn-sm btn-outline border-base-300 bg-base-100/95 text-base-content w-full justify-start gap-2 shadow-sm backdrop-blur"
                    : "btn btn-sm btn-outline border-base-300 bg-base-100/95 text-base-content justify-start gap-2 shadow-md backdrop-blur"
                }
                type="button"
                onClick={() => setEquipPickerOpen(true)}
              >
                <span class="inline-flex w-6 h-6 items-center justify-center rounded bg-base-200/70 shrink-0">
                  <WeaponIcon iconNum={selectedEquip()?.type?.[3] ?? 0} />
                </span>
                <span class="truncate max-w-[42vw]">{selectedEquipSummary()}</span>
                {/* モーダル開示インジケーター */}
                <span class="ml-auto shrink-0 inline-flex items-center justify-center w-5 h-5 rounded bg-primary/15 text-primary" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
                    <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                  </svg>
                </span>
              </button>
            </div>

            <Show
              when={selectedEquip()}
              fallback={
                <div class="rounded-xl border border-base-300/70 bg-base-100 p-4 text-base-content/50">
                  装備を選択してください。
                </div>
              }
            >
              {(equip) => (
                <EquipDetailPanel
                  equip={equip()}
                  onOpenShip={(shipId) => {
                    setSelectedShipId(shipId);
                    setTab("ship");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  onOpenEquip={(equipId) => {
                    setSelectedEquipId(equipId);
                    setTab("equip");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  expandSynergyShips={expandSettings().expandSynergyShips}
                  expandMultiSynergy={expandSettings().expandMultiSynergy}
                  expandCompatibleShips={expandSettings().expandCompatibleShips}
                  showMultiSynergy={expandSettings().showMultiSynergyEquip}
                />
              )}
            </Show>
          </div>
        </section>
      </Show>
    </div>
  );
}

export function mountSimulatorDetailsCatalog(root: HTMLElement): void {
  if (root.hasChildNodes()) return;
  render(() => <SimulatorDetailsCatalog />, root);
}
