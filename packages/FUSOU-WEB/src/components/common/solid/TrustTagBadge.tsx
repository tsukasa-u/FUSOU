/** @jsxImportSource solid-js */

type TrustTag = "hw_verified" | "sw_verified" | "unverified" | "suspicious";

const TAG_CONFIG: Record<TrustTag, { label: string; className: string }> = {
  hw_verified: { label: "HW検証済", className: "badge-success" },
  sw_verified: { label: "SW検証済", className: "badge-info" },
  unverified: { label: "未検証", className: "badge-ghost" },
  suspicious: { label: "要注意", className: "badge-error" },
};

function normalizeTag(value: string | null | undefined): TrustTag {
  if (
    value === "hw_verified" ||
    value === "sw_verified" ||
    value === "suspicious" ||
    value === "unverified"
  ) {
    return value;
  }
  return "unverified";
}

export default function TrustTagBadge(props: {
  tag: string | null | undefined;
  small?: boolean;
}) {
  const tag = normalizeTag(props.tag);
  const config = TAG_CONFIG[tag];
  return (
    <span
      class={`badge ${props.small ? "badge-sm" : ""} ${config.className}`}
      title={`信頼度: ${tag}`}
    >
      {config.label}
    </span>
  );
}
