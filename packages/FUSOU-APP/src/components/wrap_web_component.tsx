import { Battle } from "@ipc-bindings/battle";
import { DataSetParamShip, DataSetShip } from "src/utility/get_data_set";
import {
  get_mst_slot_item,
  get_slot_item,
  type DeckShipIds,
} from "../utility/battles";
import "shared-ui";
import { useDeckPorts } from "../utility/provider";

const friendly_force_number = 5;

interface OwnShipProps {
  ship_idx: number;
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  name_flag: boolean;
}

export function WrapOwnShipComponent(props: OwnShipProps) {
  let ship_id =
    props.deck_ship_id()[props.battle_selected()?.deck_id ?? 1][props.ship_idx];
  return (
    <>
      <component-ship-modal
        size="xs"
        color=""
        empty_flag={false}
        name_flag={props.name_flag}
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

interface EnemyShipProps {
  ship_idx: number;
  store_data_set_param_ship: () => DataSetParamShip;
  name_flag: boolean;
}

export function WrapEnemyShipComponent(props: EnemyShipProps) {
  return (
    <>
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
        name_flag={props.name_flag}
      />
    </>
  );
}

interface FriendShipProps {
  ship_idx: number;
  store_data_set_param_ship: () => DataSetParamShip;
  name_flag: boolean;
}

export function WrapFriendShipComponent(props: FriendShipProps) {
  return (
    <>
      <component-ship-masked-modal
        size="xs"
        ship_max_hp={
          props.store_data_set_param_ship().f_friend_ship_max_hp[props.ship_idx]
        }
        ship_param={
          props.store_data_set_param_ship().f_friend_ship_param[props.ship_idx]
        }
        ship_slot={
          props.store_data_set_param_ship().f_friend_ship_slot[props.ship_idx]
        }
        mst_ship={
          props.store_data_set_param_ship().f_friend_mst_ship[props.ship_idx]
        }
        mst_slot_items={
          props.store_data_set_param_ship().f_friend_mst_slot_items[
            props.ship_idx
          ]
        }
        color={props.store_data_set_param_ship().f_friend_color[props.ship_idx]}
        empty_flag={false}
        name_flag={props.name_flag}
      />
    </>
  );
}

interface NumberedOwnShipProps {
  ship_idx: number;
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
}

export function WrapNumberedOwnShipComponent(props: NumberedOwnShipProps) {
  const deck_id = props.battle_selected()?.deck_id;
  if (deck_id) {
    let ship_id = props.deck_ship_id()[deck_id][props.ship_idx];
    const [deck_ports] = useDeckPorts();
    return (
      <>
        <icon-fleet-number
          size="xs"
          e_flag={0}
          fleet_number={deck_id}
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
  } else {
    return (
      <>
        <icon-fleet-number
          size="xs"
          e_flag={0}
          fleet_number={0}
          ship_number={0}
          combined_flag={false}
        />
        <component-ship-modal
          size="xs"
          color=""
          empty_flag={false}
          name_flag={true}
          ship={undefined}
          mst_ship={undefined}
          slot_items={undefined}
          mst_slot_items={undefined}
        />
      </>
    );
  }
}

interface NumberedSupportShipProps {
  ship_idx: number;
  deck_ship_id: () => DeckShipIds;
  support_deck_id: number | undefined;
  store_data_set_deck_ship: () => DataSetShip;
}

export function WrapNumberedSupportShipComponent(
  props: NumberedSupportShipProps
) {
  const support_deck_id = props.support_deck_id;
  if (support_deck_id) {
    let ship_id = props.deck_ship_id()[support_deck_id][props.ship_idx];
    return (
      <>
        <icon-fleet-number
          size="xs"
          e_flag={0}
          fleet_number={support_deck_id}
          ship_number={props.ship_idx + 1}
          combined_flag={false}
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
  } else {
    return (
      <>
        <icon-fleet-number
          size="xs"
          e_flag={0}
          fleet_number={0}
          ship_number={0}
          combined_flag={false}
        />
        <component-ship-modal
          size="xs"
          color=""
          empty_flag={false}
          name_flag={true}
          ship={undefined}
          mst_ship={undefined}
          slot_items={undefined}
          mst_slot_items={undefined}
        />
      </>
    );
  }
}

interface NumberedEnemyShipProps {
  ship_idx: number;
  battle_selected: () => Battle | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
  combined_flag?: boolean;
}

export function WrapNumberedEnemyShipComponent(props: NumberedEnemyShipProps) {
  return (
    <>
      <icon-fleet-number
        size="xs"
        e_flag={1}
        fleet_number={1}
        ship_number={props.ship_idx + 1}
        combined_flag={
          props.combined_flag
            ? props.combined_flag
            : props.battle_selected()?.enemy_ship_id?.length == 12
        }
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

interface NumberedFrienShipProps {
  ship_idx: number;
  battle_selected: () => Battle | undefined;
  store_data_set_param_ship: () => DataSetParamShip;
}

export function WrapNumberedFriendShipComponent(props: NumberedFrienShipProps) {
  return (
    <>
      <icon-fleet-number
        size="xs"
        e_flag={0}
        fleet_number={friendly_force_number}
        ship_number={props.ship_idx + 1}
        combined_flag={false}
      />
      <component-ship-masked-modal
        size="xs"
        ship_max_hp={
          props.store_data_set_param_ship().f_friend_ship_max_hp[props.ship_idx]
        }
        ship_param={
          props.store_data_set_param_ship().f_friend_ship_param[props.ship_idx]
        }
        ship_slot={
          props.store_data_set_param_ship().f_friend_ship_slot[props.ship_idx]
        }
        mst_ship={
          props.store_data_set_param_ship().f_friend_mst_ship[props.ship_idx]
        }
        mst_slot_items={
          props.store_data_set_param_ship().f_friend_mst_slot_items[
            props.ship_idx
          ]
        }
        color={props.store_data_set_param_ship().f_friend_color[props.ship_idx]}
        empty_flag={false}
        name_flag={true}
      />
    </>
  );
}

export function WrapNumberedErrorShipComponent() {
  return (
    <>
      <icon-fleet-number
        size="xs"
        e_flag={0}
        fleet_number={0}
        ship_number={0}
        combined_flag={false}
      />
      <component-ship-masked-modal
        size="xs"
        ship_max_hp={0}
        ship_param={[0, 0, 0, 0]}
        ship_slot={[0, 0, 0, 0]}
        mst_ship={undefined}
        mst_slot_items={undefined}
        color=""
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
      show_param={!props.e_flag}
      mst_slot_item={get_mst_slot_item(props.si)}
    />
  );
}

interface WrapOwnPlaneEquipmentProps {
  si: number;
}
export function WrapOwnPlaneEquipComponent(props: WrapOwnPlaneEquipmentProps) {
  return (
    <component-equipment-mst-modal
      size="xs"
      compact={false}
      empty_flag={false}
      name_flag={true}
      show_name={true}
      show_param={true}
      mst_slot_item={get_slot_item(props.si)}
    />
  );
}

interface WrapOwnShipHPProps {
  deck_ship_id: () => DeckShipIds;
  battle_selected: () => Battle | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  idx: number;
  f_now_hps: number[] | undefined;
}
export function WrapOwnShipHPComponent(props: WrapOwnShipHPProps) {
  const deck_id = props.battle_selected()?.deck_id;
  if (deck_id) {
    let ship_id = props.deck_ship_id()[deck_id][props.idx];
    let v_now = props.f_now_hps?.[props.idx];
    let v_max = props.store_data_set_deck_ship()[ship_id]?.ship?.maxhp;
    return (
      <component-color-bar-label
        size="xs"
        v_max={v_max ?? 0}
        v_now={v_now ?? 0}
      />
    );
  } else {
    return <component-color-bar-label size="xs" v_max={0} v_now={0} />;
  }
}

interface WrapEnemyShipHPProps {
  store_data_set_param_ship: () => DataSetParamShip;
  idx: number;
  e_now_hps: number[] | undefined;
}

export function WrapEnemyShipHPComponent(props: WrapEnemyShipHPProps) {
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

interface WrapFriendShipHPProps {
  store_data_set_param_ship: () => DataSetParamShip;
  idx: number;
  friend_now_hps: number[] | undefined;
}

export function WrapFriendShipHPComponent(props: WrapFriendShipHPProps) {
  let v_now = props.friend_now_hps?.[props.idx];
  let v_max = props.store_data_set_param_ship().f_friend_ship_max_hp[props.idx];
  return (
    <component-color-bar-label
      size="xs"
      v_max={v_max ?? 0}
      v_now={v_now ?? 0}
    />
  );
}

interface WrapSupportShipHPProps {
  deck_ship_id: () => DeckShipIds;
  support_deck_id: number | undefined;
  store_data_set_deck_ship: () => DataSetShip;
  idx: number;
}

export function WrapSupportShipHPComponent(props: WrapSupportShipHPProps) {
  const support_deck_id = props.support_deck_id;
  if (support_deck_id) {
    let ship_id = props.deck_ship_id()[support_deck_id][props.idx];
    let v_now = props.store_data_set_deck_ship()[ship_id]?.ship?.nowhp;
    let v_max = props.store_data_set_deck_ship()[ship_id]?.ship?.maxhp;
    return (
      <component-color-bar-label
        size="xs"
        v_max={v_max ?? 0}
        v_now={v_now ?? 0}
      />
    );
  } else {
    return <component-color-bar-label size="xs" v_max={0} v_now={0} />;
  }
}

interface WrapBaseHPProps {
  now_hps: number[] | undefined;
  max_hps: number[] | undefined;
  idx: number;
}
export function WrapBaseHPComponent(props: WrapBaseHPProps) {
  return (
    <component-color-bar-label
      size="xs"
      v_max={props.max_hps?.[props.idx] ?? 0}
      v_now={props.now_hps?.[props.idx] ?? 0}
    />
  );
}
