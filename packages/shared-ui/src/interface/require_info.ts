export interface SlotItems {
  slot_items: { [key: number]: SlotItem };
}

export interface SlotItem {
  id: number;
  slotitem_id: number;
  locked: number;
  level: number;
  alv?: number;
}

export const default_slotitems: SlotItems = {
  slot_items: {},
};

export const default_slotitem: SlotItem = {
  id: 0,
  slotitem_id: 0,
  locked: 0,
  level: 0,
  alv: undefined,
};
