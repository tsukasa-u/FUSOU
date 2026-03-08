import { atom } from 'nanostores';

export type SidePageItem = {
  id: string;
  name: string;
}

export const sidePageSlected = atom<{ id: string }>({ id: "" });
// export const sidePageItems = map<Record<string, SidePageItem>>({});

// type ItemDisplayInfo = Pick<SidePageItem, 'id' | 'name'>;
// export function addSidePageItem({ id, name }: ItemDisplayInfo) {
//   const existingEntry = sidePageItems.get()[id];
//   if (existingEntry) {
//     sidePageItems.setKey(id, {
//       ...existingEntry,
//       name
//     });
//   } else {
//     sidePageItems.setKey(
//       id,
//       { id, name }
//     );
//   }
// }

// export function deleteSidePageItem(id: string) {
//   sidePageItems.setKey(id, undefined);
// }

export function setSidePageSlected(id: string) {
  sidePageSlected.set({ id });
}

export function deleteSidePageSlected() {
  sidePageSlected.set({ id: "" });
}