/** @jsxImportSource react */
import type { Node } from "@xyflow/react";
import type { GraphMode } from "./SchemaGraph";

interface NodeDetailPanelProps {
  node: Node;
  mode: GraphMode;
  onClose: () => void;
}

export default function NodeDetailPanel({ node, mode, onClose }: NodeDetailPanelProps) {
  const data = node.data as any;
  const title = data.recordName || data.structName || data.tableName || node.id;

  return (
    <div className="absolute top-2 right-2 w-80 max-h-[calc(100%-1rem)] bg-base-100 border border-base-300 rounded-xl shadow-lg overflow-hidden flex flex-col z-10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-base-200 border-b border-base-300">
        <h3 className="font-bold text-sm truncate">{title}</h3>
        <button className="btn btn-ghost btn-xs btn-circle" onClick={onClose}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Subtitle / badges */}
      {mode === "database" && data.tableName && (
        <div className="px-4 py-1 text-xs text-base-content/50 bg-base-200/50 border-b border-base-300 flex items-center gap-2">
          <span>Table: <code className="font-mono">{data.tableName}</code></span>
          {data.diffStatus && (
            <span className={`badge badge-xs ${
              data.diffStatus === "added" ? "badge-success" :
              data.diffStatus === "removed" ? "badge-error" : "badge-warning"
            }`}>
              {data.diffStatus}
            </span>
          )}
        </div>
      )}
      {mode === "endpoints" && (
        <div className="px-4 py-1 bg-base-200/50 border-b border-base-300">
          {data.isReq && <span className="badge badge-info badge-sm">Request</span>}
          {data.isRes && <span className="badge badge-success badge-sm">Response</span>}
          {data.isDataType && <span className="badge badge-neutral badge-sm">Data Type</span>}
        </div>
      )}

      {/* Fields */}
      <div className="overflow-y-auto flex-1">
        <table className="table table-xs w-full">
          <thead>
            <tr>
              {mode === "database" && <th className="text-xs w-8"></th>}
              <th className="text-xs">Field</th>
              <th className="text-xs">Type</th>
            </tr>
          </thead>
          <tbody>
            {data.fields && data.fields.length > 0 ? (
              data.fields.map((field: any, i: number) => {
                const diffClass = field.diffStatus === "added"
                  ? "bg-success/10"
                  : field.diffStatus === "removed"
                    ? "bg-error/10 line-through"
                    : field.diffStatus === "changed"
                      ? "bg-warning/10"
                      : "";
                return (
                  <tr key={i} className={`hover ${diffClass}`}>
                    {mode === "database" && (
                      <td className="text-xs w-8 text-center">
                        {field.isKey && <span className="text-warning font-bold">PK</span>}
                        {field.isFk && <span className="text-secondary font-bold">FK</span>}
                        {field.isEnvRef && <span className="text-info font-bold">EV</span>}
                      </td>
                    )}
                    <td className="font-mono text-xs">{field.name}</td>
                    <td className="font-mono text-xs text-base-content/60 max-w-[140px] truncate" title={field.type}>
                      {field.type}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={mode === "database" ? 3 : 2} className="text-center text-base-content/40 italic">
                  No fields available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer stats */}
      <div className="px-4 py-1.5 border-t border-base-300 bg-base-200/50 text-xs text-base-content/50">
        {data.fields?.length ?? 0} fields
        {data.fields && (
          <>
            {(() => {
              const fkCount = data.fields.filter((f: any) => f.isFk).length;
              return fkCount > 0 ? ` / ${fkCount} FK references` : "";
            })()}
          </>
        )}
      </div>
    </div>
  );
}
