import { For, Show, createMemo, createSignal } from "solid-js";
import { EmptyValue, MenuFilterBar } from "ui";
import { useQuests } from "../../utility/provider.tsx";
import {
  filterQuestList,
  getQuestPeriodLabel,
} from "../../utility/quest_cache.ts";

type QuestCompletionStatus = "claimable" | "completed";

type QuestView = {
  no: number;
  title: string;
  detail: string;
  progress_flag: number;
  quest_type: number;
  label_type: number;
  completionStatus?: QuestCompletionStatus;
};

function progressLabel(progressFlag: number): string | null {
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
      return null;
  }
}

function normalizeDetail(raw: string): string {
  return raw.replace(/<br\s*\/?>/gi, "\n").trim();
}

export function QuestsComponent() {
  const [quests] = useQuests();
  const [query, setQuery] = createSignal("");

  const rawAvailable = createMemo<QuestView[]>(() => {
    return Object.values(quests.quests)
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .filter((q) => q.state === 1 && q.invalid_flag === 0)
      .sort((a, b) => a.no - b.no)
      .map((q) => ({
        no: q.no,
        title: q.title,
        detail: normalizeDetail(q.detail),
        progress_flag: q.progress_flag,
        quest_type: q.quest_type,
        label_type: q.label_type,
      }));
  });

  const rawAccepted = createMemo<QuestView[]>(() => {
    return Object.values(quests.quests)
      .filter((q): q is NonNullable<typeof q> => Boolean(q))
      .filter((q) => q.state === 2)
      .sort((a, b) => a.no - b.no)
      .map((q) => ({
        no: q.no,
        title: q.title,
        detail: normalizeDetail(q.detail),
        progress_flag: q.progress_flag,
        quest_type: q.quest_type,
        label_type: q.label_type,
      }));
  });

  const rawCompleted = createMemo<QuestView[]>(() => {
    const byNo = new Map<number, QuestView>();

    for (const record of Object.values(quests.clearedQuests ?? {})) {
      if (!record?.quest) continue;
      const q = record.quest;
      byNo.set(q.no, {
        no: q.no,
        title: q.title,
        detail: normalizeDetail(q.detail),
        progress_flag: q.progress_flag,
        quest_type: q.quest_type,
        label_type: q.label_type,
        completionStatus: "completed",
      });
    }

    for (const q of Object.values(quests.quests)) {
      if (!q || q.state !== 3) continue;
      byNo.set(q.no, {
        no: q.no,
        title: q.title,
        detail: normalizeDetail(q.detail),
        progress_flag: q.progress_flag,
        quest_type: q.quest_type,
        label_type: q.label_type,
        completionStatus: "claimable",
      });
    }

    return Array.from(byNo.values()).sort((a, b) => a.no - b.no);
  });

  const available = createMemo(() => filterQuestList(rawAvailable(), query()));
  const accepted = createMemo(() => filterQuestList(rawAccepted(), query()));
  const completed = createMemo(() => filterQuestList(rawCompleted(), query()));

  const rawTotalCount = createMemo(
    () => rawAvailable().length + rawAccepted().length + rawCompleted().length,
  );

  const filteredTotalCount = createMemo(
    () => available().length + accepted().length + completed().length,
  );

  const hasData = createMemo(() => rawTotalCount() > 0);

  const questCard = (q: QuestView) => {
    const progress = progressLabel(q.progress_flag);
    const period = getQuestPeriodLabel(q.quest_type, q.label_type);

    return (
      <li class="text-xs py-1 w-full justify-between items-start gap-3">
        <div class="px-2 flex items-start gap-2 w-150 max-w-full">
          <div class="flex flex-col gap-0.5 tabular-nums w-9 shrink-0 items-end">
            <span class="text-base-content/70">[{q.no}]</span>
            <Show
              when={progress !== null}
              fallback={<EmptyValue size="xs" align="right" />}
            >
              <span class="text-base-content/60">{progress}</span>
            </Show>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="truncate">{q.title}</span>
              <Show when={period}>
                <span class="badge badge-xs badge-ghost border-base-300 shrink-0">
                  {period}
                </span>
              </Show>
              <Show when={q.completionStatus === "claimable"}>
                <span class="badge badge-xs badge-success shrink-0">
                  Claimable
                </span>
              </Show>
              <Show when={q.completionStatus === "completed"}>
                <span class="badge badge-xs badge-neutral shrink-0">
                  Completed
                </span>
              </Show>
            </div>
            <Show when={q.detail.length > 0}>
              <div class="text-[11px] text-base-content/60 whitespace-pre-wrap wrap-break-word mt-0.5">
                {q.detail}
              </div>
            </Show>
          </div>
        </div>
      </li>
    );
  };

  return (
    <li class="w-full min-w-0">
      <details open class="min-w-0 w-full">
        <summary>Quests</summary>
        <ul class="pl-0 max-w-[960px]">
          <Show
            when={hasData()}
            fallback={<li class="text-xs py-2">Loading Quest Data ...</li>}
          >
            <MenuFilterBar
              value={query()}
              onInput={setQuery}
              placeholder="Filter quests..."
              filteredCount={filteredTotalCount()}
              totalCount={rawTotalCount()}
            />

            <li class="text-xs px-2 py-1 font-semibold text-base-content/80">
              Accepted ({accepted().length})
            </li>
            <For each={accepted()}>{(q) => questCard(q)}</For>

            <li class="text-xs px-2 py-1 font-semibold text-base-content/80 mt-2">
              Available ({available().length})
            </li>
            <For each={available()}>{(q) => questCard(q)}</For>

            <li class="text-xs px-2 py-1 font-semibold text-base-content/80 mt-2">
              Completed ({completed().length})
            </li>
            <For each={completed()}>{(q) => questCard(q)}</For>
          </Show>
        </ul>
      </details>
    </li>
  );
}
