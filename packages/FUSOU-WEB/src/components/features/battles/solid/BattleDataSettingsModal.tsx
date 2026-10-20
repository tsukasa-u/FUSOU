/** @jsxImportSource solid-js */
import { FusouModal } from "@/components/common/solid/FusouModal";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { BattleDataProgress } from "@/features/battles/repository/types";
import {
  ABSOLUTE_MAX_MANIFEST_BYTES,
  ABSOLUTE_MAX_QUERY_RECORDS,
  DEFAULT_LOCAL_AVRO_LOAD_LIMITS,
  type LocalAvroLoadLimits,
} from "@/features/battles/local-directory/limits";
import type { MasterDataLoadStatusItem } from "@/components/common/solid/MasterDataLoadStatusAlert";
import { supportsLocalDirectoryPicker } from "@/features/battles/local-directory/picker";
import type { LocalDirectoryPermissionState } from "@/features/battles/local-directory/permissions";
import type { ManifestScanProgress, ManifestScanResult } from "@/features/battles/local-directory/manifest-scanner";
import { AlertMessage } from "@/components/common/solid/AlertMessage";

type Props = {
  ref: (element: HTMLDialogElement) => void;
  source: "r2" | "local-avro";
  localStatus: "idle" | "scanning" | "ready" | "error";
  localDirectoryName: () => string | null;
  permission: () => LocalDirectoryPermissionState;
  scanResult: () => ManifestScanResult | null;
  scanProgress: () => ManifestScanProgress | null;
  localError: () => string | null;
  hasStoredHandle: () => boolean;
  rememberSource: boolean;
  onSourceChange: (source: "r2" | "local-avro") => void;
  onPickLocalDirectory: () => void;
  onRequestLocalPermission: () => void;
  onRescanLocalDirectory: () => void;
  onReleaseLocalAccess: () => void;
  onRememberSourceChange: (enabled: boolean) => void;
  periodLabel: string;
  masterDataMeta: () => {
    period_tag?: string;
    period_revision?: number;
    table_version?: string;
  } | null;
  items: () => MasterDataLoadStatusItem[];
  progress: () => BattleDataProgress | null;
  loading: () => boolean;
  localLimits: LocalAvroLoadLimits;
  onLocalLimitsChange: (limits: LocalAvroLoadLimits) => void | Promise<void>;
};

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

function progressLabel(progress: BattleDataProgress): string {
  const files = progress.total > 0
    ? `ファイル ${progress.completed}/${progress.total}`
    : `ファイル ${progress.completed}`;
  const bytes = progress.totalBytes
    ? ` / ${formatBytes(progress.completedBytes ?? 0)} / ${formatBytes(progress.totalBytes)}`
    : "";
  const records = progress.records === undefined
    ? ""
    : ` / 保持レコード ${progress.records.toLocaleString()}件`;
  return `${files}${bytes}${records}`;
}

function bytesToMiB(value: number): number {
  return Math.round(value / (1024 * 1024));
}

export default function BattleDataSettingsModal(props: Props) {
  const [activeTab, setActiveTab] = createSignal<"r2" | "local-avro">(props.source);

  createEffect(() => {
    setActiveTab(props.source);
  });

  const [maxManifestMiB, setMaxManifestMiB] = createSignal(
    String(bytesToMiB(props.localLimits.maxManifestBytes)),
  );
  const [maxQueryRecords, setMaxQueryRecords] = createSignal(
    String(props.localLimits.maxQueryRecords),
  );

  createEffect(() => {
    setMaxManifestMiB(String(bytesToMiB(props.localLimits.maxManifestBytes)));
    setMaxQueryRecords(String(props.localLimits.maxQueryRecords));
  });

  const applyLocalLimits = () => {
    const manifestMiB = Number(maxManifestMiB());
    const queryRecords = Number(maxQueryRecords());
    if (!Number.isSafeInteger(manifestMiB) || manifestMiB < 1) return;
    if (!Number.isSafeInteger(queryRecords) || queryRecords < 1) return;
    void props.onLocalLimitsChange({
      maxManifestBytes: manifestMiB * 1024 * 1024,
      maxQueryRecords: queryRecords,
    });
  };

  return (
    <FusouModal
      ref={props.ref}
      title="戦闘データ設定"
      description="戦闘データの取得元（クラウド R2 または ローカル AVRO）と動作設定を管理します。"
      maxWidth="2xl"
      actions={
        <form method="dialog">
          <button type="submit" class="fusou-btn-primary">
            閉じる
          </button>
        </form>
      }
    >
      {/* タブナビゲーション */}
      <div class="flex border-b border-base-300 mb-4 gap-1">
        <button
          type="button"
          class={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab() === "r2"
              ? "border-primary text-primary bg-primary/10 rounded-t-md"
              : "border-transparent text-base-content/60 hover:text-base-content hover:bg-base-200/50 rounded-t-md"
          }`}
          onClick={() => setActiveTab("r2")}
        >
          <span>クラウド (R2)</span>
          <Show when={props.source === "r2"}>
            <span class="badge badge-accent badge-xs font-normal">使用中</span>
          </Show>
        </button>
        <button
          type="button"
          class={`px-4 py-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab() === "local-avro"
              ? "border-primary text-primary bg-primary/10 rounded-t-md"
              : "border-transparent text-base-content/60 hover:text-base-content hover:bg-base-200/50 rounded-t-md"
          }`}
          onClick={() => setActiveTab("local-avro")}
        >
          <span>ローカル (AVRO)</span>
          <Show when={props.source === "local-avro"}>
            <span class="badge badge-accent badge-xs font-normal">使用中</span>
          </Show>
        </button>
      </div>

      {/* 固定高さコンテンツコンテナ */}
      <div class="h-[380px] flex flex-col overflow-hidden">
        {/* Tab 1: Cloud (R2) */}
        <Show when={activeTab() === "r2"}>
          <div class="h-full space-y-4 overflow-y-auto pr-1">
            <div class="rounded-lg border border-base-300 p-3.5 space-y-2 bg-base-200/30">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-sm">公式配信データ (R2)</span>
                <Show
                  when={props.source === "r2"}
                  fallback={
                    <button
                      type="button"
                      class="fusou-btn-primary btn-xs"
                      onClick={() => props.onSourceChange("r2")}
                    >
                      クラウド (R2) を使用する
                    </button>
                  }
                >
                  <span class="badge badge-accent badge-xs font-semibold">現在使用中</span>
                </Show>
              </div>
              <p class="text-xs text-base-content/70 leading-relaxed">
                公式に配信されている集計データ（Cloudflare R2）から戦闘ログを取得します。
              </p>
              <div class="pt-1 border-t border-base-300/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span class="text-base-content/60 mr-1.5">対象期間:</span>
                  <span class="font-medium">{props.periodLabel}</span>
                </div>
                <Show when={props.masterDataMeta()?.period_revision}>
                  <span class="text-base-content/60">
                    Rev {props.masterDataMeta()?.period_revision}
                  </span>
                </Show>
              </div>
            </div>

            {/* データ状態 */}
            <div>
              <h4 class="mb-2 text-xs font-semibold text-base-content/60">マスターデータ状態</h4>
              <div class="space-y-1.5 rounded-lg border border-base-300 p-3">
                <For each={props.items()}>
                  {(item) => (
                    <div class="flex items-start gap-2 text-xs">
                      <span class="w-4 shrink-0 text-center">
                        {item.status === "success" ? "✓" : item.status === "failed" ? "✗" : "⋯"}
                      </span>
                      <span class="min-w-0 flex-1 wrap-break-word">
                        {item.name}
                        <Show when={item.detail}>
                          <span class="ml-1 text-base-content/60">({item.detail})</span>
                        </Show>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>

            {/* 読み込み進捗 */}
            <Show when={props.loading() && props.progress()}>
              {(progress) => (
                <div class="rounded-lg border border-base-300 p-3 text-xs">
                  <div class="mb-1 flex items-center justify-between gap-2">
                    <span>{progress().label || "データを読み込んでいます"}</span>
                    <span class="font-semibold tabular-nums">
                      {progress().total > 0
                        ? `${Math.round((progress().completed / progress().total) * 100)}%`
                        : ""}
                    </span>
                  </div>
                  <div class="text-base-content/60">{progressLabel(progress())}</div>
                </div>
              )}
            </Show>

            {/* 起動時の設定 */}
            <div class="form-control pt-1">
              <label class="flex cursor-pointer items-center gap-2 py-0">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm shrink-0"
                  checked={props.rememberSource && props.source === "r2"}
                  onChange={(event) => {
                    if (event.currentTarget.checked) {
                      props.onSourceChange("r2");
                    }
                    props.onRememberSourceChange(event.currentTarget.checked);
                  }}
                />
                <span class="label-text font-medium text-xs">次回起動時もクラウド (R2) を使う</span>
              </label>
            </div>
          </div>
        </Show>

        {/* Tab 2: Local (AVRO) */}
        <Show when={activeTab() === "local-avro"}>
          <div class="h-full space-y-4 overflow-y-auto pr-1">
            <div class="rounded-lg border border-base-300 p-3.5 space-y-3 bg-base-200/30">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-sm">ローカル AVRO データ</span>
                <Show
                  when={props.source === "local-avro"}
                  fallback={
                    <Show when={props.scanResult()}>
                      <button
                        type="button"
                        class="fusou-btn-primary btn-xs"
                        onClick={() => props.onSourceChange("local-avro")}
                      >
                        ローカル (AVRO) を使用する
                      </button>
                    </Show>
                  }
                >
                  <span class="badge badge-accent badge-xs font-semibold">現在使用中</span>
                </Show>
              </div>
              <p class="text-xs text-base-content/70 leading-relaxed">
                PC上のローカルディレクトリにある AVRO ファイルをブラウザ内で直接読み込んで解析します。
              </p>

              {/* ディレクトリ・ファイル情報 */}
              <div class="rounded border border-base-300/80 bg-base-100 p-3 text-xs space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-base-content/60">対象ディレクトリ:</span>
                  <span class="font-mono font-medium text-base-content/90">
                    {props.localDirectoryName() ?? "未設定"}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-base-content/60">アクセス権限:</span>
                  <span class="font-medium">{permissionLabel(props.permission())}</span>
                </div>
                <Show when={!supportsLocalDirectoryPicker()}>
                  <div class="text-[11px] text-warning">
                    ※ このブラウザではファイルピッカーから毎回選択する必要があります。
                  </div>
                </Show>
                <Show when={props.scanResult()}>
                  {(res) => {
                    const periodCount = new Set(res().manifest.entries.map((e) => e.periodTag)).size;
                    return (
                      <div class="flex items-center justify-between pt-1 border-t border-base-200">
                        <span class="text-base-content/60">検出データ:</span>
                        <span class="font-medium">
                          期間 {periodCount} 件 / ファイル {res().fileCount} 件 ({formatBytes(res().totalBytes)})
                        </span>
                      </div>
                    );
                  }}
                </Show>
              </div>

              {/* スキャン進捗 */}
              <Show when={props.localStatus === "scanning"}>
                <div class="text-xs text-primary font-medium flex items-center gap-2 p-2 bg-primary/5 rounded border border-primary/20">
                  <span class="loading loading-spinner loading-xs shrink-0"></span>
                  <span>{scanProgressLabel(props.scanProgress())}</span>
                </div>
              </Show>

              {/* エラー表示 */}
              <Show when={props.localError()}>
                <AlertMessage type="error">{props.localError()!}</AlertMessage>
              </Show>

              {/* 操作ボタン群 */}
              <div class="flex flex-wrap gap-2 pt-1">
                <Show
                  when={!props.scanResult() && props.hasStoredHandle() && props.permission() === "prompt"}
                >
                  <button
                    type="button"
                    class="fusou-btn-primary btn-xs"
                    onClick={props.onRequestLocalPermission}
                  >
                    前回のディレクトリを使用
                  </button>
                </Show>
                <Show when={!props.scanResult()}>
                  <button
                    type="button"
                    class="fusou-btn-primary btn-xs"
                    onClick={props.onPickLocalDirectory}
                  >
                    ディレクトリを選択
                  </button>
                </Show>
                <Show when={props.scanResult()}>
                  <button
                    type="button"
                    class="fusou-btn-secondary btn-xs"
                    onClick={props.onRescanLocalDirectory}
                  >
                    再スキャン
                  </button>
                  <button
                    type="button"
                    class="fusou-btn-secondary btn-xs"
                    onClick={props.onPickLocalDirectory}
                  >
                    ディレクトリを変更
                  </button>
                  <button
                    type="button"
                    class="fusou-btn-ghost btn-xs text-error hover:bg-error/10"
                    onClick={props.onReleaseLocalAccess}
                  >
                    アクセス解除
                  </button>
                </Show>
              </div>
            </div>

            {/* 読み込み進捗 */}
            <Show when={props.loading() && props.progress()}>
              {(progress) => (
                <div class="rounded-lg border border-base-300 p-3 text-xs">
                  <div class="mb-1 flex items-center justify-between gap-2">
                    <span>{progress().label || "データを読み込んでいます"}</span>
                    <span class="font-semibold tabular-nums">
                      {progress().total > 0
                        ? `${Math.round((progress().completed / progress().total) * 100)}%`
                        : ""}
                    </span>
                  </div>
                  <div class="text-base-content/60">{progressLabel(progress())}</div>
                </div>
              )}
            </Show>

            {/* 起動時の設定 */}
            <div class="form-control pt-1">
              <label class="flex cursor-pointer items-center gap-2 py-0">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm shrink-0"
                  checked={props.rememberSource && props.source === "local-avro"}
                  onChange={(event) => {
                    if (event.currentTarget.checked) {
                      props.onSourceChange("local-avro");
                    }
                    props.onRememberSourceChange(event.currentTarget.checked);
                  }}
                />
                <span class="label-text font-medium text-xs">次回起動時もローカル (AVRO) を使う</span>
              </label>
            </div>

            {/* AVROデータの読み込み上限設定 */}
            <div class="rounded-lg border border-base-300 p-3.5 space-y-3 bg-base-200/20">
              <div>
                <h4 class="text-xs font-semibold text-base-content/80">AVROデータの読み込み上限設定</h4>
                <p class="text-xs text-base-content/55 leading-relaxed mt-0.5">
                  既定値: 合計 {bytesToMiB(DEFAULT_LOCAL_AVRO_LOAD_LIMITS.maxManifestBytes).toLocaleString()} MiB / {DEFAULT_LOCAL_AVRO_LOAD_LIMITS.maxQueryRecords.toLocaleString()} 件
                </p>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="flex items-center justify-between gap-2 p-2 rounded-md bg-base-100 border border-base-300/60 text-xs">
                  <span class="text-base-content/70">合計サイズ (MiB)</span>
                  <input
                    class="input input-bordered input-xs w-28 text-right tabular-nums font-mono"
                    type="number"
                    min="1"
                    max={bytesToMiB(ABSOLUTE_MAX_MANIFEST_BYTES)}
                    step="1"
                    value={maxManifestMiB()}
                    onInput={(event) => setMaxManifestMiB(event.currentTarget.value)}
                    aria-label="AVRO合計サイズ上限 MiB"
                  />
                </label>
                <label class="flex items-center justify-between gap-2 p-2 rounded-md bg-base-100 border border-base-300/60 text-xs">
                  <span class="text-base-content/70">保持レコード数</span>
                  <input
                    class="input input-bordered input-xs w-28 text-right tabular-nums font-mono"
                    type="number"
                    min="1"
                    max={ABSOLUTE_MAX_QUERY_RECORDS}
                    step="1"
                    value={maxQueryRecords()}
                    onInput={(event) => setMaxQueryRecords(event.currentTarget.value)}
                    aria-label="AVRO record数上限"
                  />
                </label>
              </div>

              <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-base-300/60">
                <p class="text-[11px] text-base-content/50 leading-tight">
                  最大値: {bytesToMiB(ABSOLUTE_MAX_MANIFEST_BYTES).toLocaleString()} MiB / {ABSOLUTE_MAX_QUERY_RECORDS.toLocaleString()} 件
                </p>
                <button
                  type="button"
                  class="fusou-btn-primary btn-sm shrink-0 self-end sm:self-auto gap-1.5"
                  onClick={applyLocalLimits}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>適用して再読み込み</span>
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </FusouModal>
  );
}
