/** @jsxImportSource react */

interface ApiGroupNavProps {
  groups: string[];
  selectedGroup: string;
  onGroupChange: (group: string) => void;
  endpoints: string[];
  selectedEndpoint: string;
  onEndpointChange: (endpoint: string) => void;
}

function formatGroupName(name: string): string {
  return name;
  // return name
  //   .replace(/^api_/, "")
  //   .replace(/_/g, " ")
  //   .split(" ")
  //   .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  //   .join(" ");
}

export default function ApiGroupNav({
  groups,
  selectedGroup,
  onGroupChange,
  endpoints,
  selectedEndpoint,
  onEndpointChange,
}: ApiGroupNavProps) {
  return (
    <div className="flex items-center gap-2 flex-nowrap">
      <span className="text-xs text-base-content/60 font-medium">Group:</span>
      <select
        className="select select-bordered select-xs max-w-[300px]"
        value={selectedGroup}
        onChange={(e) => onGroupChange(e.target.value)}
      >
        <option value="" disabled>
          Select group...
        </option>
        {groups.map((g) => (
          <option key={g} value={g}>
            {formatGroupName(g)}
          </option>
        ))}
      </select>

      {endpoints.length > 0 && (
        <>
          <span className="text-xs text-base-content/60 font-medium">
            Endpoint:
          </span>
          <select
            className="select select-bordered select-xs max-w-[300px]"
            value={selectedEndpoint}
            onChange={(e) => onEndpointChange(e.target.value)}
          >
            {endpoints.map((ep) => (
              <option key={ep} value={ep}>
                {ep}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
