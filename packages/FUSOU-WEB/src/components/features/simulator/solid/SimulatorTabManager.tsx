/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { SimulatorFleetTab } from "./SimulatorFleetTab";
import { SimulatorModals } from "./SimulatorModals";
import { initDisplaySettingsEvents, renderAll } from "@/features/simulator/airbase-renderer";
import { updateDataStatus, loadMasterData } from "@/features/simulator/data-loader";
import { initShipModalEvents, handleResizeShip } from "@/features/simulator/ship-modal";
import { initEquipModalEvents, handleResizeEquip } from "@/features/simulator/equip-modal";
import { initImageCaptureEvents } from "@/features/simulator/image-capture";
import { initIOEvents, loadFromUrl } from "@/features/simulator/io-handlers";

export function SimulatorTabManager(props: { initialTab: string, accessToken: string | null }) {
  const [activeTab, setActiveTab] = createSignal(props.initialTab || "fleet");

  let ensureOptimizerMounted: any;
  let mountSimulatorDetailsCatalog: any;
  let detailsMounted = false;

  const loadOptimizer = async () => {
    if (!ensureOptimizerMounted) {
      const mod = await import("./simulator-optimizer");
      ensureOptimizerMounted = mod.ensureOptimizerMounted;
    }
    ensureOptimizerMounted();
  };

  const loadDetails = async () => {
    if (detailsMounted) return;
    const root = document.getElementById("simulator-details-root");
    if (root) {
      detailsMounted = true;
      if (!mountSimulatorDetailsCatalog) {
        const mod = await import("./simulator-details-catalog");
        mountSimulatorDetailsCatalog = mod.mountSimulatorDetailsCatalog;
      }
      mountSimulatorDetailsCatalog(root);
    }
  };

  createEffect(() => {
    const tab = activeTab();
    if (tab === "optimizer") loadOptimizer();
    if (tab === "ship" || tab === "equip") {
      loadDetails();
      window.dispatchEvent(new CustomEvent("simulator-tab-changed", { detail: tab }));
    }

    // Update URL dynamically
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  });

  onMount(() => {
    (window as any).__fusouAccessToken = props.accessToken;

    initShipModalEvents();
    initEquipModalEvents();
    initDisplaySettingsEvents();
    initImageCaptureEvents();

    const handleResize = () => {
      handleResizeShip();
      handleResizeEquip();
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));

    const handleTabChangeSync = (e: any) => {
      setActiveTab(e.detail);
    };
    window.addEventListener("simulator-tab-changed-sync", handleTabChangeSync);
    onCleanup(() => window.removeEventListener("simulator-tab-changed-sync", handleTabChangeSync));

    // Initialize state
    (async () => {
      updateDataStatus();
      const initialWorkspaceSeed = await loadFromUrl();
      renderAll();
      initIOEvents(initialWorkspaceSeed);
      loadMasterData(() => {
        renderAll();
        window.dispatchEvent(new CustomEvent("simulator-master-data-loaded"));
      });
    })();
  });

  const isFleet = () => activeTab() === "fleet";
  const isOptimizer = () => activeTab() === "optimizer";
  const isDetails = () => activeTab() === "ship" || activeTab() === "equip";

  return (
    <div>
      {/* Page Header integrated into SolidJS to avoid DOM manipulation */}
      <div class="fusou-page-header">
        <div>
          <h1 class="fusou-page-title-compact">
            {isOptimizer() ? "装備最適化" : activeTab() === "ship" ? "艦詳細" : activeTab() === "equip" ? "装備詳細" : "編成シミュレータ"}
          </h1>
          <p class="fusou-page-subtitle-compact">
            {isOptimizer() ? "制約条件を満たす最適な装備の組み合わせを探索" : 
             activeTab() === "ship" ? "艦娘の能力・搭載・成長・シナジー等の詳細を確認" : 
             activeTab() === "equip" ? "装備の性能・装備可能艦・シナジー効果を横断的に確認" : 
             "艦隊編成を組み立てて確認・共有"}
          </p>
        </div>
        <div class="fusou-page-actions">
          <button id="btn-display-settings" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317a1 1 0 011.35-.936l.964.429a1 1 0 00.88 0l.964-.429a1 1 0 011.35.936l.093 1.053a1 1 0 00.516.79l.9.52a1 1 0 01.364 1.365l-.53.918a1 1 0 000 .998l.53.918a1 1 0 01-.364 1.365l-.9.52a1 1 0 00-.516.79l-.093 1.053a1 1 0 01-1.35.936l-.964-.429a1 1 0 00-.88 0l-.964.429a1 1 0 01-1.35-.936l-.093-1.053a1 1 0 00-.516-.79l-.9-.52a1 1 0 01-.364-1.365l.53-.918a1 1 0 000-.998l-.53-.918a1 1 0 01.364-1.365l.9-.52a1 1 0 00.516-.79l.093-1.053z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9a3 3 0 100 6 3 3 0 000-6z"></path>
            </svg>
            表示設定
          </button>
          <button id="btn-load-fleet" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            R2読込
          </button>
          <button id="btn-import" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
            APIレスポンス貼り付け
          </button>
          <button id="btn-save-image" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7h4l2-2h6l2 2h4v12H3V7zm9 10a4 4 0 100-8 4 4 0 000 8z"></path>
            </svg>
            画像保存
          </button>
          <button id="btn-share" class="fusou-btn-primary gap-1.5" hidden={!isFleet()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
            </svg>
            共有
          </button>

          <button id="sim-details-settings-btn" class="fusou-btn-secondary gap-1.5" hidden={!isDetails()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317a1 1 0 011.35-.936l.964.429a1 1 0 00.88 0l.964-.429a1 1 0 011.35.936l.093 1.053a1 1 0 00.516.79l.9.52a1 1 0 01.364 1.365l-.53.918a1 1 0 000 .998l.53.918a1 1 0 01-.364 1.365l-.9.52a1 1 0 00-.516.79l-.093 1.053a1 1 0 01-1.35.936l-.964-.429a1 1 0 00-.88 0l-.964.429a1 1 0 01-1.35-.936l-.093-1.053a1 1 0 00-.516-.79l-.9-.52a1 1 0 01-.364-1.365l.53-.918a1 1 0 000-.998l-.53-.918a1 1 0 01.364-1.365l.9-.52a1 1 0 00.516-.79l.093-1.053z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9a3 3 0 100 6 3 3 0 000-6z"></path>
            </svg>
            表示設定
          </button>
          <button id="sim-details-help-btn" class="fusou-btn-secondary gap-1.5" hidden={!isDetails()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            使い方
          </button>
          <button id="sim-details-share-btn" class="fusou-btn-primary gap-1.5" hidden={!isDetails()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
            </svg>
            共有
          </button>
        </div>
      </div>

      <div class="flex gap-1 mb-5 border-b border-base-300/60 overflow-x-auto hide-scrollbar">
        <button
          id="sim-tab-btn-fleet"
          class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${activeTab() === "fleet" ? "border-primary text-primary" : "border-transparent text-base-content/55 hover:text-base-content"}`}
          onClick={() => setActiveTab("fleet")}
        >
          編成
        </button>
        <button
          id="sim-tab-btn-optimizer"
          class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${activeTab() === "optimizer" ? "border-primary text-primary" : "border-transparent text-base-content/55 hover:text-base-content"}`}
          onClick={() => setActiveTab("optimizer")}
        >
          装備最適化
        </button>
        <button
          id="sim-tab-btn-ship"
          class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${activeTab() === "ship" ? "border-primary text-primary" : "border-transparent text-base-content/55 hover:text-base-content"}`}
          onClick={() => setActiveTab("ship")}
        >
          艦詳細
        </button>
        <button
          id="sim-tab-btn-equip"
          class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${activeTab() === "equip" ? "border-primary text-primary" : "border-transparent text-base-content/55 hover:text-base-content"}`}
          onClick={() => setActiveTab("equip")}
        >
          装備詳細
        </button>
      </div>

      {/* Fleet tab content */}
      <div id="sim-tab-fleet-container" hidden={!isFleet()}>
        <SimulatorFleetTab />
      </div>

      {/* Optimizer tab content */}
      <div id="sim-tab-optimizer-container" hidden={!isOptimizer()}>
        <div id="optimizer-mount"></div>
      </div>

      {/* Details tab content */}
      <div id="sim-tab-details-container" hidden={!isDetails()}>
        <div id="simulator-details-root" class="min-h-96"></div>
      </div>

      <SimulatorModals />
    </div>
  );
}

export function mountSimulatorTabManager(root: HTMLElement, initialTab: string, accessToken: string | null) {
  render(() => <SimulatorTabManager initialTab={initialTab} accessToken={accessToken} />, root);
}
