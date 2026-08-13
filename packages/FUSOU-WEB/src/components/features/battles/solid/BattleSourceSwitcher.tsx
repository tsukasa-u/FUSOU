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
  scanLocalFileList,
  ManifestScanError,
  type ManifestScanProgress,
  type ManifestScanResult,
} from "@/features/battles/local-directory/manifest-scanner";
import { LocalAvroBattleRepository } from "@/features/battles/repository/local-avro-battle-repository";
import { R2BattleRepository } from "@/features/battles/repository/r2-battle-repository";
import {
  DEFAULT_LOCAL_AVRO_LOAD_LIMITS,
  normalizeLocalAvroLoadLimits,
  type LocalAvroLoadLimits,
} from "@/features/battles/local-directory/limits";
import type { BattleDataRepository } from "@/features/battles/repository/types";
import BattlesDashboard from "./BattlesDashboard";

type SourceKind = "r2" | "local-avro";
type LocalStatus = "idle" | "scanning" | "ready" | "error";
const SOURCE_PREFERENCE_KEY = "fusou:battles:preferred-source";
const LOCAL_LIMITS_KEY = "fusou:battles:local-avro-limits";

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

function loadLocalLimits(): LocalAvroLoadLimits {
  if (typeof window === "undefined") return DEFAULT_LOCAL_AVRO_LOAD_LIMITS;
  try {
    const stored = window.localStorage.getItem(LOCAL_LIMITS_KEY);
    return normalizeLocalAvroLoadLimits(stored ? JSON.parse(stored) : null);
  } catch {
    return DEFAULT_LOCAL_AVRO_LOAD_LIMITS;
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
    if (error.code === "MANIFEST_SIZE_EXCEEDED") return "AVROデータの合計サイズが上限を超えています。";
    if (error.code === "PERMISSION_DENIED") return "ローカルAVROへの読み取り権限が失われました。";
  }
  return "ローカルAVROの確認に失敗しました。";
}

export default function BattleSourceSwitcher() {
  const initialSource = sourceFromUrl();
  const [source, setSource] = createSignal<SourceKind>(initialSource);
  const [rememberSource, setRememberSource] = createSignal(hasStoredSourcePreference());
  const [localLimits, setLocalLimits] = createSignal<LocalAvroLoadLimits>(loadLocalLimits());
  const [repository, setRepository] = createSignal<BattleDataRepository | null>(
    initialSource === "r2" ? new R2BattleRepository() : null,
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

  const persistLocalLimits = (limits: LocalAvroLoadLimits) => {
    try {
      window.localStorage.setItem(LOCAL_LIMITS_KEY, JSON.stringify(limits));
    } catch {
      // localStorage may be unavailable in privacy-restricted browsers.
    }
  };

  const scanHandle = async (
    handle: FileSystemDirectoryHandle,
    generation: number,
    limits = localLimits(),
  ) => {
    setLocalStatus("scanning");
    setError(null);
    setScanProgress(null);
    try {
      const result = await scanLocalDirectoryHandle(handle, {
        limits,
        onProgress: setScanProgress,
      });
      if (disposed || generation !== operationGeneration) return;
      setStoredHandle(handle);
      setScanResult(result);
      replaceRepository(new LocalAvroBattleRepository(result.manifest));
      setLocalStatus("ready");
      localSettingsModalRef?.close();
    } catch (cause) {
      if (disposed || generation !== operationGeneration) return;
      setLocalStatus("error");
      setError(localScanErrorMessage(cause));
      openLocalSettings();
    }
  };

  const applyPickerResult = (picked: LocalPickerResult) => {
    const sourceChanged = source() !== "local-avro";
    setSource("local-avro");
    if (rememberSource()) persistSourcePreference("local-avro");
    syncSourceQuery("local-avro", sourceChanged);
    setLocalStatus("ready");
    setScanResult(picked.scan);
    if (picked.kind === "file-list") {
      setStoredHandle(null);
      setPermission("unsupported");
    }
    replaceRepository(new LocalAvroBattleRepository(picked.scan.manifest));
  };

  const rescanFileList = async (
    files: File[],
    generation: number,
    limits: LocalAvroLoadLimits,
  ) => {
    setLocalStatus("scanning");
    setError(null);
    setScanProgress(null);
    try {
      const result = await scanLocalFileList(files, {
        limits,
        onProgress: setScanProgress,
      });
      if (disposed || generation !== operationGeneration) return;
      applyPickerResult({ kind: "file-list", scan: result });
    } catch (cause) {
      if (disposed || generation !== operationGeneration) return;
      setLocalStatus("error");
      setError(localScanErrorMessage(cause));
      openLocalSettings();
    }
  };

  const usePicker = async () => {
    setError(null);
    const generation = ++operationGeneration;
    try {
      const picked = await pickLocalDirectory(localLimits());
      if (disposed || generation !== operationGeneration) return;
      if (picked.kind === "directory-handle") {
        await saveLocalDirectoryHandle(picked.handle);
        setPermission("granted");
        setStoredHandle(picked.handle);
      }
      applyPickerResult(picked);
      localSettingsModalRef?.close();
    } catch (cause) {
      if (disposed || generation !== operationGeneration) return;
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
    const generation = ++operationGeneration;
    const nextPermission = await requestLocalDirectoryPermission(handle);
    if (disposed || generation !== operationGeneration) return;
    setPermission(nextPermission);
    if (nextPermission === "granted") await scanHandle(handle, generation);
    else openLocalSettings();
  };

  const rescanStoredHandle = async () => {
    const handle = storedHandle();
    if (!handle) return;
    const generation = ++operationGeneration;
    const currentPermission = await queryLocalDirectoryPermission(handle);
    if (disposed || generation !== operationGeneration) return;
    setPermission(currentPermission);
    if (currentPermission === "granted") await scanHandle(handle, generation, localLimits());
    else {
      openLocalSettings();
      await requestStoredPermission();
    }
  };

  const applyLocalLimits = async (nextLimits: LocalAvroLoadLimits) => {
    const normalized = normalizeLocalAvroLoadLimits(nextLimits);
    setLocalLimits(normalized);
    persistLocalLimits(normalized);
    if (source() !== "local-avro") return;
    if (storedHandle()) {
      await rescanStoredHandle();
      return;
    }

    const files = (scanResult()?.manifest.entries ?? [])
      .map((entry) => entry.file)
      .filter((file): file is File => file instanceof File);
    if (files.length === 0) {
      setError("上限を変更するには、ローカル AVRO を再選択してください。");
      openLocalSettings();
      return;
    }

    await rescanFileList(files, ++operationGeneration, normalized);
  };

  const refreshDataSource = async () => {
    if (source() !== "local-avro") return;
    if (storedHandle()) {
      await rescanStoredHandle();
      return;
    }
    setError("ファイル一覧から選択した AVRO は、更新時に再選択が必要です。");
    openLocalSettings();
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
    const cachedScan = scanResult();
    const cachedLimits = normalizeLocalAvroLoadLimits(cachedScan?.manifest.limits);
    const currentLimits = localLimits();
    const limitsChanged =
      cachedLimits.maxManifestBytes !== currentLimits.maxManifestBytes ||
      cachedLimits.maxQueryRecords !== currentLimits.maxQueryRecords;
    if (cachedScan && !limitsChanged) {
      setLocalStatus("ready");
      replaceRepository(new LocalAvroBattleRepository(cachedScan.manifest));
      return;
    }
    const handle = storedHandle();
    if (handle && permission() === "granted") void scanHandle(handle, generation);
    else if (cachedScan) {
      const files = cachedScan.manifest.entries
        .map((entry) => entry.file)
        .filter((file): file is File => file instanceof File);
      if (files.length > 0) void rescanFileList(files, generation, currentLimits);
      else openLocalSettings();
    } else openLocalSettings();
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
        fallback={<LocalPendingBattleShell />}
      >
        {(activeRepository) => (
          <BattlesDashboard
            repository={activeRepository}
            source={source()}
            localStatus={localStatus()}
            localDirectoryName={() => storedHandle()?.name ?? null}
            localLimits={localLimits()}
            rememberSource={rememberSource()}
            onSourceChange={selectSource}
            onOpenLocalDirectorySettings={openLocalSettings}
            onRefreshDataSource={refreshDataSource}
            onRememberSourceChange={setSourcePreference}
            onLocalLimitsChange={applyLocalLimits}
          />
        )}
      </Show>
    </>
  );
}

function LocalPendingBattleShell() {
  return (
    <main class="fusou-page-container max-w-360 pt-5">
      <h1 class="text-2xl font-bold">戦闘データ</h1>
    </main>
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