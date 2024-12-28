
export interface AirBases {
    bases:  { [key: number]: AirBase }
}

export interface AirBase {
    area_id: number;
    rid: number;
    action_kind: number;
    name: string;
    distance: number;
    plane_info: PlaneInfo[];
}

export interface PlaneInfo {
    cond: number | null;
    state: number;
    max_count: number | null;
    count: number | null;
    slotid: number;
    squadron_id: number;
}

export var global_air_bases: AirBases = {
    bases: {}
};