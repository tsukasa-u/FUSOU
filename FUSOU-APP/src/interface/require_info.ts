export interface SlotItems {
    slot_items: { [key: number]: SlotItem }
}

export interface SlotItem {
    id: number
    slotitem_id: number
    locked: number
    level: number
    alv?: number
}

export var global_slotitems: SlotItems = {
    slot_items: {}
};