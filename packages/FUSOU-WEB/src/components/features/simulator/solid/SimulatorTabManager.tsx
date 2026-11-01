/** @jsxImportSource solid-js */
import { workspaceAddModalRef, workspaceEditTarget, workspaceModalMode } from "./WorkspaceAddModal";

import { FusouPageHeader } from "@/components/common/solid/FusouPageHeader";
import SimulatorSearchFilterBar from "./SimulatorSearchFilterBar";
import SimulatorFilterModal, { type SimulatorFilterSettings } from "./SimulatorFilterModal";
import { setActive } from "@/features/simulator/viewer-workspace";
import { createSignal, createEffect, onMount, onCleanup, createMemo, Show } from "solid-js";
import { render } from "solid-js/web";
import { SimulatorFleetTab } from "./SimulatorFleetTab";
import { SimulatorModals } from "./SimulatorModals";
import { renderAll } from "@/features/simulator/airbase-renderer";
import { updateDataStatus, loadMasterData } from "@/features/simulator/data-loader";
import { initShipModalEvents, handleResizeShip } from "@/features/simulator/ship-modal";
import { initEquipModalEvents, handleResizeEquip } from "@/features/simulator/equip-modal";
import { prewarmImageCacheForCapture } from "@/features/simulator/image-capture";
import { initIOEvents, loadFromUrl, initWorkspaceAutoSave } from "@/features/simulator/io-handlers";
import { displaySettingsModalRef, saveImageModalRef } from "./SimulatorModals";
import { dataImportModalRef } from "./DataImportModal";
import { shareSettingsModalRef } from "./ShareSettingsModal";
import { ShareUrlButton } from "@/components/common/solid/ShareUrlButton";
import { FusouTabs, type TabItem } from "@/components/common/solid/FusouTabs";
import { ActiveFilterChips, type FilterChipItem } from "@/components/common/solid/ActiveFilterChips";
import { SHIP_TYPE_GROUPS } from "@/components/features/ship-growth/solid/ShipGrowthFilterModal";
import { WorkspacePanel } from "./WorkspacePanel";

/**
 * 装備最適化タブの有効フラグ
 * 通常時は非表示。必要な時に元に戻す場合はここを true に切り替える。
 */
export const ENABLE_OPTIMIZER_TAB = false;

type SimTab = "fleet" | "workspace" | "optimizer" | "ship" | "equip";

const SIMULATOR_TABS: readonly TabItem<SimTab>[] = [
  { id: "fleet", label: "編成" },
  { id: "workspace", label: "ワークスペース" },
  ...(ENABLE_OPTIMIZER_TAB ? [{ id: "optimizer" as const, label: "装備最適化" }] : []),
  { id: "ship", label: "艦詳細" },
  { id: "equip", label: "装備詳細" },
];

export function SimulatorTabManager(props: { initialTab: string, accessToken: string | null }) {
  const resolveInitialTab = (tab: string | undefined): SimTab => {
    if (!ENABLE_OPTIMIZER_TAB && tab === "optimizer") return "fleet";
    if (tab === "fleet" || tab === "workspace" || tab === "ship" || tab === "equip" || (ENABLE_OPTIMIZER_TAB && tab === "optimizer")) {
      return tab as SimTab;
    }
    return "fleet";
  };

  const [activeTab, setActiveTab] = createSignal<SimTab>(resolveInitialTab(props.initialTab));
  const [filterSettings, setFilterSettings] = createSignal<SimulatorFilterSettings>({
    includeShips: true,
    includeEquips: true,
    includeWorkspaces: true,
    selectedStypes: [],
  });

  const activeFilterItems = createMemo<FilterChipItem[]>(() => {
    const items: FilterChipItem[] = [];
    const s = filterSettings();
    if (!s.includeShips) {
      items.push({
        key: "no-ship",
        label: "除外",
        value: "艦",
        onRemove: () => setFilterSettings((prev) => ({ ...prev, includeShips: true })),
      });
    }
    if (!s.includeEquips) {
      items.push({
        key: "no-equip",
        label: "除外",
        value: "装備",
        onRemove: () => setFilterSettings((prev) => ({ ...prev, includeEquips: true })),
      });
    }
    if (!s.includeWorkspaces) {
      items.push({
        key: "no-ws",
        label: "除外",
        value: "ワークスペース",
        onRemove: () => setFilterSettings((prev) => ({ ...prev, includeWorkspaces: true })),
      });
    }
    if (s.selectedStypes.length > 0) {
      const groupNames = SHIP_TYPE_GROUPS
        .filter((g) => g.stypes.some((st) => s.selectedStypes.includes(st)))
        .map((g) => g.name);
      items.push({
        key: "stype",
        label: "艦種",
        value: groupNames.join(", "),
        onRemove: () => setFilterSettings((prev) => ({ ...prev, selectedStypes: [] })),
      });
    }
    return items;
  });
  let simFilterModalRef!: HTMLDialogElement;

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
    if (ENABLE_OPTIMIZER_TAB && tab === "optimizer") loadOptimizer();
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
      setActiveTab(resolveInitialTab(detail));
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
  const isWorkspace = () => activeTab() === "workspace";
  const isOptimizer = () => activeTab() === "optimizer";
  const isDetails = () => activeTab() === "ship" || activeTab() === "equip";

  return (
    <div>
      {/* Page Header integrated into SolidJS to avoid DOM manipulation */}
      <FusouPageHeader
        title={isOptimizer() ? "装備最適化" : activeTab() === "workspace" ? "ワークスペース" : activeTab() === "ship" ? "艦詳細" : activeTab() === "equip" ? "装備詳細" : "編成シミュレータ"}
        subtitle={isOptimizer() ? "制約条件を満たす最適な装備の組み合わせを探索" : 
             activeTab() === "workspace" ? "保存した編成や外部共有URLの管理・切り替え" : 
             activeTab() === "ship" ? "艦の能力・搭載・成長・シナジー等の詳細を確認" : 
             activeTab() === "equip" ? "装備の性能・装備可能艦・シナジー効果を横断的に確認" : 
             "艦隊編成を組み立てて確認・共有"}
        actions={<>
          <button id="btn-display-settings" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()} onClick={() => displaySettingsModalRef.current?.showModal()}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-4 w-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span class="hidden md:inline">表示設定</span>
          </button>
          <button id="btn-import" class="fusou-btn-secondary gap-1.5" hidden={!isFleet()} onClick={() => dataImportModalRef.current?.showModal()}>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            <span class="hidden md:inline">データ読込</span>
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

                    {/* Workspace tab actions */}
          <button
            id="btn-workspace-save-current"
            class="fusou-btn-secondary gap-1.5"
            hidden={!isWorkspace()}
            onClick={() => {
              workspaceEditTarget[1](null);
              workspaceModalMode[1]("saveCurrent");
              workspaceAddModalRef.current?.showModal();
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span class="hidden md:inline">現在の編成を保存</span>
          </button>
          <button
            id="btn-workspace-add-url"
            class="fusou-btn-secondary gap-1.5"
            hidden={!isWorkspace()}
            onClick={() => {
              workspaceEditTarget[1](null);
              workspaceModalMode[1]("addUrl");
              workspaceAddModalRef.current?.showModal();
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span class="hidden md:inline">URL追加</span>
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
        </>}
      />


      <div class="fusou-tab-toolbar">
        <FusouTabs<SimTab>
          tabs={SIMULATOR_TABS}
          activeTab={activeTab() as SimTab}
          onTabChange={(tab) => setActiveTab(tab)}
          tabIdPrefix="sim-tab-btn"
          ariaLabel="シミュレータタブ切り替え"
        />

        <SimulatorSearchFilterBar
          settings={filterSettings}
          activeTab={activeTab}
          onOpenFilterModal={() => simFilterModalRef?.showModal()}
          onSelectShip={(shipId) => {
            setActiveTab("ship");
            window.dispatchEvent(new CustomEvent("sim-details-select-ship", { detail: shipId }));
          }}
          onSelectEquip={(equipId) => {
            setActiveTab("equip");
            window.dispatchEvent(new CustomEvent("sim-details-select-equip", { detail: equipId }));
          }}
          onSelectWorkspace={(wsId) => {
            setActiveTab("workspace");
            setActive(wsId);
          }}
        />
      </div>

      <Show when={activeFilterItems().length > 0}>
        <div class="-mt-3 mb-4 px-0.5">
          <ActiveFilterChips
            items={activeFilterItems()}
            onClearAll={() => {
              setFilterSettings({
                includeShips: true,
                includeEquips: true,
                includeWorkspaces: true,
                selectedStypes: [],
              });
            }}
          />
        </div>
      </Show>

      {/* Fleet tab content */}
      <div id="sim-tab-fleet-container" hidden={!isFleet()}>
        <SimulatorFleetTab onOpenWorkspace={() => setActiveTab("workspace")} />
      </div>

      {/* Workspace tab content */}
      <div id="sim-tab-workspace-container" hidden={!isWorkspace()}>
        <WorkspacePanel onSelectEntry={() => setActiveTab("fleet")} />
      </div>

      {/* Optimizer tab content (ENABLE_OPTIMIZER_TAB が true の時のみ描画) */}
      {ENABLE_OPTIMIZER_TAB && (
        <div id="sim-tab-optimizer-container" hidden={!isOptimizer()}>
          <div id="optimizer-mount" ref={optimizerMountRef}></div>
        </div>
      )}

      {/* Details tab content */}
      <div id="sim-tab-details-container" hidden={!isDetails()}>
        <div id="simulator-details-root" ref={detailsRootRef} class="min-h-96"></div>
      </div>

      <SimulatorFilterModal
        ref={(el) => {
          simFilterModalRef = el;
        }}
        settings={filterSettings}
        onSettingsChange={setFilterSettings}
        onReset={() => {
          setFilterSettings({
            includeShips: true,
            includeEquips: true,
            includeWorkspaces: true,
            selectedStypes: [],
          });
        }}
      />
      <SimulatorModals />
    </div>
  );
}

export function mountSimulatorTabManager(root: HTMLElement, initialTab: string, accessToken: string | null) {
  initWorkspaceAutoSave();
  root.innerHTML = "";
  render(() => <SimulatorTabManager initialTab={initialTab} accessToken={accessToken} />, root);
}
