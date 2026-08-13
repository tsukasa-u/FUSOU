/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { BattleDataProgress } from "@/features/battles/repository/types";
import type { MasterDataLoadStatusItem } from "@/components/common/solid/MasterDataLoadStatusAlert";

type Props = {
  ref: (element: HTMLDialogElement) => void;
  source: "r2" | "local-avro";
  localStatus: "idle" | "scanning" | "ready" | "error";
  localDirectoryName: () => string | null;
  rememberSource: boolean;
  onSourceChange: (source: "r2" | "local-avro") => void;
  onOpenLocalDirectorySettings: () => void;
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
};

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
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

export default function BattleDataSettingsModal(props: Props) {
  return (
    <dialog ref={props.ref} class="modal">
      <div class="modal-box w-11/12 max-w-lg rounded-xl bg-base-100">
        <h3 class="mb-1 text-lg font-bold">データ設定</h3>
        <p class="mb-4 text-xs text-base-content/60">
          現在表示している戦闘データの取得元と状態を確認できます。
        </p>

        <div class="space-y-3 text-sm">
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-base-300 p-3">
            <span class="text-base-content/60">データソース</span>
            <span>{props.source === "local-avro" ? "ローカル AVRO" : "R2"}</span>
            <span class="text-base-content/60">参照期間</span>
            <span>{props.periodLabel}</span>
            <Show when={props.masterDataMeta()}>
              {(meta) => (
                <>
                  <span class="text-base-content/60">マスターデータ</span>
                  <span>
                    {meta().period_tag || "-"}
                    <Show when={meta().period_revision !== undefined}>
                      {` rev${meta().period_revision}`}
                    </Show>
                    <Show when={meta().table_version}>
                      {` / ${meta().table_version}`}
                    </Show>
                  </span>
                </>
              )}
            </Show>
          </div>

          <div>
            <h4 class="mb-2 text-xs font-semibold text-base-content/60">データ状態</h4>
            <div class="space-y-1.5">
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

          <div class="form-control space-y-3">
            <h4 class="text-xs font-semibold text-base-content/60">データソース</h4>
            <div class="flex items-start gap-2 py-0">
              <input
                id="battle-data-source-r2"
                type="radio"
                name="battle-data-source-modal"
                class="radio radio-sm mt-0.5 shrink-0"
                value="r2"
                checked={props.source === "r2"}
                onChange={() => props.onSourceChange("r2")}
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <label for="battle-data-source-r2" class="label-text cursor-pointer font-medium">R2</label>
                <span class="text-xs leading-5 text-base-content/60">
                  サーバー上の共有データを使います。
                </span>
              </span>
            </div>
            <div class="flex items-start gap-2 py-0">
              <input
                id="battle-data-source-local-avro"
                type="radio"
                name="battle-data-source-modal"
                class="radio radio-sm mt-0.5 shrink-0"
                value="local-avro"
                checked={props.source === "local-avro"}
                onChange={() => props.onSourceChange("local-avro")}
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <label for="battle-data-source-local-avro" class="label-text cursor-pointer font-medium">ローカル AVRO</label>
                <span class="text-xs leading-5 text-base-content/60">
                  選択したローカルファイルをブラウザ内で読み込みます。
                </span>
                <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
                  <span>ディレクトリ: {props.localDirectoryName() ?? "未設定"}</span>
                  <button
                    type="button"
                    class="btn btn-outline btn-xs"
                    onClick={props.onOpenLocalDirectorySettings}
                  >
                    ディレクトリを変更
                  </button>
                </span>
              </span>
            </div>
            <Show when={props.source === "local-avro" && props.localStatus === "scanning"}>
              <span class="ml-6 text-xs text-base-content/60">読込中...</span>
            </Show>
          </div>
          <div class="form-control space-y-2">
            <h4 class="text-xs font-semibold text-base-content/60">起動時の設定</h4>
            <label class="flex cursor-pointer items-center gap-2 py-0">
              <input
                type="checkbox"
                class="checkbox checkbox-sm shrink-0"
                checked={props.rememberSource}
                onChange={(event) => props.onRememberSourceChange(event.currentTarget.checked)}
              />
              <span class="label-text font-medium">次回もこのデータソースを使う</span>
            </label>
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