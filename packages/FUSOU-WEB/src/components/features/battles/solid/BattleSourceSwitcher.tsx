/** @jsxImportSource solid-js */
import { createSignal, onCleanup, onMount } from "solid-js";
import {
  clearStoredLocalDirectoryHandle,
  loadStoredLocalDirectoryHandle,
  saveLocalDirectoryHandle,
} from "@/features/battles/local-directory/handle-store";
import {
  pickLocalDirectory,
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
  const [repository, setRepository] = createSignal<BattleDataRepository>(
    new R2BattleRepository(),
  );
  const [localStatus, setLocalStatus] = createSignal<LocalStatus>("idle");
  const [permission, setPermission] = createSignal<LocalDirectoryPermissionState>("prompt");
  const [storedHandle, setStoredHandle] = createSignal<FileSystemDirectoryHandle | null>(null);
  const [scanResult, setScanResult] = createSignal<ManifestScanResult | null>(null);
  const [scanProgress, setScanProgress] = createSignal<ManifestScanProgress | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let disposed = false;
  let operationGeneration = 0;

  const replaceRepository = (nextRepository: BattleDataRepository) => {
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
    } catch (cause) {
      if (disposed || generation !== operationGeneration) return;
      setLocalStatus("error");
      setError(localScanErrorMessage(cause));
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
    } catch (cause) {
      if (disposed || generation !== operationGeneration) return;
      if (cause instanceof DOMException && cause.name === "AbortError") {
        return;
      }
      setLocalStatus("error");
      setError(cause instanceof Error ? cause.message : "ローカル AVRO の選択に失敗しました。");
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
    }
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
          }
        }
      } else if (source() === "local-avro") {
        restoreR2Source();
      }
    })();
  });

  onCleanup(() => {
    disposed = true;
    void repository()?.dispose();
  });

  return (
    <BattlesDashboard
      repository={repository()}
      source={source()}
      localStatus={localStatus()}
      localDirectoryName={() => storedHandle()?.name ?? null}
      permission={permission}
      scanResult={scanResult}
      scanProgress={scanProgress}
      localError={error}
      hasStoredHandle={() => storedHandle() !== null}
      localLimits={localLimits()}
      rememberSource={rememberSource()}
      onSourceChange={selectSource}
      onPickLocalDirectory={usePicker}
      onRequestLocalPermission={requestStoredPermission}
      onRescanLocalDirectory={rescanStoredHandle}
      onReleaseLocalAccess={releaseLocalAccess}
      onRefreshDataSource={refreshDataSource}
      onRememberSourceChange={setSourcePreference}
      onLocalLimitsChange={applyLocalLimits}
    />
  );
}
