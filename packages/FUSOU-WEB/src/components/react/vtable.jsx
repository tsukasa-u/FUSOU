/** @jsxImportSource react */
import "../../styles/global.css";
import { TableVirtuoso } from "react-virtuoso";
import { useMemo } from "react";

export default function VTable() {
  const users = useMemo(() => {
    return Array.from({ length: 1000 }, (_, index) => ({
      name: `User ${index}`,
      description: `Description for user ${index}`,
    }));
  }, []);

  return (
    <>
      <div className="join join-vertical rounded-sm w-full">
        <div className="join-item border-base-300 border-2 py-6 px-8 w-full">
          Load Data and check verification
          <div className="h-2"></div>
          <div className="flex justify-end">
            <button className="btn btn-info w-40">Load Data</button>
          </div>
        </div>
        <div className="join-item border-base-300 border-t-0 border-2 py-6 px-8 w-full">
          <TableVirtuoso
            data={users}
            style={{ height: 400 }}
            fixedHeaderContent={() => (
              <tr className="bg-base-100 h-10">
                <th>Name</th>
                <th>Description</th>
              </tr>
            )}
            itemContent={(_index, user) => (
              <>
                <td className="bg-base-100 border-t-1 border-base-300 h-8 text-sm p-2">
                  {user.name}
                </td>
                <td className="bg-base-100 border-t-1 border-base-300 h-8 text-sm p-2">
                  {user.description}
                </td>
              </>
            )}
          />
        </div>
      </div>
    </>
  );
}
