// ── Equipment Selection Modal Logic ──

import { beginEquipModalSession, setEquipModalSideFilter } from "./simulator-mutations";
import { ENEMY_ID_THRESHOLD } from "./constants";
import { setEquipModalTrigger } from "@/components/features/simulator/solid/EquipSelectionModal";

export function openEquipModal(
  currentId: number | null,
  cb: (selection: { id: number | null; level?: number; alv?: number }) => void,
) {
  beginEquipModalSession(currentId, cb);
  if (currentId != null) {
    setEquipModalSideFilter(currentId >= ENEMY_ID_THRESHOLD ? "enemy" : "ally");
  }
  // Trigger the SolidJS reactive effect to show the modal
  setEquipModalTrigger((value) => value + 1);
}

export function initEquipModalEvents() {
  // Legacy function: now handled purely inside EquipSelectionModal.tsx.
}

export function handleResizeEquip() {
  // Legacy function
}
