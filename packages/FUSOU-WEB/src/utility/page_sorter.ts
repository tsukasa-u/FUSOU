const segmentOrder: Record<string, number> = {
  start: 0x10,
  guide: 0x20,
  formulas: 0x25,
  policy: 0x30,
  license: 0x40,
  quick_start: 0x11,
  overview: 0x00,
  shelling: 0x01,
  night_battle: 0x02,
  aerial_combat: 0x03,
  accuracy_evasion: 0x04,
  support_lbas: 0x05,
  improvement_fit: 0x06,
  others: 0x07,
};

export const compareSegments = (a: any, b: any) => {
  const aOrder = segmentOrder[a.segment] ?? 0xff;
  const bOrder = segmentOrder[b.segment] ?? 0xff;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.segment.localeCompare(b.segment);
};
