/** @jsxImportSource solid-js */
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import {
  clearStoredLocalDirectoryHandle,
  loadStoredLocalDirectoryHandle,
  saveLocalDirectoryHandle,
} from "@/features/battles/local-directory/handle-store";
import {
  pickLocalDirectory,
  supportsLocalDirectoryPicker,
  type LocalPickerResult,
} from "@/features/battles/local-directory/picker";
import {
  queryLocalDirectoryPermission,
  requestLocalDirectoryPermission,
  type LocalDirectoryPermissionState,
} from "@/features/battles/local-directory/permissions";
import {
  scanLocalDirectoryHandle,
  ManifestScanError,
  type ManifestScanProgress,
  type ManifestScanResult,
} from "@/features/battles/local-directory/manifest-scanner";
import { LocalAvroBattleRepository } from "@/features/battles/repository/local-avro-battle-repository";
import { R2BattleRepository } from "@/features/battles/repository/r2-battle-repository";
import type { BattleDataRepository } from "@/features/battles/repository/types";
import BattlesDashboard from "./BattlesDashboard";

type SourceKind = "r2" | "local-avro";
type LocalStatus = "idle" | "scanning" | "ready" | "error";
const SOURCE_PREFERENCE_KEY = "fusou:battles:preferred-source";

function sourceFromUrl(): SourceKind {
  if (typeof window === "undefined") return "r2";
  const params = new URLSearchParams(window.location.search);
  const sourceParam = params.get("source");
  if (sourceParam === "local-avro") return "local-avro";
  if (sourceParam === "r2") return "r2";
  try {
    return window.localStorage.getItem(SOURCE_PREFERENCE_KEY) === "local-avro"
      ? "local-avro"
      : "r2";
  } catch {
    return "r2";
  }
}

function hasStoredSourcePreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storedSource = window.localStorage.getItem(SOURCE_PREFERENCE_KEY);
    return storedSource === "r2" || storedSource === "local-avro";
  } catch {
    return false;
  }
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function permissionLabel(value: LocalDirectoryPermissionState): string {
  if (value === "granted") return "許可済み";
  if (value === "prompt") return "許可が必要";
  if (value === "denied") return "拒否";
  return "このブラウザでは確認できません";
}

function scanProgressLabel(progress: ManifestScanProgress | null): string {
  if (!progress) return "ファイルを確認しています...";
  if (progress.phase === "manifest-validation") return "manifestを検証しています...";
  return progress.total
    ? `ファイルを確認中 ${progress.completed}/${progress.total}`
    : `ファイルを確認中 ${progress.completed}`;
}

function localScanErrorMessage(error: unknown): string {
  if (error instanceof ManifestScanError) {
    if (error.code === "FILE_TOO_LARGE") return "AVROファイルがサイズ上限を超えています。";
    if (error.code === "FILE_LIMIT_EXCEEDED") return "AVROファイル数が上限を超えています。";
    if (error.code === "PERMISSION_DENIED") return "ローカルAVROへの読み取り権限が失われました。";
  }
  return "ローカルAVROの確認に失敗しました。";
}

export default function BattleSourceSwitcher() {
  const initialSource = sourceFromUrl();
  const [source, setSource] = createSignal<SourceKind>(initialSource);
  const [rememberSource, setRememberSource] = createSignal(hasStoredSourcePreference());
  const [repository, setRepository] = createSignal<BattleDataRepository | null>(
    new R2BattleRepository(),
  );
  const [localStatus, setLocalStatus] = createSignal<LocalStatus>("idle");
  const [permission, setPermission] = createSignal<LocalDirectoryPermissionState>("prompt");
  const [storedHandle, setStoredHandle] = createSignal<FileSystemDirectoryHandle | null>(null);
  const [scanResult, setScanResult] = createSignal<ManifestScanResult | null>(null);
  const [scanProgress, setScanProgress] = createSignal<ManifestScanProgress | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let localSettingsModalRef!: HTMLDialogElement;
  let disposed = false;
  let operationGeneration = 0;

  const openLocalSettings = () => {
    if (localSettingsModalRef && !localSettingsModalRef.open) {
      localSettingsModalRef.showModal();
    }
  };

  const replaceRepository = (nextRepository: BattleDataRepository | null) => {
    const previousRepository = repository();
    if (previousRepository && previousRepository !== nextRepository) {
      void previousRepository.dispose();
    }
    setRepository(nextRepository);
  };

  const clearBattlePreview = () => {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("battleDetail");
  };

  const restoreR2Source = () => {
    ++operationGeneration;
    clearBattlePreview();
    setError(null);
    setScanProgress(null);
    setLocalStatus("idle");
    setSource("r2");
    if (rememberSource()) persistSourcePreference("r2");
    syncSourceQuery("r2");
    replaceRepository(new R2BattleRepository());
  };

  const syncSourceQuery = (nextSource: SourceKind, resetDetail = false) => {
    const url = new URL(window.location.href);
    url.searchParams.set("source", nextSource);
    if (resetDetail) {
      url.searchParams.delete("tab");
      url.searchParams.delete("detail_id");
      url.searchParams.delete("battle_index");
    }
    window.history.replaceState({}, "", url.toString());
  };

  const persistSourcePreference = (nextSource: SourceKind | null) => {
    try {
      if (nextSource) window.localStorage.setItem(SOURCE_PREFERENCE_KEY, nextSource);
      else window.localStorage.removeItem(SOURCE_PREFERENCE_KEY);
    } catch {
      // localStorage may be unavailable in privacy-restricted browsers.
    }
  };

  const scanHandle = async (handle: FileSystemDirectoryHandle, generation: number) => {
    setLocalStatus("scanning");
    setError(null);
    setScanProgress(null);
    try {
      const result = await scanLocalDirectoryHandle(handle, { onProgress: setScanProgress });
      if (disposed || generation !== operationGeneration) return;
      setStoredHandle(handle);
      setScanResult(result);
      replaceRepository(new LocalAvroBattleRepository(result.manifest));
      setLocalStatus("ready");
      localSettingsModalRef?.close();
    } catch (cause) {
      if (disposed) return;
      setLocalStatus("error");
      setError(localScanErrorMessage(cause));
      openLocalSettings();
    }
  };

  const applyPickerResult = (picked: LocalPickerResult) => {
    setLocalStatus("ready");
    setScanResult(picked.scan);
    if (picked.kind === "file-list") {
      setStoredHandle(null);
      setPermission("unsupported");
    }
    replaceRepository(new LocalAvroBattleRepository(picked.scan.manifest));
  };

  const usePicker = async () => {
    setError(null);
    const generation = ++operationGeneration;
    try {
      const picked = await pickLocalDirectory();
      if (disposed || generation !== operationGeneration) return;
      if (picked.kind === "directory-handle") {
        await saveLocalDirectoryHandle(picked.handle);
        setPermission("granted");
        setStoredHandle(picked.handle);
      }
      applyPickerResult(picked);
      localSettingsModalRef?.close();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        restoreR2Source();
        localSettingsModalRef?.close();
        return;
      }
      setLocalStatus("error");
      setError(cause instanceof Error ? cause.message : "ローカル AVRO の選択に失敗しました。");
      openLocalSettings();
    }
  };

  const requestStoredPermission = async () => {
    const handle = storedHandle();
    if (!handle) return;
    const nextPermission = await requestLocalDirectoryPermission(handle);
    setPermission(nextPermission);
    if (nextPermission === "granted") await scanHandle(handle, operationGeneration);
    else openLocalSettings();
  };

  const rescanStoredHandle = async () => {
    const handle = storedHandle();
    if (!handle) return;
    const currentPermission = await queryLocalDirectoryPermission(handle);
    setPermission(currentPermission);
    if (currentPermission === "granted") await scanHandle(handle, operationGeneration);
    else {
      openLocalSettings();
      await requestStoredPermission();
    }
  };

  const selectSource = (nextSource: SourceKind) => {
    const generation = ++operationGeneration;
    const sourceChanged = source() !== nextSource;
    setSource(nextSource);
    if (rememberSource()) persistSourcePreference(nextSource);
    syncSourceQuery(nextSource, sourceChanged);
    setError(null);
    clearBattlePreview();
    if (nextSource === "r2") {
      setLocalStatus("idle");
      replaceRepository(new R2BattleRepository());
      return;
    }
    if (scanResult()) {
      setLocalStatus("ready");
      replaceRepository(new LocalAvroBattleRepository(scanResult()!.manifest));
      return;
    }
    const handle = storedHandle();
    if (handle && permission() === "granted") void scanHandle(handle, generation);
    else openLocalSettings();
  };

  const setSourcePreference = (enabled: boolean) => {
    setRememberSource(enabled);
    persistSourcePreference(enabled ? source() : null);
  };

  const releaseLocalAccess = async () => {
    ++operationGeneration;
    clearBattlePreview();
    await clearStoredLocalDirectoryHandle();
    setStoredHandle(null);
    setScanResult(null);
    setLocalStatus("idle");
    setPermission("prompt");
    setSource("r2");
    if (rememberSource()) persistSourcePreference("r2");
    syncSourceQuery("r2");
    replaceRepository(new R2BattleRepository());
    localSettingsModalRef?.close();
  };

  onMount(() => {
    syncSourceQuery(source());
    void (async () => {
      const stored = await loadStoredLocalDirectoryHandle();
      if (disposed) return;
      if (stored) {
        setStoredHandle(stored.handle);
        const storedPermission = await queryLocalDirectoryPermission(stored.handle);
        setPermission(storedPermission);
        if (source() === "local-avro") {
          if (storedPermission === "granted") {
            await scanHandle(stored.handle, operationGeneration);
          } else {
            openLocalSettings();
          }
        }
      } else if (source() === "local-avro") {
        openLocalSettings();
      }
    })();
  });

  onCleanup(() => {
    disposed = true;
    void repository()?.dispose();
  });

  return (
    <>
      <LocalSourceSettingsModal
        ref={(element) => {
          localSettingsModalRef = element;
        }}
        localStatus={localStatus}
        permission={permission}
        scanResult={scanResult}
        scanProgress={scanProgress}
        error={error}
        hasStoredHandle={() => storedHandle() !== null}
        onClose={() => {
          if (source() === "local-avro" && !scanResult() && localStatus() !== "scanning") {
            restoreR2Source();
          }
        }}
        onPick={usePicker}
        onRequestPermission={requestStoredPermission}
        onRescan={rescanStoredHandle}
        onRelease={releaseLocalAccess}
      />
      <Show
        when={repository()}
        keyed
        fallback={<div class="fusou-page-container max-w-360 pt-5" />}
      >
        {(activeRepository) => (
          <BattlesDashboard
            repository={activeRepository}
            source={source()}
            localStatus={localStatus()}
            localDirectoryName={() => storedHandle()?.name ?? null}
            rememberSource={rememberSource()}
            onSourceChange={selectSource}
            onOpenLocalDirectorySettings={openLocalSettings}
            onRememberSourceChange={setSourcePreference}
          />
        )}
      </Show>
    </>
  );
}

function LocalSourceSettingsModal(props: {
  ref: (element: HTMLDialogElement) => void;
  localStatus: () => LocalStatus;
  permission: () => LocalDirectoryPermissionState;
  scanResult: () => ManifestScanResult | null;
  scanProgress: () => ManifestScanProgress | null;
  error: () => string | null;
  hasStoredHandle: () => boolean;
  onClose: () => void;
  onPick: () => void;
  onRequestPermission: () => void;
  onRescan: () => void;
  onRelease: () => void;
}) {
  const periodCount = () =>
    props.scanResult()
      ? new Set(props.scanResult()!.manifest.entries.map((entry) => entry.periodTag)).size
      : 0;

  return (
    <dialog ref={props.ref} class="modal" onClose={props.onClose}>
      <div class="modal-box w-11/12 max-w-md rounded-xl bg-base-100">
        <h3 class="mb-1 text-lg font-bold">表示設定</h3>
        <p class="mb-4 text-xs text-base-content/60">
          戦闘データの表示元とローカル AVRO の読み込みを設定します。
        </p>
        <div class="rounded-lg border border-base-300 p-3 text-sm">
          <div class="font-medium">ローカルデータ</div>
          <div class="mt-1 text-xs text-base-content/65">
            権限: {permissionLabel(props.permission())}
          </div>
          <Show when={!supportsLocalDirectoryPicker()}>
            <div class="mt-1 text-xs text-base-content/65">
              このブラウザでは毎回ファイルを再選択する必要があります。
            </div>
          </Show>
          <Show when={props.scanResult()}>
            <div class="mt-1 text-xs text-base-content/65">
              期間 {periodCount()} 件 / ファイル {props.scanResult()!.fileCount} 件 / {formatBytes(props.scanResult()!.totalBytes)}
            </div>
          </Show>
          <Show when={props.localStatus() === "scanning"}>
            <div class="mt-2 text-xs text-base-content/65">
              {scanProgressLabel(props.scanProgress())}
            </div>
          </Show>
          <Show when={props.error()}>
            <div class="mt-2"><AlertMessage type="error">{props.error()!}</AlertMessage></div>
          </Show>
          <div class="mt-3 flex flex-wrap gap-2">
            <Show when={!props.scanResult() && props.hasStoredHandle() && props.permission() === "prompt"}>
              <button type="button" class="btn btn-primary btn-sm" onClick={props.onRequestPermission}>前回のディレクトリを使用</button>
            </Show>
            <Show when={!props.scanResult() && !(props.hasStoredHandle() && props.permission() === "prompt")}>
              <button type="button" class="btn btn-primary btn-sm" onClick={props.onPick}>ディレクトリを選択</button>
            </Show>
            <Show when={props.scanResult()}>
              <button type="button" class="btn btn-outline btn-sm" onClick={props.onRescan}>再スキャン</button>
              <button type="button" class="btn btn-ghost btn-sm" onClick={props.onPick}>再選択</button>
              <button type="button" class="btn btn-ghost btn-sm" onClick={props.onRelease}>アクセス解除</button>
            </Show>
          </div>
        </div>
        <div class="modal-action">
          <form method="dialog">
            <button type="submit" class="btn btn-primary btn-sm">閉じる</button>
          </form>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button type="submit" aria-label="閉じる"></button>
      </form>
    </dialog>
  );
}