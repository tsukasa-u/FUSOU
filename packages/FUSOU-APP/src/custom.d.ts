// eslint-disable-next-line no-unused-vars
import type { JSX } from "solid-js";
import type {
  ComponentShipProps,
  ComponentShipModalProps,
  ComponentShipTableProps,
  ComponentColorBarProps,
  ComponentColorBarLabelProps,
  ComponentEquipmentProps,
  ComponentEquipmentModalProps,
  ComponentEquipmentTableProps,
  ComponentEquipmentMstProps,
  ComponentEquipmentMstModalProps,
  ComponentEquipmentMstTableProps,
  ComponentShipMaskedModalProps,
  ComponentShipMaskedTableProps,
  IconCautionFillProps,
  IconEquipmentProps,
  IconFleetNumberProps,
  IconKiraProps,
  IconMaterialProps,
  IconPlaneProficiencyProps,
  IconShipProps,
} from "shared-ui";

declare module "solid-js" {
  // eslint-disable-next-line no-unused-vars
  namespace JSX {
    // eslint-disable-next-line no-unused-vars
    interface IntrinsicElements {
      "component-color-bar": ComponentColorBarProps;
      "component-color-bar-label": ComponentColorBarLabelProps;
      "component-equipment": ComponentEquipmentProps;
      "component-equipment-modal": ComponentEquipmentModalProps;
      "component-equipment-table": ComponentEquipmentTableProps;
      "component-equipment-mst": ComponentEquipmentMstProps;
      "component-equipment-mst-modal": ComponentEquipmentMstModalProps;
      "component-equipment-mst-table": ComponentEquipmentMstTableProps;
      "component-ship-masked-modal": ComponentShipMaskedModalProps;
      "component-ship-masked-table": ComponentShipMaskedTableProps;
      "component-ship": ComponentShipProps;
      "component-ship-modal": ComponentShipModalProps;
      "component-ship-table": ComponentShipTableProps;
      "icon-caution-fill": IconCautionFillProps;
      "icon-equipment": IconEquipmentProps;
      "icon-fleet-number": IconFleetNumberProps;
      "icon-kira": IconKiraProps;
      "icon-material": IconMaterialProps;
      "icon-plane-proficiency": IconPlaneProficiencyProps;
      "icon-ship": IconShipProps;
    }
  }
}
