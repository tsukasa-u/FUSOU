import { For, Show } from "solid-js";
import { EmptyValue } from "ui";

const FORMATION_LABELS: Record<number, string> = {
  1: "Line Ahead",
  2: "Double Line",
  3: "Diamond",
  4: "Echelon",
  5: "Line Abreast",
  6: "Vanguard",
  11: "1st cruising formation",
  12: "2nd cruising formation",
  13: "3rd cruising formation",
  14: "4th cruising formation",
};

interface FormationProps {
  formation?: readonly (number | null | undefined)[] | null;
}

export function FormationComponent(props: FormationProps) {
  const slots = () => {
    const raw = props.formation ?? [];
    return [raw[0] ?? undefined, raw[1] ?? undefined];
  };

  return (
    <div class="inline-flex items-center shrink-0">
      <span>Formation :</span>
      <span class="w-1" />
      <For each={slots()}>
        {(formation, index) => {
          const label = () => FORMATION_LABELS[formation ?? -1];
          return (
            <>
              <div class="w-36 shrink-0 truncate">
                <Show
                  when={label()}
                  fallback={
                    <EmptyValue size="xs" align="center" widthClass="w-full" />
                  }
                >
                  <span
                    class={index() === 0 ? "text-lime-500" : "text-red-500"}
                  >
                    {label()}
                  </span>
                </Show>
              </div>
              <Show when={index() === 0}>
                <div class="w-3 text-center shrink-0">/</div>
              </Show>
            </>
          );
        }}
      </For>
    </div>
  );
}
