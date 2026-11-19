/** @jsxImportSource solid-js */
import { Index, createMemo, createSignal, type JSX } from "solid-js";
import { useStore } from "@nanostores/solid";
import type { AirBaseSlot } from "@/features/simulator/types";
import { AIRCRAFT_TYPES } from "@/features/simulator/constants";
import { openEquipModal } from "@/features/simulator/equip-modal";
import {
  applyAirBaseEquipSelection,
  cycleAirBaseEquipImprovement,
  cycleAirBaseEquipProficiency,
  setAirBaseEquip,
  setEquipModalTargetForAirBase,
} from "@/features/simulator/simulator-mutations";
import { simulatorAirbaseState } from "@/features/simulator/state";
import {
  getAirBaseState,
  getMasterSlotItem,
  isWorkspaceReadOnly,
} from "@/features/simulator/simulator-selectors";
import {
  EquipSlotControls,
  EquipSlotRow,
} from "@/features/simulator/solid/renderer-parts";

const AIRBASE_EQUIP_SLOT_INDEXES = [0, 1, 2, 3] as const;
const isReadOnly = () => isWorkspaceReadOnly();

function airBaseSlotEqual(
  prev: AirBaseSlot | null,
  next: AirBaseSlot | null,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  const len = Math.max(prev.equipIds.length, next.equipIds.length);
  for (let i = 0; i < len; i++) {
    if (prev.equipIds[i] !== next.equipIds[i]) return false;
    if (prev.equipImprovement[i] !== next.equipImprovement[i]) return false;
    if (prev.equipProficiency[i] !== next.equipProficiency[i]) return false;
  }
  return true;
}

function getLiveAirBase(index: number): AirBaseSlot {
  const base = getAirBaseState()[index];
  if (!base) {
    throw new Error(`Air base ${index} is unavailable`);
  }
  return base;
}

function applyAirBaseEquipSelectionAt(
  airBaseIndex: number,
  equipSlotIndex: number,
  selection: Parameters<typeof applyAirBaseEquipSelection>[2],
): void {
  const targetBase = getLiveAirBase(airBaseIndex);
  if (!targetBase) return;
  applyAirBaseEquipSelection(targetBase, equipSlotIndex, selection);
}

function computeAirbaseActionRadius(base: AirBaseSlot): {
  baseRadius: number;
  bonus: number;
  finalRadius: number;
} {
  const equipped = base.equipIds
    .map((id) => (id != null ? getMasterSlotItem(id) : null))
    .filter(
      (equip): equip is NonNullable<ReturnType<typeof getMasterSlotItem>> =>
        equip != null,
    );

  const sortieAircraft = equipped.filter(
    (equip) =>
      AIRCRAFT_TYPES.has(equip.type?.[2] ?? -1) && (equip.distance ?? 0) > 0,
  );
  if (sortieAircraft.length === 0) {
    return { baseRadius: 0, bonus: 0, finalRadius: 0 };
  }

  const baseRadius = Math.min(...sortieAircraft.map((equip) => equip.distance ?? 0));
  const largeFlyingBoats = equipped.filter(
    (equip) => (equip.type?.[2] ?? -1) === 41 && (equip.distance ?? 0) > 0,
  );
  let bonus = 0;
  if (largeFlyingBoats.length > 0) {
    const supportMax = Math.max(
      ...largeFlyingBoats.map((equip) => equip.distance ?? 0),
    );
    bonus = Math.max(0, Math.min(3, Math.floor((supportMax - baseRadius) / 2)));
  }

  return {
    baseRadius,
    bonus,
    finalRadius: baseRadius + bonus,
  };
}

export function SimulatorAirBaseCard(props: { index: number }): JSX.Element {
  const $airbaseState = useStore(simulatorAirbaseState);
  const viewBase = createMemo(
    () => $airbaseState()[props.index] ?? null,
    undefined,
    { equals: airBaseSlotEqual },
  );
  const baseRadiusInfo = createMemo(() => {
    const base = viewBase();
    if (!base) return { baseRadius: 0, bonus: 0, finalRadius: 0 };
    return computeAirbaseActionRadius(base);
  });
  const hasSortieAircraft = createMemo(() => baseRadiusInfo().baseRadius > 0);

  return (
    <div class="border border-base-200 rounded-lg overflow-hidden">
      <div class="px-3 py-1.5 bg-base-200/30 border-b border-base-200/50 flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-base-content/40">
          第{props.index + 1}基地
        </span>
        <span
          class="text-[10px] font-mono text-base-content/50"
          title={
            !hasSortieAircraft()
              ? "出撃可能な航空機が未配備"
              : baseRadiusInfo().bonus > 0
                ? `行動半径 ${baseRadiusInfo().baseRadius} + 大型飛行艇補正 ${baseRadiusInfo().bonus}`
                : undefined
          }
        >
          {hasSortieAircraft() ? baseRadiusInfo().finalRadius : "-"}
          {hasSortieAircraft() && baseRadiusInfo().bonus > 0
            ? ` (+${baseRadiusInfo().bonus})`
            : ""}
        </span>
      </div>
      <div class="divide-y divide-base-200/50">
        <Index each={AIRBASE_EQUIP_SLOT_INDEXES}>
          {(slotIdx) => {
            const i = slotIdx();
            const equip = createMemo(() => {
              const base = viewBase();
              if (!base) return null;
              const equipId = base.equipIds[i];
              return equipId != null ? getMasterSlotItem(equipId) : null;
            });
            const equipIconNum = createMemo(() => equip()?.type?.[3] ?? 0);
            const equipDistance = createMemo(() => equip()?.distance ?? null);
            const canShowProf = createMemo(() => {
              const eq = equip();
              const eqType2 = eq?.type?.[2] ?? 0;
              return Boolean(eq && AIRCRAFT_TYPES.has(eqType2));
            });
            const prof = () => viewBase()?.equipProficiency[i] ?? 0;
            const imp = () => viewBase()?.equipImprovement[i] ?? 0;
            const [rowHovered, setRowHovered] = createSignal(false);

            return (
              <EquipSlotRow
                indexText={String(i + 1)}
                iconNum={equipIconNum()}
                equipName={equip()?.name}
                emptyLabel="未配備"
                title={
                  equip()
                    ? `${equip()?.name} (クリックして航空機を変更)`
                    : "空き中隊 (クリックして航空機を配備)"
                }
                onHoverChange={setRowHovered}
                onClick={() => {
                  const current =
                    getLiveAirBase(props.index).equipIds[i] ?? null;
                  if (isReadOnly() && current == null) return;
                  setEquipModalTargetForAirBase(props.index, i);
                  openEquipModal(current, (selection) => {
                    applyAirBaseEquipSelectionAt(props.index, i, selection);
                  });
                }}
              >
                <EquipSlotControls
                  distance={equipDistance()}
                  canShowProf={canShowProf()}
                  profLevel={prof()}
                  onCycleProf={() =>
                    cycleAirBaseEquipProficiency(
                      getLiveAirBase(props.index),
                      i,
                    )
                  }
                  hasEquip={equip() != null}
                  impLevel={imp()}
                  onCycleImp={() =>
                    cycleAirBaseEquipImprovement(getLiveAirBase(props.index), i)
                  }
                  canDelete={equip() != null && !isReadOnly()}
                  deleteTitle="この基地航空隊の装備を外す"
                  onDelete={() =>
                    setAirBaseEquip(getLiveAirBase(props.index), i, null)
                  }
                  rowHovered={rowHovered()}
                  cardHovered={false}
                />
              </EquipSlotRow>
            );
          }}
        </Index>
      </div>
    </div>
  );
}
