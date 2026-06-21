/** @jsxImportSource solid-js */

/**
 * FleetListPanel — SolidJS component for the saved fleet list page.
 * Replaces the inline <script> DOM manipulation in fleets.astro.
 */

import {
  For,
  Show,
  createSignal,
  createResource,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";

type FleetEntry = {
  tag: string;
  uploaded?: string;
  size?: number;
};

type FleetsResponse = {
  ok: boolean;
  tags: FleetEntry[];
};

function formatUploadedAt(input: string | Date | undefined): string {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function FleetListPanel(props: { accessToken: string | null }): JSX.Element {
  const authHeaders = (): HeadersInit => {
    if (!props.accessToken) return {};
    return { Authorization: `Bearer ${props.accessToken}` };
  };

  const [deletedTags, setDeletedTags] = createSignal<Set<string>>(new Set());

  const [fleets] = createResource(async () => {
    if (!props.accessToken) return null;
    const res = await fetch("/api/fleet/snapshots/list", {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Failed to load fleet list");
    const data = (await res.json()) as FleetsResponse;
    return data.tags ?? [];
  });

  const visibleFleets = () => {
    const data = fleets();
    if (!data) return [];
    return data.filter((entry) => !deletedTags().has(entry.tag));
  };

  async function handleDelete(tag: string) {
    if (!confirm(`「${tag}」を削除しますか？`)) return;
    try {
      const res = await fetch(
        `/api/fleet/snapshot/${encodeURIComponent(tag)}`,
        {
          method: "DELETE",
          headers: authHeaders(),
        },
      );
      if (!res.ok) {
        alert("削除に失敗しました");
        return;
      }
      setDeletedTags((prev) => {
        const next = new Set(prev);
        next.add(tag);
        return next;
      });
    } catch {
      alert("削除エラー");
    }
  }

  return (
    <>
      <Show when={!props.accessToken}>
        <tr>
          <td colspan={3} class="text-center py-12 text-warning">
            一覧表示には Webサービス連携が必要です
          </td>
        </tr>
      </Show>

      <Show when={props.accessToken}>
        <Show when={fleets.loading}>
          <tr>
            <td colspan={3} class="text-center py-12">
              <span class="loading loading-spinner loading-md"></span>
              <p class="mt-2 text-base-content/40">読込中...</p>
            </td>
          </tr>
        </Show>

        <Show when={fleets.error}>
          <tr>
            <td colspan={3} class="text-center py-12 text-error">
              読込に失敗しました
            </td>
          </tr>
        </Show>

        <Show when={!fleets.loading && !fleets.error && fleets()}>
          <Show
            when={visibleFleets().length > 0}
            fallback={
              <tr>
                <td
                  colspan={3}
                  class="text-center py-12 text-base-content/40"
                >
                  保存された艦隊データがありません
                </td>
              </tr>
            }
          >
            <For each={visibleFleets()}>
              {(entry) => (
                <tr class="hover">
                  <td class="font-mono">{entry.tag}</td>
                  <td class="text-base-content/40">
                    {formatUploadedAt(entry.uploaded)}
                  </td>
                  <td class="flex gap-1">
                    <a
                      href={`/simulator?fleet=${encodeURIComponent(entry.tag)}`}
                      class="btn btn-primary btn-xs btn-open-fleet"
                    >
                      シミュレータで開く
                    </a>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-delete"
                      data-tag={entry.tag}
                      onClick={() => handleDelete(entry.tag)}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </>
  );
}

export function mountFleetListPanel(
  root: HTMLElement,
  accessToken: string | null,
): void {
  render(() => <FleetListPanel accessToken={accessToken} />, root);
}
