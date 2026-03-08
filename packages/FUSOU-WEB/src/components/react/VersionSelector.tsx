/** @jsxImportSource react */

interface VersionSelectorProps {
  versions: string[];
  selected: string;
  onChange: (version: string) => void;
  labels?: Record<string, string>;
  label?: string;
  /** Two-level mode: list of major version keys (e.g. ["v0", "v1"]) */
  majorVersions?: string[];
  /** Currently selected major version */
  selectedMajor?: string;
  /** Callback when major version changes */
  onMajorChange?: (major: string) => void;
}

/** Convert a version key like "v0_4" to a display label like "v0.4" */
function versionKeyToLabel(key: string): string {
  return key.replace(/_/g, ".");
}

export default function VersionSelector({
  versions,
  selected,
  onChange,
  labels,
  label = "Schema:",
  majorVersions,
  selectedMajor,
  onMajorChange,
}: VersionSelectorProps) {
  const hasMajorSelector =
    majorVersions && majorVersions.length > 1 && selectedMajor && onMajorChange;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-base-content/60 font-medium">{label}</span>

      {/* Major version selector (only when multiple major versions exist) */}
      {hasMajorSelector && (
        <div className="join mr-1">
          {majorVersions.map((m) => (
            <button
              key={m}
              className={`join-item btn btn-xs border border-base-content/5 ${selectedMajor === m ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => onMajorChange!(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {/* Minor version selector */}
      <div className="join">
        {versions.map((v) => (
          <button
            key={v}
            className={`join-item btn btn-xs border border-base-content/5 ${selected === v ? "btn-primary" : "btn-ghost"}`}
            onClick={() => onChange(v)}
          >
            {labels?.[v] ?? versionKeyToLabel(v)}
          </button>
        ))}
      </div>
    </div>
  );
}
