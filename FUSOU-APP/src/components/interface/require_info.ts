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
    slot_items: {
        1: { id: 1, slotitem_id: 1, locked: 0, level: 0 },
        2: { id: 2, slotitem_id: 2, locked: 0, level: 0 },
        3: { id: 3, slotitem_id: 3, locked: 0, level: 0 },
        4: { id: 4, slotitem_id: 4, locked: 0, level: 0 }
    }
};