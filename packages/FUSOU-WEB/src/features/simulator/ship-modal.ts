// ── Ship Selection Modal Logic ──

import { beginShipModalSession, setShipModalSideFilter } from "./simulator-mutations";
import { ENEMY_ID_THRESHOLD } from "./constants";
import { setShipModalTrigger } from "@/components/features/simulator/solid/ShipSelectionModal";

/** Open the ship selection modal (now handled by SolidJS TSX) */
export function openShipModal(
  currentId: number | null,
  cb: (selection: { id: number | null; level?: number | null }) => void,
) {
  beginShipModalSession(currentId, cb);
  if (currentId != null) {
    setShipModalSideFilter(currentId >= ENEMY_ID_THRESHOLD ? "enemy" : "ally");
  }
  // Trigger the SolidJS reactive effect to show the modal
  setShipModalTrigger((value) => value + 1);
}

/** Wire up DOM event listeners for the ship modal. Call once at init time. */
export function initShipModalEvents() {
  // Legacy function: now handled purely inside ShipSelectionModal.tsx.
}

/** Invalidate ship virtual scroll on resize. */
export function handleResizeShip() {
  // Legacy function
}
