export function compareFieldEntries(a, b) {
  const nameCmp = String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
  if (nameCmp !== 0) return nameCmp;

  const typeCmp = String(a?.type ?? "").localeCompare(String(b?.type ?? ""));
  if (typeCmp !== 0) return typeCmp;

  const diffCmp = String(a?.diffStatus ?? "").localeCompare(
    String(b?.diffStatus ?? ""),
  );
  if (diffCmp !== 0) return diffCmp;

  return 0;
}

export function sortNodeFieldsInPlace(nodes) {
  for (const node of nodes ?? []) {
    const fields = node?.data?.fields;
    if (Array.isArray(fields)) {
      fields.sort(compareFieldEntries);
    }
  }
}

function stableSortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSortObjectKeys(item));
  }

  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSortObjectKeys(value[key]);
    }
    return sorted;
  }

  return value;
}

export function stableStringify(value, indent = 2) {
  return JSON.stringify(stableSortObjectKeys(value), null, indent);
}
