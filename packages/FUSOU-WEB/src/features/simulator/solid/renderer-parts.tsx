/** @jsxImportSource solid-js */
import { Show, type JSX } from "solid-js";
import { SimulatorEquipImprovementBadge } from "@/components/features/simulator/solid/SimulatorEquipImprovementBadge";
import { SimulatorEquipProficiencyBadge } from "@/components/features/simulator/solid/SimulatorEquipProficiencyBadge";
import { WeaponIcon } from "@/components/features/simulator/solid/shared-ui";
import { isWorkspaceReadOnly } from "@/features/simulator/simulator-selectors";

const isReadOnly = () => isWorkspaceReadOnly();

export function DeleteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" class="w-3.5 h-3.5 shrink-0">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
      />
    </svg>
  );
}

interface EquipSlotControlsProps {
  distance?: number | null;
  canShowProf?: boolean;
  profLevel?: number;
  onCycleProf?: () => void;
  hasEquip?: boolean;
  impLevel?: number;
  onCycleImp?: () => void;
  canDelete?: boolean;
  deleteTitle?: string;
  onDelete?: () => void;
  rowHovered: boolean;
  cardHovered?: boolean;
}

export function EquipSlotControls(
  props: EquipSlotControlsProps,
): JSX.Element {
  return (
    <span class="ml-auto flex items-center justify-end gap-1 shrink-0">
      {props.distance !== undefined ? (
        props.distance != null ? (
          <span
            class="inline-flex items-center justify-center w-6 h-4 leading-none text-[10px] text-base-content/40 font-mono shrink-0 select-none"
            title={`行動半径: ${props.distance}`}
          >
            {props.distance}
          </span>
        ) : (
          <span class="w-6 shrink-0" />
        )
      ) : null}

      {props.canShowProf ? (
        <SimulatorEquipProficiencyBadge
          level={props.profLevel ?? 0}
          hovered={props.rowHovered}
          onCycle={() => {
            if (isReadOnly()) return;
            props.onCycleProf?.();
          }}
        />
      ) : null}

      {props.hasEquip ? (
        <SimulatorEquipImprovementBadge
          level={props.impLevel ?? 0}
          hovered={props.rowHovered}
          onCycle={() => {
            if (isReadOnly()) return;
            props.onCycleImp?.();
          }}
        />
      ) : (
        <span class="w-7 shrink-0" />
      )}

      {props.canDelete ? (
        <button
          class={`w-5 h-5 inline-flex items-center justify-center leading-none rounded-md bg-base-100/90 backdrop-blur-xs border border-base-300/80 text-base-content/75 hover:bg-error hover:text-error-content hover:border-error shadow-2xs active:scale-90 transition-all duration-150 cursor-pointer shrink-0 ${
            props.rowHovered || props.cardHovered
              ? "opacity-100 scale-100"
              : "opacity-0 scale-95 pointer-events-none"
          }`}
          title={props.deleteTitle}
          onClick={(event) => {
            event.stopPropagation();
            if (isReadOnly()) return;
            props.onDelete?.();
          }}
        >
          <DeleteIcon />
        </button>
      ) : (
        <span class="w-5 h-5 shrink-0" />
      )}
    </span>
  );
}

interface EquipSlotRowProps {
  indexText: string;
  indexColorClass?: string;
  iconNum?: number | null | undefined;
  equipName?: string | null | undefined;
  emptyLabel?: string;
  isSuppressed?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  borderTopDashed?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  children: JSX.Element;
}

export function EquipSlotRow(props: EquipSlotRowProps): JSX.Element {
  const hasEquip = () => Boolean(props.equipName);

  return (
    <div
      data-testid="simulator-equip-slot"
      class={`group/slot flex items-center gap-1.5 px-2 h-7 text-xs cursor-pointer transition-colors ${
        props.disabled
          ? "opacity-40 select-none cursor-default"
          : "hover:bg-base-200/50"
      } ${props.borderTopDashed ? "border-t border-dashed border-base-200/60" : ""}`}
      title={props.title}
      onMouseEnter={() => props.onHoverChange?.(true)}
      onMouseLeave={() => props.onHoverChange?.(false)}
      onClick={props.onClick}
    >
      <span
        class={`w-4 text-center text-[10px] font-mono shrink-0 select-none leading-none inline-flex items-center justify-center ${
          props.indexColorClass ?? "text-base-content/30"
        }`}
      >
        {props.indexText}
      </span>

      {props.iconNum != null && props.iconNum > 0 ? (
        <WeaponIcon iconNum={props.iconNum} />
      ) : (
        <div style="width:16px;height:16px" class="shrink-0" />
      )}

      <span
        class={`truncate flex-1 text-[11px] leading-none inline-flex items-center gap-1 min-w-0 ${
          hasEquip()
            ? "text-base-content/85 group-hover/slot:text-primary transition-colors font-medium"
            : "text-base-content/30 italic"
        }`}
      >
        <span class="truncate">
          {props.equipName ?? (props.emptyLabel ?? "未配備")}
        </span>
        <Show when={props.isSuppressed}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            class="w-3.5 h-3.5 text-error shrink-0"
          >
            <title>他装備の影響によりシナジーが低下しています</title>
            <path
              fill-rule="evenodd"
              d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z"
              clip-rule="evenodd"
            />
          </svg>
        </Show>
      </span>

      {props.children}
    </div>
  );
}
