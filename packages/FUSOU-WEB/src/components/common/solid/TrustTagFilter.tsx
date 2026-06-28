/** @jsxImportSource solid-js */

export type TrustFilterValue =
  | "all"
  | "hw_verified"
  | "sw_or_hw"
  | "no_suspicious";

export function matchesTrustFilter(
  trustTag: string | null | undefined,
  filter: TrustFilterValue,
): boolean {
  const tag = trustTag ?? "unverified";
  switch (filter) {
    case "all":
      return true;
    case "hw_verified":
      return tag === "hw_verified";
    case "sw_or_hw":
      return tag === "hw_verified" || tag === "sw_verified";
    case "no_suspicious":
      return tag !== "suspicious";
    default:
      return true;
  }
}

export default function TrustTagFilter(props: {
  value: TrustFilterValue;
  onChange: (value: TrustFilterValue) => void;
}) {
  return (
    <select
      class="select select-sm select-bordered"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value as TrustFilterValue)}
    >
      <option value="all">全データ</option>
      <option value="no_suspicious">要注意を除外</option>
      <option value="sw_or_hw">SW/HW検証済みのみ</option>
      <option value="hw_verified">HW検証済みのみ</option>
    </select>
  );
}
