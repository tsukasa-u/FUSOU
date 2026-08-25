import { For, Show } from "solid-js";

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
  return (
    <>
      Formation : <span class="w-1" />
      <For each={props.formation?.slice(0, 2) ?? []}>
        {(formation, index) => (
          <>
            <div class={index() === 0 ? "text-lime-500" : "text-red-500"}>
              {FORMATION_LABELS[formation ?? -1] ?? "___"}
            </div>
            <Show when={index() === 0}>
              <div class="w-3 text-center">/</div>
            </Show>
          </>
        )}
      </For>
    </>
  );
}