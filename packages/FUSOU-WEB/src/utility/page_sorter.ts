const segmentOrder: Record<string, number> = {
  start: 0x10,
  guide: 0x20,
  reference: 0x30,
  quick_start: 0x11,
};

export const compareSegments = (a: any, b: any) => {
  const aOrder = segmentOrder[a.segment] ?? 0xff;
  const bOrder = segmentOrder[b.segment] ?? 0xff;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.segment.localeCompare(b.segment);
};
