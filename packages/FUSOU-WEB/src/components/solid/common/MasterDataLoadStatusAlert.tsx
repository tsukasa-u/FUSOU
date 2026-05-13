/** @jsxImportSource solid-js */
import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "solid-js";

export type MasterDataLoadStatusState = "pending" | "success" | "failed";

export type MasterDataLoadStatusItem = {
  name: string;
  status: MasterDataLoadStatusState;
  detail?: string;
};

export function MasterDataLoadStatusAlert(props: {
  items: MasterDataLoadStatusItem[];
  title?: string;
  class?: string;
}): JSX.Element {
  const [showDetails, setShowDetails] = createSignal(false);

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
      return `マスターデータ読込エラー — ${failed}件失敗 / ${total}件中`;
    if (pending > 0)
      return `マスターデータ読込中... (${total - pending}/${total})`;
    return `マスターデータ読込済み (${success}件)`;
  });

  // Show only while loading or when there are failures; hide on complete success.
  const shouldShow = createMemo(() => {
    const { failed, pending } = summary();
    return failed > 0 || pending > 0;
  });

  return (
    <Show when={(props.items?.length ?? 0) > 0 && shouldShow()}>
      <div class={`alert alert-${alertType()} text-sm ${props.class ?? ""}`.trim()}>
        <div class="flex flex-col gap-2 w-full">
          <div class="flex items-center justify-between gap-2">
            <span>{titleText()}</span>
            <button
              class="btn btn-xs btn-ghost"
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
            >
              {showDetails() ? "詳細を隠す" : "詳細を表示"}
            </button>
          </div>
          <Show when={showDetails()}>
            <div class="flex flex-col gap-1 text-xs opacity-80">
              <For each={props.items}>
                {(item) => (
                  <div class="flex items-center gap-1">
                    <span>
                      {item.status === "success"
                        ? "✓"
                        : item.status === "failed"
                          ? "✗"
                          : "⋯"}
                    </span>
                    <span>{item.name}</span>
                    <Show when={item.detail}>
                      <span class="opacity-70">({item.detail})</span>
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
