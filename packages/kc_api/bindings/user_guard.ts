import type { BattleType } from "./battle";

export type AirBaseAssult = { AirBaseAssult: null };
export type CarrierBaseAssault = { CarrierBaseAssault: null };
export type AirBaseAirAttack = { AirBaseAirAttack: null };
export type OpeningAirAttack = { OpeningAirAttack: number };
export type SupportAttack = { SupportAttack: null };
export type OpeningTaisen = { OpeningTaisen: null };
export type OpeningRaigeki = { OpeningRaigeki: null };
export type Hougeki = { Hougeki: number };
export type ClosingRaigeki = { ClosingRaigeki: null };
export type FriendlyForceAttack = { FriendlyForceAttack: null };
export type MidnightHougeki = { MidnightHougeki: null };

export function implementsAirBaseAssult(arg: BattleType): arg is AirBaseAssult {
  return typeof arg === "object" && arg !== null && "AirBaseAssult" in arg;
}

export function implementsCarrierBaseAssault(
  arg: BattleType
): arg is CarrierBaseAssault {
  return typeof arg === "object" && arg !== null && "CarrierBaseAssault" in arg;
}

export function implementsAirBaseAirAttack(
  arg: BattleType
): arg is AirBaseAirAttack {
  return typeof arg === "object" && arg !== null && "AirBaseAirAttack" in arg;
}

export function implementsOpeningAirAttack(
  arg: BattleType
): arg is OpeningAirAttack {
  return typeof arg === "object" && arg !== null && "OpeningAirAttack" in arg;
}

export function implementsSupportAttack(arg: BattleType): arg is SupportAttack {
  return typeof arg === "object" && arg !== null && "SupportAttack" in arg;
}

export function implementsOpeningTaisen(arg: BattleType): arg is OpeningTaisen {
  return typeof arg === "object" && arg !== null && "OpeningTaisen" in arg;
}

export function implementsOpeningRaigeki(
  arg: BattleType
): arg is OpeningRaigeki {
  return typeof arg === "object" && arg !== null && "OpeningRaigeki" in arg;
}

export function implementsHougeki(arg: BattleType): arg is Hougeki {
  return typeof arg === "object" && arg !== null && "Hougeki" in arg;
}

export function implementsClosingRaigeki(
  arg: BattleType
): arg is ClosingRaigeki {
  return typeof arg === "object" && arg !== null && "ClosingRaigeki" in arg;
}

export function implementsFriendlyForceAttack(
  arg: BattleType
): arg is FriendlyForceAttack {
  return (
    typeof arg === "object" && arg !== null && "FriendlyForceAttack" in arg
  );
}

export function implementsMidnightHougeki(
  arg: BattleType
): arg is MidnightHougeki {
  return typeof arg === "object" && arg !== null && "MidnightHougeki" in arg;
}
