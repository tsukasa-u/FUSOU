import { For, Show, createMemo } from "solid-js";
import { useQuests } from "../../utility/provider.tsx";

type QuestView = {
  no: number;
  title: string;
  detail: string;
  progress_flag: number;
};

function progressLabel(progressFlag: number): string {
  switch (progressFlag) {
    case 0:
      return "0%";
    case 1:
      return "50%";
    case 2:
      return "80%";
    case 3:
      return "100%";
    default:
      return "-";
  }
}

export function QuestsComponent() {
  const [quests] = useQuests();

  const available = createMemo<QuestView[]>(() => {
    return Object.values(quests.quests)
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .filter((q) => q.state === 1 && q.invalid_flag === 0)
      .sort((a, b) => a.no - b.no)
      .map((q) => ({
        no: q.no,
        title: q.title,
        detail: q.detail,
        progress_flag: q.progress_flag,
      }));
  });

  const accepted = createMemo<QuestView[]>(() => {
    return Object.values(quests.quests)
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .filter((q) => q.state === 2)
      .sort((a, b) => a.no - b.no)
      .map((q) => ({
        no: q.no,
        title: q.title,
        detail: q.detail,
        progress_flag: q.progress_flag,
      }));
  });

  const hasData = createMemo(() => available().length > 0 || accepted().length > 0);

  const questCard = (q: QuestView) => (
    <li class="text-xs py-1 w-full justify-between items-start gap-3">
      <div class="px-2 items-start gap-2 w-150">
        <div class="flex flex-col gap-0.5">
          <span class="w-8 shrink-0 text-base-content/70 text-right">[{q.no}]</span>
          <span class="w-8 text-right shrink-0 text-base-content/60">
            {progressLabel(q.progress_flag)}
          </span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate">{q.title}</div>
          <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">{q.detail}</div>
        </div>
      </div>
    </li>
  );

  return (
    <li>
      <details open>
        <summary>Quests</summary>
        <ul class="pl-0 max-w-[960px]">
          <Show
            when={hasData()}
            fallback={<li class="text-xs py-2">Loading Quest Data ...</li>}
          >
            <li class="text-xs px-2 py-1 font-semibold text-base-content/80">
              Accepted ({accepted().length})
            </li>
            <For each={accepted()}>
              {(q) => (
                questCard(q)
              )}
            </For>

            <li class="text-xs px-2 py-1 font-semibold text-base-content/80 mt-2">
              Available ({available().length})
            </li>
            <For each={available()}>
              {(q) => (
                questCard(q)
              )}
            </For>
          </Show>
        </ul>
      </details>
    </li>
  );
}