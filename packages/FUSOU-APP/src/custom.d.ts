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
      "component-color-bar": ComponentColorBarProps & css_style_props;
      "component-color-bar-label": ComponentColorBarLabelProps &
        css_style_props;
      "component-equipment": ComponentEquipmentProps & css_style_props;
      "component-equipment-modal": ComponentEquipmentModalProps &
        css_style_props;
      "component-equipment-table": ComponentEquipmentTableProps &
        css_style_props;
      "component-equipment-mst": ComponentEquipmentMstProps & css_style_props;
      "component-equipment-mst-modal": ComponentEquipmentMstModalProps &
        css_style_props;
      "component-equipment-mst-table": ComponentEquipmentMstTableProps &
        css_style_props;
      "component-ship-masked-modal": ComponentShipMaskedModalProps &
        css_style_props;
      "component-ship-masked-table": ComponentShipMaskedTableProps &
        css_style_props;
      "component-ship": ComponentShipProps & css_style_props;
      "component-ship-modal": ComponentShipModalProps & css_style_props;
      "component-ship-table": ComponentShipTableProps & css_style_props;
      "icon-caution-fill": IconCautionFillProps & css_style_props;
      "icon-equipment": IconEquipmentProps & css_style_props;
      "icon-fleet-number": IconFleetNumberProps & css_style_props;
      "icon-kira": IconKiraProps & css_style_props;
      "icon-material": IconMaterialProps & css_style_props;
      "icon-plane-proficiency": IconPlaneProficiencyProps & css_style_props;
      "icon-ship": IconShipProps & css_style_props;
    }
  }
}
