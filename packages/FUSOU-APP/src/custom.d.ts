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

interface css_style_props {
  css?: string;
  style?: string;
}

declare module "solid-js" {
  namespace JSX {
    // eslint-disable-next-line no-unused-vars
    interface IntrinsicElements {
      "component-color-bar": ComponentColorBarProps & JSX.CustomAttributes;
      "component-color-bar-label": ComponentColorBarLabelProps &
        JSX.CustomAttributes;
      "component-equipment": ComponentEquipmentProps & JSX.CustomAttributes;
      "component-equipment-modal": ComponentEquipmentModalProps &
        JSX.CustomAttributes;
      "component-equipment-table": ComponentEquipmentTableProps &
        JSX.CustomAttributes;
      "component-equipment-mst": ComponentEquipmentMstProps &
        JSX.CustomAttributes;
      "component-equipment-mst-modal": ComponentEquipmentMstModalProps &
        JSX.CustomAttributes;
      "component-equipment-mst-table": ComponentEquipmentMstTableProps &
        JSX.CustomAttributes;
      "component-ship-masked-modal": ComponentShipMaskedModalProps &
        JSX.CustomAttributes;
      "component-ship-masked-table": ComponentShipMaskedTableProps &
        JSX.CustomAttributes;
      "component-ship": ComponentShipProps & JSX.CustomAttributes;
      "component-ship-modal": ComponentShipModalProps & css_style_props;
      "component-ship-table": ComponentShipTableProps & JSX.CustomAttributes;
      "icon-caution-fill": IconCautionFillProps & JSX.CustomAttributes;
      "icon-equipment": IconEquipmentProps & JSX.CustomAttributes;
      "icon-fleet-number": IconFleetNumberProps & JSX.CustomAttributes;
      "icon-kira": IconKiraProps & JSX.CustomAttributes;
      "icon-material": IconMaterialProps & JSX.CustomAttributes;
      "icon-plane-proficiency": IconPlaneProficiencyProps &
        JSX.CustomAttributes;
      "icon-ship": IconShipProps & JSX.CustomAttributes;
    }
  }
}
