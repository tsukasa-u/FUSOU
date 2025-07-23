import type { JSX } from "solid-js";
import type {
  ComponentShipProps,
  ComponentShipModalProps,
  ComponentShipTableProps,
} from "shared-ui";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "component-ship": ComponentShipProps;
      "component-ship-modal": ComponentShipModalProps;
      "component-ship-table": ComponentShipTableProps;
    }
  }
}
