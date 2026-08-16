/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { SimulatorFleetTab } from "./SimulatorFleetTab";
import { SimulatorModals } from "./SimulatorModals";
import { renderAll } from "@/features/simulator/airbase-renderer";
import { updateDataStatus, loadMasterData } from "@/features/simulator/data-loader";
import { initShipModalEvents, handleResizeShip } from "@/features/simulator/ship-modal";
import { initEquipModalEvents, handleResizeEquip } from "@/features/simulator/equip-modal";
import { prewarmImageCacheForCapture } from "@/features/simulator/image-capture";
import { initIOEvents, loadFromUrl } from "@/features/simulator/io-handlers";
import { displaySettingsModalRef, saveImageModalRef } from "./SimulatorModals";
import { apiPasteModalRef } from "./ApiPasteModal";
import { shareSettingsModalRef } from "./ShareSettingsModal";
import { ShareUrlButton } from "@/components/common/solid/ShareUrlButton";
import { loadFleetModalRef } from "./LoadFleetModal";
import { MasterDataStatusAlert } from "./MasterDataStatusAlert";

export function SimulatorTabManager(props: { initialTab: string, accessToken: string | null }) {
  const [activeTab, setActiveTab] = createSignal(props.initialTab || "fleet");

  let ensureOptimizerMounted: ((container?: HTMLElement) => void) | undefined;
  let mountSimulatorDetailsCatalog: ((root: HTMLElement) => void) | undefined;
  let detailsMounted = false;
  let detailsRootRef: HTMLDivElement | undefined;
  let optimizerMountRef: HTMLDivElement | undefined;

  const loadOptimizer = async () => {
    if (!ensureOptimizerMounted) {
      const mod = await import("./simulator-optimizer");
      ensureOptimizerMounted = mod.ensureOptimizerMounted;
    }
    ensureOptimizerMounted(optimizerMountRef);
  };

  const loadDetails = async () => {
    if (detailsMounted) return;
    const root = detailsRootRef;
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
    window.__fusouAccessToken = props.accessToken;

    initShipModalEvents();
    initEquipModalEvents();

    const handleResize = () => {
      handleResizeShip();
      handleResizeEquip();
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));

    const handleTabChangeSync = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setActiveTab(detail);
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
             activeTab() === "ship" ? "艦の能力・搭載・成長・シナジー等の詳細を確認" : 
             activeTab() === "equip" ? "装備の性能・装備可能艦・シナジー効果を横断的に確認" : 
             "艦隊編成を組み立てて確認・共有"}
          </p>
        </div>
        <div class="fusou-page-actions">
          <button id="btn-display-settings" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()} onClick={() => displaySettingsModalRef.current?.showModal()}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span class="hidden md:inline">表示設定</span>
          </button>
          <button id="btn-load-fleet" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()} onClick={() => loadFleetModalRef.current?.showModal()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            <span class="hidden md:inline">R2読込</span>
          </button>
          <button id="btn-import" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()} onClick={() => apiPasteModalRef.current?.showModal()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
            </svg>
            <span class="hidden md:inline">APIレスポンス貼り付け</span>
          </button>
          <button id="btn-save-image" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()} onClick={() => {
            prewarmImageCacheForCapture();
            saveImageModalRef.current?.showModal();
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7h4l2-2h6l2 2h4v12H3V7zm9 10a4 4 0 100-8 4 4 0 000 8z"></path>
            </svg>
            <span class="hidden md:inline">画像保存</span>
          </button>
          <button id="btn-share" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()} onClick={() => shareSettingsModalRef.current?.showModal()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
            </svg>
            <span class="hidden md:inline">共有</span>
          </button>

          <button id="sim-details-settings-btn" class="fusou-btn-secondary gap-1.5" hidden={!isDetails()} onClick={() => window.dispatchEvent(new CustomEvent("sim-details-open-settings"))}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span class="hidden md:inline">表示設定</span>
          </button>
          <button id="sim-details-help-btn" class="fusou-btn-secondary gap-1.5" hidden={!isDetails()} onClick={() => window.dispatchEvent(new CustomEvent("sim-details-open-help"))}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="hidden md:inline">使い方</span>
          </button>
          
          <ShareUrlButton
            id="sim-details-share-btn"
            hidden={!isDetails()}
            onShare={() => {
              return new Promise((resolve) => {
                const onStatus = (e: CustomEvent) => {
                  window.removeEventListener("sim-details-share-status", onStatus as EventListener);
                  resolve(e.detail === "success");
                };
                window.addEventListener("sim-details-share-status", onStatus as EventListener);
                window.dispatchEvent(new CustomEvent("sim-details-share"));
              });
            }}
          />
        </div>
      </div>

      <MasterDataStatusAlert />

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
        <div id="optimizer-mount" ref={optimizerMountRef}></div>
      </div>

      {/* Details tab content */}
      <div id="sim-tab-details-container" hidden={!isDetails()}>
        <div id="simulator-details-root" ref={detailsRootRef} class="min-h-96"></div>
      </div>

      <SimulatorModals />
    </div>
  );
}

export function mountSimulatorTabManager(root: HTMLElement, initialTab: string, accessToken: string | null) {
  render(() => <SimulatorTabManager initialTab={initialTab} accessToken={accessToken} />, root);
}
