// ── Fleet Rendering (Solid wrapper) ──

import type { FleetSlot } from "./types";
import { rerenderSolidSimulator } from "@/components/features/simulator/solid/simulator-renderer";

export function renderFleetSlots(_containerId: string, _fleet: FleetSlot[]): void {
  rerenderSolidSimulator("fleet");
}
