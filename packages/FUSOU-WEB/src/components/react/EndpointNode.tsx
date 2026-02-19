/** @jsxImportSource react */
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface EndpointField {
  name: string;
  type: string;
  /** Feature variant diff status */
  diffStatus?: "added" | "removed" | "changed" | null;
  diffDetail?: {
    feature: string;
    withFeature: string | null;
    withoutFeature: string | null;
  };
}

export interface EndpointNodeData {
  structName: string;
  fields: EndpointField[];
  isReq: boolean;
  isRes: boolean;
  isDataType: boolean;
  /** Feature variant diff status for the struct */
  diffStatus?: "added" | "removed" | "changed" | null;
  /** ノード選択時の関係タイプ */
  relationType?: "selected" | "ancestor" | "descendant" | null;
  /** 関係の深さ (1=直接, 2=孫, ...) */
  relationDepth?: number;
}

function EndpointNode({ data, id }: NodeProps) {
  const d = data as unknown as EndpointNodeData;

  const headerBg = d.isReq
    ? "bg-info"
    : d.isRes
      ? "bg-success"
      : "bg-neutral";

  const headerText = d.isReq
    ? "text-info-content"
    : d.isRes
      ? "text-success-content"
      : "text-neutral-content";

  const headerIcon = d.isReq ? (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  ) : d.isRes ? (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  );

  // relation ハイライト
  const hasDiffFields = d.fields.some((f) => f.diffStatus);

  const relationBorder =
    d.relationType === "selected"
      ? "border-2 border-primary ring-2 ring-primary/30"
      : d.relationType === "ancestor"
        ? "border-2 border-warning"
        : d.relationType === "descendant"
          ? "border-2 border-success"
          : hasDiffFields
            ? "border-2 border-accent"
            : "border border-base-300";

  const opacity =
    typeof d.relationType !== "undefined" && d.relationType === null
      ? "opacity-30"
      : "";

  return (
    <div className={`bg-base-100 rounded-lg shadow-md ${relationBorder} ${opacity} min-w-[200px] max-w-[320px] text-xs transition-opacity`}>
      <Handle type="target" position={Position.Left} id={`${id}-${d.structName}`} className="!bg-primary !w-2 !h-2" />

      <div className={`${headerBg} ${headerText} px-3 py-1.5 rounded-t-md font-bold text-sm flex items-center gap-2`}>
        {headerIcon}
        <span className="truncate">{d.structName}</span>
        {d.relationType === "selected" && (
          <span className="badge badge-xs badge-primary ml-auto">選択中</span>
        )}
        {!d.relationType && d.isReq && (
          <span className="badge badge-xs badge-outline ml-auto">Request</span>
        )}
        {!d.relationType && d.isRes && (
          <span className="badge badge-xs badge-outline ml-auto">Response</span>
        )}
      </div>

      <div className="divide-y divide-base-200">
        {d.fields.map((field) => {
          const diffBg =
            field.diffStatus === "added"
              ? "bg-success/15"
              : field.diffStatus === "removed"
                ? "bg-error/15"
                : field.diffStatus === "changed"
                  ? "bg-warning/15"
                  : "";
          const diffTitle = field.diffDetail
            ? `[${field.diffDetail.feature}] ${field.diffDetail.withoutFeature ?? "(none)"} → ${field.diffDetail.withFeature ?? "(none)"}`
            : undefined;
          return (
          <div
            key={field.name}
            className={`px-3 py-1 flex items-center gap-2 ${diffBg}`}
            style={{ position: "relative" }}
            title={diffTitle}
          >
            <span className={`font-mono ${field.diffStatus === "removed" ? "line-through text-base-content/40" : ""}`}>
              {field.name}
            </span>
            {field.diffStatus && (
              <span className={`badge badge-xs ${
                field.diffStatus === "added" ? "badge-success" :
                field.diffStatus === "removed" ? "badge-error" :
                "badge-warning"
              }`}>
                {field.diffStatus === "added" ? "+" : field.diffStatus === "removed" ? "-" : "~"}
              </span>
            )}
            <span className={`ml-auto font-mono truncate max-w-[150px] ${field.diffStatus === "removed" ? "line-through text-base-content/30" : "text-base-content/50"}`} title={field.type}>
              {field.type}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={`${id}-${field.name}`}
              className="!bg-secondary !w-1.5 !h-1.5"
              style={{ top: "50%", transform: "translateY(-50%)" }}
            />
          </div>
          );
        })}
        {d.fields.length === 0 && (
          <div className="px-3 py-2 text-base-content/40 italic">
            (fields not expanded)
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(EndpointNode);
