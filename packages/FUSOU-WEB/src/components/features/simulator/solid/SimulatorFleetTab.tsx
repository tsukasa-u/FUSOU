/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { useStore } from "@nanostores/solid";
import { simulatorDisplayRevision, simulatorCombinedFleetType } from "@/features/simulator/state";
import { isFleetSectionVisible, isAirbaseSectionVisible, getVisibleAirbaseCount, getFleetSlotLayoutMode, getFleetState } from "@/features/simulator/simulator-selectors";
import { validateCombinedFleet } from "@/features/simulator/combined-fleet";
import { FleetSlotsView, AirBaseView } from "@/components/features/simulator/solid/simulator-renderer";
import { WorkspacePanel } from "./WorkspacePanel";

export function SimulatorFleetTab() {
  const displayRev = useStore(simulatorDisplayRevision);
  const combinedType = useStore(simulatorCombinedFleetType);

  const slotLayout = () => { displayRev(); return getFleetSlotLayoutMode(); };
  const getFleetVisible = (i: number) => { displayRev(); return isFleetSectionVisible(i); };
  const airbaseVisible = () => { displayRev(); return isAirbaseSectionVisible(); };
  const airbaseCount = () => { displayRev(); return getVisibleAirbaseCount(); };

  const [windowWidth, setWindowWidth] = createSignal(typeof window !== "undefined" ? window.innerWidth : 1200);
  onMount(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });

  const isMobileSingleColumn = () => windowWidth() < 768;
  const effectiveSlotLayout = () => {
    if (slotLayout() === "3x2" && windowWidth() < 1200) return "2x3";
    return slotLayout();
  };

  const fleetSectionMaxWidth = () =>
    isMobileSingleColumn() ? "26rem" : effectiveSlotLayout() === "3x2" ? "76rem" : "52rem";

  const fleetGridCols = () => {
    if (isMobileSingleColumn()) return "minmax(0, 1fr)";
    return effectiveSlotLayout() === "3x2" ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))";
  };

  const fleetSectionsStyle = () => {
    const visibleCount = [1, 2, 3, 4].filter(getFleetVisible).length;
    const twoCol = effectiveSlotLayout() === "2x3" && visibleCount >= 2 && windowWidth() >= 768;
    return {
      "display": "grid",
      "justify-content": "center",
      "gap": "1.25rem",
      "margin-bottom": "1.25rem",
      "grid-template-columns": twoCol ? `repeat(2, minmax(0, ${fleetSectionMaxWidth()}))` : `minmax(0, ${fleetSectionMaxWidth()})`
    };
  };

  const combinedLabel: Record<number, string> = { 1: "機動部隊", 2: "水上打撃部隊", 3: "輸送護衛部隊" };
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
      <WorkspacePanel />

      <div id="deck-capture-area">
        <Show when={!combinedValidation().ok}>
          <div id="combined-fleet-validation" class="alert alert-warning mb-4 py-2 flex">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86l-7.5 13A1 1 0 003.67 18h16.66a1 1 0 00.88-1.5l-7.5-13a1 1 0 00-1.74 0z"></path></svg>
            <span id="combined-fleet-validation-text" class="text-sm">{combinedValidation().text}</span>
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
