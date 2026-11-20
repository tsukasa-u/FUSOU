/** @jsxImportSource solid-js */
import { createSignal, onMount, Show } from "solid-js";
import {
  initializeStorybookSimulator,
} from "../../../../storybook-fixtures";
import {
  SimulatorModals,
  displaySettingsModalRef,
  saveImageModalRef,
} from "../../../../../components/features/simulator/solid/SimulatorModals";
import {
  setShipModalTrigger,
} from "../../../../../components/features/simulator/solid/ShipSelectionModal";
import {
  setEquipModalTrigger,
} from "../../../../../components/features/simulator/solid/EquipSelectionModal";
import {
  setEquipModalTargetForFleet,
  setShipModalTargetForFleet,
} from "../../../../../features/simulator/simulator-mutations";
import {
  shareSettingsModalRef,
} from "../../../../../components/features/simulator/solid/ShareSettingsModal";
import {
  workspaceAddModalRef,
  workspaceEditTarget,
  workspaceModalMode,
} from "../../../../../components/features/simulator/solid/WorkspaceAddModal";
import {
  dataImportModalRef,
} from "../../../../../components/features/simulator/solid/DataImportModal";

const [, setWorkspaceTarget] = workspaceEditTarget;
const [, setWorkspaceMode] = workspaceModalMode;

function openModal(
  reference: { current: HTMLDialogElement | null },
  name: string,
): void {
  const dialog = reference.current;
  if (!dialog) {
    throw new Error(`${name} modal is not mounted.`);
  }
  if (!dialog.open) dialog.showModal();
}

function StorybookSimulatorModalLauncher() {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(() => {
    setShipModalTrigger(0);
    setEquipModalTrigger(0);

    void initializeStorybookSimulator("combined", "sample", {
      includeInventorySnapshot: true,
    }).then(
      () => {
        window.__fusouIsAuthenticated = true;
        setReady(true);
      },
      (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
  });

  return (
    <Show
      when={ready()}
      fallback={
        <div
          role={error() ? "alert" : "status"}
          class={error() ? "alert alert-error m-4" : "loading loading-spinner loading-md m-4"}
        >
          {error() || "Loading the simulator fixture..."}
        </div>
      }
    >
      <div class="min-h-screen space-y-4 p-4">
        <header class="space-y-1">
          <h1 class="text-xl font-bold">シミュレータのモーダル</h1>
          <p class="text-sm text-base-content/70">
            赤城・金剛を含むサンプル編成を読み込み、利用側の操作から各モーダルを開きます。
          </p>
        </header>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            type="button"
            class="btn btn-outline"
            onClick={() => {
              setShipModalTargetForFleet(1, 0);
              setShipModalTrigger((value) => value + 1);
            }}
          >
            艦娘選択
          </button>
          <button
            type="button"
            class="btn btn-outline"
            onClick={() => {
              setEquipModalTargetForFleet(1, 0, 0);
              setEquipModalTrigger((value) => value + 1);
            }}
          >
            装備選択
          </button>
          <button
            type="button"
            class="btn btn-outline"
            onClick={() => openModal(displaySettingsModalRef, "表示設定")}
          >
            表示設定
          </button>
          <button
            type="button"
            class="btn btn-outline"
            onClick={() => openModal(saveImageModalRef, "画像保存設定")}
          >
            画像保存
          </button>
          <button
            type="button"
            class="btn btn-outline"
            onClick={() => openModal(shareSettingsModalRef, "共有URL設定")}
          >
            共有設定
          </button>
          <button
            type="button"
            class="btn btn-outline"
            onClick={() => {
              setWorkspaceTarget(null);
              setWorkspaceMode("saveCurrent");
              openModal(workspaceAddModalRef, "ワークスペース");
            }}
          >
            ワークスペース保存
          </button>
          <button
            type="button"
            class="btn btn-outline"
            onClick={() => openModal(dataImportModalRef, "データ読込")}
          >
            データ読込
          </button>
        </div>
        <SimulatorModals />
      </div>
    </Show>
  );
}

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/SimulatorModals/SimulatorModals",
  component: SimulatorModals,
  tags: ["autodocs"],
};

export const Default = {
  render: () => <StorybookSimulatorModalLauncher />,
};
