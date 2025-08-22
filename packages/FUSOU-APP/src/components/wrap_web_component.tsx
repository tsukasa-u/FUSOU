import { Battle } from "@ipc-bindings/battle";
import { DataSetParamShip, DataSetShip } from "src/utility/get_data_set";
import {
  calc_critical,
  get_mst_slot_item,
  type DeckShipIds,
} from "../utility/battles";

interface NumberedOwnShipProps {
  ship_idx: number;
  combined_flag: boolean;
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
}

export function WrapNumberedOwnShipComponent(props: NumberedOwnShipProps) {
  let ship_id =
    props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][props.ship_idx];
  return (
    <>
      <icon-fleet-number
        size="xs"
        e_flag={0}
        fleet_number={props.battle_selected()?.deck_id ?? 1}
        ship_number={props.ship_idx + 1}
        combined_flag={props.combined_flag}
      />
      <component-ship-modal
        size="xs"
        color=""
        empty_flag={false}
        name_flag={true}
        ship={props.store_data_set_deck_ship()[ship_id]?.ship}
        mst_ship={props.store_data_set_deck_ship()[ship_id]?.mst_ship}
        slot_items={props.store_data_set_deck_ship()[ship_id]?.slot_items}
        mst_slot_items={
          props.store_data_set_deck_ship()[ship_id]?.mst_slot_items
        }
      />
    </>
  );
}

interface NumberedEnemyShipProps {
  ship_idx: number;
  combined_flag: boolean;
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function WrapNumberedEnemyShipComponent(props: NumberedEnemyShipProps) {
  return (
    <>
      <icon-fleet-number
        size="xs"
        e_flag={1}
        fleet_number={1}
        ship_number={props.ship_idx + 1}
        combined_flag={props.battle_selected()?.enemy_ship_id?.length == 12}
      />
      <component-ship-masked-modal
        size="xs"
        ship_max_hp={
          props.store_data_set_param_ship().e_ship_max_hp[props.ship_idx]
        }
        ship_param={
          props.store_data_set_param_ship().e_ship_param[props.ship_idx]
        }
        ship_slot={
          props.store_data_set_param_ship().e_ship_slot[props.ship_idx]
        }
        mst_ship={props.store_data_set_param_ship().e_mst_ship[props.ship_idx]}
        mst_slot_items={
          props.store_data_set_param_ship().e_mst_slot_items[props.ship_idx]
        }
        color={props.store_data_set_param_ship().e_color[props.ship_idx]}
        empty_flag={false}
        name_flag={true}
      />
    </>
  );
}

interface WrapCIMstEquipmentProps {
  si: number;
  show_param: boolean;
}

export function WrapCIMstEquipComponent(props: WrapCIMstEquipmentProps) {
  return (
    <component-equipment-mst-modal
      size="xs"
      compact={true}
      empty_flag={false}
      name_flag={false}
      show_name={true}
      show_param={props.show_param}
      mst_slot_item={get_mst_slot_item(props.si)}
    />
  );
}

interface WrapCIMstEquipmentProps {
  si: number;
  show_param: boolean;
}
export function WrapOwnPlaneEquipComponent(props: WrapCIMstEquipmentProps) {
  return (
    <component-equipment-mst-modal
      size="xs"
      compact={false}
      empty_flag={false}
      name_flag={true}
      show_name={true}
      show_param={true}
      mst_slot_item={get_mst_slot_item(props.si)}
    />
  );
}
