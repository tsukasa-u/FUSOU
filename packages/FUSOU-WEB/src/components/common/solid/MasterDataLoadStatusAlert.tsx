/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { copyToClipboard } from "@/utils/clipboard";

export type MasterDataLoadStatusState = "pending" | "success" | "failed";

export type MasterDataLoadStatusItem = {
  name: string;
  status: MasterDataLoadStatusState;
  detail?: string;
  diagnostic?: string;
};

export function MasterDataLoadStatusAlert(props: {
  items: MasterDataLoadStatusItem[];
  title?: string;
  subtitle?: string | JSX.Element;
  progress?: {
    value: number;
    max: number;
    label?: string;
  };
  alwaysShow?: boolean;
  errorsOnly?: boolean;
  class?: string;
}): JSX.Element {
  const [showDetails, setShowDetails] = createSignal(false);
  const [copiedItemName, setCopiedItemName] = createSignal<string | null>(null);
  let copiedTimer: number | undefined;

  onCleanup(() => {
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
  });

  const copyItemDetail = async (item: MasterDataLoadStatusItem): Promise<void> => {
    const text = item.diagnostic ?? item.detail;
    if (!text) return;
    const copied = await copyToClipboard(text);
    if (!copied) return;
    setCopiedItemName(item.name);
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => setCopiedItemName(null), 2000);
  };

  const summary = createMemo(() => {
    const items = props.items ?? [];
    const success = items.filter((item) => item.status === "success").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const pending = items.filter((item) => item.status === "pending").length;
    return { success, failed, pending, total: items.length };
  });

  const alertType = createMemo(() => {
    const { failed, pending, total, success } = summary();
    if (failed > 0) return "warning" as const;
    if (pending > 0) return "info" as const;
    if (total > 0 && success === total) return "success" as const;
    return "info" as const;
  });

  const titleText = createMemo(() => {
    const { success, failed, pending, total } = summary();
    if (props.title) return props.title;
    if (failed > 0)
      return `データ読込エラー — ${failed}件失敗 / ${total}件中`;
    if (pending > 0)
      return `データ読込中... (${total - pending}/${total})`;
    return `データ読込完了 (${success}件)`;
  });

  const progressPercent = createMemo(() => {
    const progress = props.progress;
    if (!progress || progress.max <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((progress.value / progress.max) * 100)));
  });

  // Show only while loading or when there are failures; hide on complete success.
  const shouldShow = createMemo(() => {
    if (props.errorsOnly) return summary().failed > 0;
    if (props.alwaysShow) return true;
    const { failed, pending } = summary();
    return failed > 0 || pending > 0;
  });

  return (
    <Show when={(props.items?.length ?? 0) > 0 && shouldShow()}>
      <div class={`alert alert-${alertType()} w-full max-w-none text-sm ${props.class ?? ""}`.trim()}>
        <div class="col-span-full flex w-full min-w-0 flex-col gap-2">
          <div class="flex w-full items-start gap-2">
            <div class="min-w-0 flex-1 flex flex-col gap-0.5">
              <span>{titleText()}</span>
              <Show when={props.subtitle}>
                <span class="text-[11px] opacity-70">{props.subtitle}</span>
              </Show>
            </div>
            <button
              class="btn btn-xs btn-ghost ml-auto shrink-0 whitespace-nowrap"
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
            >
              {showDetails() ? "詳細を隠す" : "詳細を表示"}
            </button>
          </div>
          <Show when={props.progress}>
            <div class="flex w-full min-w-0 items-center justify-between gap-2 text-xs opacity-80">
              <span class="min-w-0 wrap-break-word">
                {props.progress!.label ?? "データを読み込んでいます"}
              </span>
              <span class="shrink-0 font-semibold tabular-nums">
                {progressPercent()}%
              </span>
            </div>
            <progress
              class="progress progress-warning block h-1.5 w-full min-w-0"
              max={props.progress!.max}
              value={props.progress!.value}
              aria-label="データ読込進捗"
              aria-valuetext={`${progressPercent()}%`}
            />
          </Show>
          <Show when={showDetails()}>
            <div class="flex flex-col gap-1 text-xs opacity-80 mt-1">
              <For each={props.items}>
                {(item) => (
                  <div class="flex w-full items-start gap-2">
                    <span class="shrink-0">
                      {item.status === "success"
                        ? "✓"
                        : item.status === "failed"
                          ? "✗"
                          : "⋯"}
                    </span>
                    <div class="min-w-0 flex-1">
                      <span>{item.name}</span>
                      <Show when={item.detail}>
                        <span class="ml-1 opacity-70 wrap-break-word">({item.detail})</span>
                      </Show>
                    </div>
                    <Show when={item.status === "failed" && (item.diagnostic || item.detail)}>
                      <button
                        class="btn btn-ghost btn-xs ml-auto shrink-0 whitespace-nowrap"
                        type="button"
                        title={`${item.name}の詳細な診断をコピー`}
                        aria-label={`${item.name}の詳細な診断をコピー`}
                        onClick={() => copyItemDetail(item)}
                      >
                        {copiedItemName() === item.name ? "コピー済み" : "診断をコピー"}
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
