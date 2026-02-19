/** @jsxImportSource react */
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface SchemaField {
  name: string;
  type: string;
  isUuid?: boolean;
  isKey?: boolean;
  isFk?: boolean;
  isEnvRef?: boolean;
  diffStatus?: "added" | "removed" | "changed" | null;
}

export interface SchemaTableNodeData {
  tableName: string;
  recordName: string;
  structName?: string;
  fields: SchemaField[];
  highlighted?: boolean;
  diffStatus?: "added" | "removed" | "changed" | null;
  /** ノード選択時の関係タイプ */
  relationType?: "selected" | "ancestor" | "descendant" | null;
  /** 関係の深さ (1=直接, 2=孫, ...) */
  relationDepth?: number;
}

function SchemaTableNode({ data, id }: NodeProps) {
  const d = data as unknown as SchemaTableNodeData;
  const displayName = d.recordName || d.structName || d.tableName;

  // relation ハイライトが優先、次に diffStatus、最後にデフォルト
  const borderColor =
    d.relationType === "selected"
      ? "border-primary ring-2 ring-primary/30"
      : d.relationType === "ancestor"
        ? "border-warning"
        : d.relationType === "descendant"
          ? "border-success"
          : d.diffStatus === "added"
            ? "border-success"
            : d.diffStatus === "removed"
              ? "border-error"
              : d.diffStatus === "changed"
                ? "border-warning"
                : d.highlighted
                  ? "border-primary"
                  : "border-base-300";

  // 非関連ノードは暗くする
  const opacity =
    typeof (data as any).relationType !== "undefined" &&
    (data as any).relationType === null
      ? "opacity-30"
      : "";

  return (
    <div className={`bg-base-100 rounded-lg shadow-md border-2 ${borderColor} ${opacity} min-w-[220px] max-w-[340px] text-xs transition-opacity`}>
      {/* Target handle on left for incoming FK references */}
      <Handle type="target" position={Position.Left} id={`${id}-uuid`} className="!bg-primary !w-2.5 !h-2.5 !-left-1.5" />

      {/* Header */}
      <div className="bg-primary text-primary-content px-3 py-1.5 rounded-t-md font-bold text-sm flex items-center gap-2">
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
        <span className="truncate">{displayName}</span>
        {d.relationType === "selected" && (
          <span className="badge badge-xs badge-primary ml-auto">選択中</span>
        )}
        {!d.relationType && d.diffStatus && (
          <span className={`badge badge-xs ml-auto ${
            d.diffStatus === "added" ? "badge-success" :
            d.diffStatus === "removed" ? "badge-error" : "badge-warning"
          }`}>
            {d.diffStatus}
          </span>
        )}
      </div>

      {/* Table name subtitle */}
      {d.tableName && d.tableName !== displayName && (
        <div className="text-[10px] text-base-content/50 px-3 py-0.5 bg-base-200">
          {d.tableName}
        </div>
      )}

      {/* Fields */}
      <div className="divide-y divide-base-200">
        {d.fields.map((field, idx) => {
          const fieldDiff = field.diffStatus;
          const bgClass = fieldDiff === "added"
            ? "bg-success/10"
            : fieldDiff === "removed"
              ? "bg-error/10"
              : fieldDiff === "changed"
                ? "bg-warning/10"
                : field.isKey
                  ? "bg-primary/5"
                  : field.isFk
                    ? "bg-secondary/5"
                    : "";

          return (
            <div
              key={field.name}
              className={`px-3 py-1 flex items-center gap-1.5 ${bgClass}`}
              style={{ position: "relative" }}
            >
              {/* Key badges */}
              <span className="w-6 shrink-0 text-center">
                {field.isKey && (
                  <span className="text-warning font-bold text-[10px]" title="Primary Key">PK</span>
                )}
                {field.isFk && (
                  <span className="text-secondary font-bold text-[10px]" title="Foreign Key ref">FK</span>
                )}
                {field.isEnvRef && (
                  <span className="text-info font-bold text-[10px]" title="Env reference">EV</span>
                )}
              </span>

              <span className={`font-mono ${field.isKey ? "font-bold" : ""} ${
                field.diffStatus === "removed" ? "line-through text-base-content/40" : ""
              }`}>
                {field.name}
              </span>

              {/* Diff status badge */}
              {field.diffStatus && (
                <span className={`badge badge-xs ${
                  field.diffStatus === "added" ? "badge-success" :
                  field.diffStatus === "removed" ? "badge-error" : "badge-warning"
                }`}>
                  {field.diffStatus === "added" ? "+" : field.diffStatus === "removed" ? "-" : "~"}
                </span>
              )}

              <span className={`ml-auto font-mono truncate max-w-[130px] ${
                field.diffStatus === "removed" ? "line-through text-base-content/30" : "text-base-content/50"
              }`} title={field.type}>
                {field.type}
              </span>

              {/* Source handle for FK fields on right side */}
              {field.isFk && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${id}-${field.name}`}
                  className="!bg-secondary !w-2 !h-2 !-right-1"
                  style={{ top: "50%", transform: "translateY(-50%)" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(SchemaTableNode);
