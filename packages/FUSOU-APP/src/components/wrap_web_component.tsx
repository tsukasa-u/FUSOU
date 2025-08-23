import { Battle } from "@ipc-bindings/battle";
import { DataSetParamShip, DataSetShip } from "src/utility/get_data_set";
import { get_mst_slot_item, type DeckShipIds } from "../utility/battles";
import "shared-ui";
import { useDeckPorts } from "../utility/provider";

interface NumberedOwnShipProps {
  ship_idx: number;
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
}

export function WrapNumberedOwnShipComponent(props: NumberedOwnShipProps) {
  let ship_id =
    props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][props.ship_idx];
  const [deck_ports] = useDeckPorts();
  return (
    <>
      <icon-fleet-number
        size="xs"
        e_flag={0}
        fleet_number={props.battle_selected()?.deck_id ?? 1}
        ship_number={props.ship_idx + 1}
        combined_flag={deck_ports.combined_flag == 1}
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
  e_flag: boolean;
}

export function WrapCIMstEquipComponent(props: WrapCIMstEquipmentProps) {
  return (
    <component-equipment-mst-modal
      size="xs"
      compact={true}
      empty_flag={false}
      name_flag={false}
      show_name={true}
      show_param={props.e_flag}
      mst_slot_item={get_mst_slot_item(props.si)}
    />
  );
}

interface WrapCIMstEquipmentProps {
  si: number;
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

interface WrapOwnShipHPPropsType2 {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  idx_index: () => number;
  idx: number;
  f_now_hps: number[][] | undefined;
}
interface WrapOwnShipHPPropsType1 {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  idx: number;
  f_now_hps: number[] | undefined;
}
export function WrapOwnShipHPComponent(
  props: WrapOwnShipHPPropsType1 | WrapOwnShipHPPropsType2
) {
  if ("idx_index" in props) {
    let ship_id =
      props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][props.idx];
    let v_now = props.f_now_hps?.[props.idx_index()]?.[props.idx];
    let v_max = props.store_data_set_deck_ship()[ship_id]?.ship?.maxhp;
    return (
      <component-color-bar-label
        size="xs"
        v_max={v_max ?? 0}
        v_now={v_now ?? 0}
      />
    );
  } else {
    let ship_id =
      props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][props.idx];
    let v_now = props.f_now_hps?.[props.idx];
    let v_max = props.store_data_set_deck_ship()[ship_id]?.ship?.maxhp;
    return (
      <component-color-bar-label
        size="xs"
        v_max={v_max ?? 0}
        v_now={v_now ?? 0}
      />
    );
  }
}

interface WrapEnemyShipHPPropsType2 {
  store_data_set_param_ship: () => DataSetParamShip;
  idx_index: () => number;
  idx: number;
  e_now_hps: number[][] | undefined;
}
interface WrapEnemyShipHPPropsType1 {
  store_data_set_param_ship: () => DataSetParamShip;
  idx: number;
  e_now_hps: number[] | undefined;
}

export function WrapEnemyShipHPComponent(
  props: WrapEnemyShipHPPropsType1 | WrapEnemyShipHPPropsType2
) {
  if ("idx_index" in props) {
    let v_now = props.e_now_hps?.[props.idx_index()]?.[props.idx];
    let v_max = props.store_data_set_param_ship().e_ship_max_hp[props.idx];
    return (
      <component-color-bar-label
        size="xs"
        v_max={v_max ?? 0}
        v_now={v_now ?? 0}
      />
    );
  } else {
    let v_now = props.e_now_hps?.[props.idx];
    let v_max = props.store_data_set_param_ship().e_ship_max_hp[props.idx];
    return (
      <component-color-bar-label
        size="xs"
        v_max={v_max ?? 0}
        v_now={v_now ?? 0}
      />
    );
  }
}
