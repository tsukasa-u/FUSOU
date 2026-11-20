/** @jsxImportSource solid-js */

import {
  Index,
  createMemo,
  type JSX,
} from "solid-js";
import { useStore } from "@nanostores/solid";
import { SimulatorShipCard } from "@/components/features/simulator/solid/SimulatorShipCard";
import { SimulatorAirBaseCard } from "@/components/features/simulator/solid/SimulatorAirBaseCard";
import {
  markSimulatorStateDirty,
  simulatorDisplayRevision,
  type SimulatorDirtyScope,
} from "@/features/simulator/state";
import { getVisibleAirbaseCount } from "@/features/simulator/simulator-selectors";

const FLEET_SLOT_INDEXES = [0, 1, 2, 3, 4, 5] as const;
const STRIKE_FLEET_SLOT_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;
const AIRBASE_INDEXES = [0, 1, 2] as const;

export function FleetSlotsView(props: { fleetIndex: 1 | 2 | 3 | 4 }): JSX.Element {
  // Each SimulatorShipCard subscribes to simulatorFleetState independently via useStore.
  // 第3艦隊は遊撃艦隊として最大7隻編成に対応
  const indexes = () => (props.fleetIndex === 3 ? STRIKE_FLEET_SLOT_INDEXES : FLEET_SLOT_INDEXES);
  return (
    <Index each={indexes()}>
      {(idx) => <SimulatorShipCard fleetIndex={props.fleetIndex} idx={idx()} />}
    </Index>
  );
}

export function AirBaseView(): JSX.Element {
  const displayRev = useStore(simulatorDisplayRevision);
  const count = createMemo(() => { displayRev(); return getVisibleAirbaseCount(); });
  return (
    <Index each={AIRBASE_INDEXES.slice(0, count())}>
      {(i) => <SimulatorAirBaseCard index={i()} />}
    </Index>
  );
}

export function ensureSolidSimulatorMounted(): void {
  // Now handled declaratively by SimulatorFleetTab.tsx
}

export function rerenderSolidSimulator(
  scope: SimulatorDirtyScope = "all",
): void {
  ensureSolidSimulatorMounted();
  markSimulatorStateDirty(scope);
}
