/** @jsxImportSource solid-js */
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { useStore } from "@nanostores/solid";
import { simulatorDisplayRevision, simulatorCombinedFleetType } from "@/features/simulator/state";
import { isFleetSectionVisible, isAirbaseSectionVisible, getVisibleAirbaseCount, getFleetState } from "@/features/simulator/simulator-selectors";
import { setFleetSectionVisible, setCombinedFleetType } from "@/features/simulator/simulator-mutations";
import { writeDisplaySettings } from "@/features/simulator/airbase-renderer";
import { validateCombinedFleet } from "@/features/simulator/combined-fleet";
import { FleetSlotsView, AirBaseView } from "@/components/features/simulator/solid/simulator-renderer";
import { workspaceStore, type ViewerEntry } from "@/features/simulator/viewer-workspace";
import { workspaceSaveStatus, workspaceLastSavedAt } from "@/features/simulator/io-handlers";

export function SimulatorFleetTab(props?: { onOpenWorkspace?: () => void }) {
  const ws = useStore(workspaceStore);
  const saveStatus = useStore(workspaceSaveStatus);
  const lastSavedAt = useStore(workspaceLastSavedAt);

  const activeEntry = () => ws().activeId ? ws().entries.find((e: ViewerEntry) => e.id === ws().activeId) : null;
  const isPlayground = () => ws().activeId === null;
  const isOwnDeck = () => activeEntry()?.sourceType === "ownDeck";
  const isLocked = () => activeEntry()?.locked ?? false;
  const isReadOnlyUrl = () => !!activeEntry() && activeEntry()?.sourceType !== "ownDeck";

  const lastSavedText = () => {
    const ts = lastSavedAt() || activeEntry()?.updatedAt;
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
  };
  const displayRev = useStore(simulatorDisplayRevision);
  const combinedType = useStore(simulatorCombinedFleetType);

  const getFleetVisible = (i: number) => { displayRev(); return isFleetSectionVisible(i); };
  const airbaseVisible = () => { displayRev(); return isAirbaseSectionVisible(); };
  const airbaseCount = () => { displayRev(); return getVisibleAirbaseCount(); };

  const [windowWidth, setWindowWidth] = createSignal(typeof window !== "undefined" ? window.innerWidth : 1200);
  onMount(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });

  const isMobileSingleColumn = () => windowWidth() < 640;
  // 900px 付近（640px〜1023px）の中画面幅ではカードの視認性を考慮して 2x3（2列×3行）
  const isTwoColumn = () => windowWidth() >= 640 && windowWidth() < 1024;

  const fleetSectionMaxWidth = () => {
    if (isMobileSingleColumn()) return "26rem";
    if (isTwoColumn()) return "52rem";
    return "76rem";
  };

  const fleetGridCols = () => {
    if (isMobileSingleColumn()) return "minmax(0, 1fr)";
    if (isTwoColumn()) return "repeat(2, minmax(0, 1fr))";
    return "repeat(3, minmax(0, 1fr))";
  };

  // 各艦隊は画面幅によらず常に縦方向（1カラム、スタック）に並べる（第1艦隊と第2艦隊の横並びは完全防止）
  const fleetSectionsStyle = () => {
    return {
      "display": "grid",
      "justify-content": "center",
      "gap": "1.25rem",
      "margin-bottom": "1.25rem",
      "grid-template-columns": `minmax(0, ${fleetSectionMaxWidth()})`
    };
  };

  const combinedLabel: Record<number, string> = { 1: "機動部隊", 2: "水上打撃部隊", 3: "輸送護衛部隊" };

  const fleetMode = () => {
    displayRev();
    const cType = combinedType();
    if (cType === 1) return "combined-carrier";
    if (cType === 2) return "combined-surface";
    if (cType === 3) return "combined-transport";
    if (isFleetSectionVisible(3) && !isFleetSectionVisible(1)) return "strike";
    return "normal";
  };

  const handleFleetModeChange = (val: string) => {
    if (val === "normal") {
      setCombinedFleetType(0);
      setFleetSectionVisible(1, true);
      setFleetSectionVisible(2, false);
      setFleetSectionVisible(3, false);
      setFleetSectionVisible(4, false);
    } else if (val === "combined-carrier") {
      setCombinedFleetType(1);
      setFleetSectionVisible(1, true);
      setFleetSectionVisible(2, true);
      setFleetSectionVisible(3, false);
      setFleetSectionVisible(4, false);
    } else if (val === "combined-surface") {
      setCombinedFleetType(2);
      setFleetSectionVisible(1, true);
      setFleetSectionVisible(2, true);
      setFleetSectionVisible(3, false);
      setFleetSectionVisible(4, false);
    } else if (val === "combined-transport") {
      setCombinedFleetType(3);
      setFleetSectionVisible(1, true);
      setFleetSectionVisible(2, true);
      setFleetSectionVisible(3, false);
      setFleetSectionVisible(4, false);
    } else if (val === "strike") {
      setCombinedFleetType(0);
      setFleetSectionVisible(1, false);
      setFleetSectionVisible(2, false);
      setFleetSectionVisible(3, true);
      setFleetSectionVisible(4, false);
    }
    writeDisplaySettings();
  };
  const combinedValidation = () => {
    const cType = combinedType();
    if (cType === 0) return { ok: true, text: "" };
    const fleets = getFleetState();
    const res = validateCombinedFleet(cType, fleets.fleet1, fleets.fleet2);
    if (res.ok) return { ok: true, text: "" };
    const parts: string[] = [];
    if (res.mainErrors.length > 0) parts.push(`本隊: ${res.mainErrors.join(' / ')}`);
    if (res.escortErrors.length > 0) parts.push(`護衛: ${res.escortErrors.join(' / ')}`);
    return { ok: false, text: parts.join('  |  ') };
  };

  const airbaseCols = () => {
    const maxColsByWidth = windowWidth() >= 1200 ? 3 : windowWidth() >= 768 ? 2 : 1;
    return Math.max(1, Math.min(airbaseCount(), maxColsByWidth));
  };

  return (
    <>
      {/* Active Deck & Auto-save Status Bar */}
      <div id="deck-status-bar" class="mb-3 px-3.5 py-2.5 rounded-lg bg-base-200/50 border border-base-300/60 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        {/* 左側: 現在のデッキ ＆ 艦隊形式クイックセレクター */}
        <div class="flex items-center gap-3 min-w-0 flex-wrap">
          <div class="flex items-center gap-2 min-w-0 h-6">
            <span class="text-base-content/60 shrink-0 font-medium whitespace-nowrap text-xs inline-flex items-center h-6 leading-none">現在のデッキ:</span>
            <Show
              when={activeEntry()}
              fallback={
                <div class="flex items-center gap-1.5 min-w-0 h-6">
                  <span class="font-bold truncate text-xs inline-flex items-center h-6 leading-none text-base-content">Playground</span>
                  <span class="badge badge-ghost badge-xs shrink-0">一時作業領域</span>
                </div>
              }
            >
              {(entry) => (
                <div class="flex items-center gap-1.5 min-w-0 h-6">
                  <span class="font-bold truncate text-xs inline-flex items-center h-6 leading-none text-base-content">{entry().name}</span>
                  <span class={`badge badge-xs font-semibold shrink-0 ${entry().sourceType === "ownDeck" ? "badge-warning" : "badge-accent"}`}>
                    {entry().sourceType === "ownDeck" ? "DECK" : "URL"}
                  </span>
                  <Show when={isLocked()}>
                    <span class="badge badge-error badge-xs shrink-0">LOCK</span>
                  </Show>
                </div>
              )}
            </Show>
          </div>

          <span class="text-base-300 hidden sm:inline-flex items-center h-6 leading-none select-none">|</span>

          {/* クイック艦隊形式切り替え (セレクトとラベルの高さをh-6に同期し完全垂直揃え) */}
          <label for="fleet-mode-selector" class="flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer h-6">
            <span class="text-base-content/60 font-medium whitespace-nowrap shrink-0 text-xs inline-flex items-center h-6 leading-none">艦隊形式:</span>
            <select
              id="fleet-mode-selector"
              class="select select-bordered select-xs text-xs font-semibold bg-base-100 whitespace-nowrap shrink-0 h-6 min-h-6 py-0 leading-none cursor-pointer"
              value={fleetMode()}
              onChange={(e) => handleFleetModeChange(e.currentTarget.value)}
            >
              <option value="normal">通常艦隊 (第1艦隊)</option>
              <option value="combined-carrier">連合艦隊 (機動部隊)</option>
              <option value="combined-surface">連合艦隊 (水上打撃部隊)</option>
              <option value="combined-transport">連合艦隊 (輸送護衛部隊)</option>
              <option value="strike">遊撃艦隊 (第3艦隊)</option>
            </select>
          </label>
        </div>

        {/* 右側: 自動保存インジケータ ＆ ワークスペース */}
        <div class="flex items-center gap-3 shrink-0 whitespace-nowrap">
          <div class="flex items-center gap-1.5 shrink-0" id="deck-autosave-indicator">
            <Show when={saveStatus() === "saving"}>
              <span class="loading loading-spinner loading-xs text-primary"></span>
              <span class="text-primary font-semibold">保存中...</span>
            </Show>
            <Show when={saveStatus() === "saved" && isOwnDeck() && !isLocked()}>
              <svg class="h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
              </svg>
              <span class="text-success font-semibold">自動保存済み</span>
              <Show when={lastSavedText()}>
                <span class="text-base-content/50 text-[11px]">({lastSavedText()})</span>
              </Show>
            </Show>
            <Show when={isLocked()}>
              <span class="text-error font-medium flex items-center gap-1">
                <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clip-rule="evenodd" />
                </svg>
                <span>ロック中（保存されません）</span>
              </span>
            </Show>
            <Show when={isReadOnlyUrl()}>
              <span class="text-base-content/60">共有URL（閲覧専用 / 編集には複製）</span>
            </Show>
            <Show when={isPlayground()}>
              <span class="text-base-content/50">一時作業領域</span>
            </Show>
          </div>

          <Show when={props?.onOpenWorkspace}>
            <span class="text-base-300">|</span>
            <button
              type="button"
              class="fusou-btn-xs-ghost text-xs text-primary underline"
              onClick={() => props?.onOpenWorkspace?.()}
            >
              ワークスペースで管理
            </button>
          </Show>
        </div>
      </div>

      <div id="deck-capture-area">
        <Show when={!combinedValidation().ok}>
          <div id="combined-fleet-validation" class="mb-4">
            <AlertMessage type="warning">
              <span id="combined-fleet-validation-text" class="text-sm">{combinedValidation().text}</span>
            </AlertMessage>
          </div>
        </Show>

        <div id="fleet-sections" style={fleetSectionsStyle()}>
          {/* Fleet 1 */}
          <Show when={getFleetVisible(1)}>
            <section id="fleet-1-section" style={{ "max-width": fleetSectionMaxWidth(), "width": "100%", "justify-self": "center" }} class="bg-base-100 rounded-xl shadow-sm border border-base-300/40 overflow-hidden">
              <div class="px-4 py-3 bg-gradient-to-r from-primary/5 to-transparent border-b border-base-200">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-md bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">1</span>
                    <h3 class="font-semibold text-sm">第1艦隊</h3>
                    <Show when={combinedType() > 0}>
                      <span id="fleet-1-combined-badge" class="badge badge-xs badge-warning px-1 font-bold">{combinedLabel[combinedType()]}</span>
                    </Show>
                  </div>
                </div>
              </div>
              <div id="fleet-1-body" class="p-3">
                <div id="fleet-1-slots" style={{ display: "grid", gap: "0.5rem", "grid-template-columns": fleetGridCols() }}><FleetSlotsView fleetIndex={1} /></div>
              </div>
            </section>
          </Show>

          {/* Fleet 2 */}
          <Show when={getFleetVisible(2)}>
            <section id="fleet-2-section" style={{ "max-width": fleetSectionMaxWidth(), "width": "100%", "justify-self": "center" }} class="bg-base-100 rounded-xl shadow-sm border border-base-300/40 overflow-hidden">
              <div class="px-4 py-3 bg-gradient-to-r from-secondary/5 to-transparent border-b border-base-200">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-md bg-secondary/15 text-secondary flex items-center justify-center text-xs font-bold">2</span>
                    <h3 class="font-semibold text-sm">第2艦隊</h3>
                    <Show when={combinedType() > 0}>
                      <span id="fleet-2-combined-badge" class="badge badge-xs badge-secondary px-1 font-bold">護衛</span>
                    </Show>
                  </div>
                </div>
              </div>
              <div id="fleet-2-body" class="p-3">
                <div id="fleet-2-slots" style={{ display: "grid", gap: "0.5rem", "grid-template-columns": fleetGridCols() }}><FleetSlotsView fleetIndex={2} /></div>
              </div>
            </section>
          </Show>

          {/* Fleet 3 */}
          <Show when={getFleetVisible(3)}>
            <section id="fleet-3-section" style={{ "max-width": fleetSectionMaxWidth(), "width": "100%", "justify-self": "center" }} class="bg-base-100 rounded-xl shadow-sm border border-base-300/40 overflow-hidden">
              <div class="px-4 py-3 bg-gradient-to-r from-info/10 to-transparent border-b border-base-200">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-md bg-info/20 text-info flex items-center justify-center text-xs font-bold">3</span>
                    <h3 class="font-semibold text-sm">第3艦隊</h3>
                    <Show when={fleetMode() === "strike" || (!getFleetVisible(1) && !getFleetVisible(2))}>
                      <span id="fleet-3-strike-badge" class="badge badge-xs badge-info px-1 font-bold">遊撃艦隊</span>
                    </Show>
                  </div>
                </div>
              </div>
              <div id="fleet-3-body" class="p-3">
                <div id="fleet-3-slots" style={{ display: "grid", gap: "0.5rem", "grid-template-columns": fleetGridCols() }}><FleetSlotsView fleetIndex={3} /></div>
              </div>
            </section>
          </Show>

          {/* Fleet 4 */}
          <Show when={getFleetVisible(4)}>
            <section id="fleet-4-section" style={{ "max-width": fleetSectionMaxWidth(), "width": "100%", "justify-self": "center" }} class="bg-base-100 rounded-xl shadow-sm border border-base-300/40 overflow-hidden">
              <div class="px-4 py-3 bg-gradient-to-r from-warning/10 to-transparent border-b border-base-200">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-md bg-warning/20 text-warning flex items-center justify-center text-xs font-bold">4</span>
                    <h3 class="font-semibold text-sm">第4艦隊</h3>
                  </div>
                </div>
              </div>
              <div id="fleet-4-body" class="p-3">
                <div id="fleet-4-slots" style={{ display: "grid", gap: "0.5rem", "grid-template-columns": fleetGridCols() }}><FleetSlotsView fleetIndex={4} /></div>
              </div>
            </section>
          </Show>
        </div>

        {/* Air Base */}
        <Show when={airbaseVisible()}>
          <section id="airbase-section" style={{ "max-width": fleetSectionMaxWidth(), "width": "100%", "margin-left": "auto", "margin-right": "auto" }} class="bg-base-100 rounded-xl shadow-sm border border-base-300/40 overflow-hidden mb-5">
            <div class="px-4 py-3 bg-gradient-to-r from-accent/5 to-transparent border-b border-base-200">
              <div class="flex items-center gap-2">
                <span class="w-6 h-6 rounded-md bg-accent/15 text-accent flex items-center justify-center text-xs font-bold">基</span>
                <h3 class="font-semibold text-sm">基地航空隊</h3>
              </div>
            </div>
            <div class="p-3">
              <div id="air-bases" style={{ display: "grid", gap: "0.75rem", "grid-template-columns": `repeat(${airbaseCols()}, minmax(0, 1fr))` }}><AirBaseView /></div>
            </div>
          </section>
        </Show>
      </div>
    </>
  );
}
