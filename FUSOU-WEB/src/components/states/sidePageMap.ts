import { map } from 'nanostores';

export type SidePageItem = {
  id: string;
  name: string;
}

export const sidePageItems = map<Record<string, SidePageItem>>({});

type ItemDisplayInfo = Pick<SidePageItem, 'id' | 'name'>;
export function addSidePageItem({ id, name }: ItemDisplayInfo) {
  const existingEntry = sidePageItems.get()[id];
  if (existingEntry) {
    sidePageItems.setKey(id, {
      ...existingEntry,
      name
    });
  } else {
    sidePageItems.setKey(
      id,
      { id, name }
    );
  }
}

export function deleteSidePageItem(id: string) {
  sidePageItems.setKey(id, undefined);
}