import { persistentAtom } from '@nanostores/persistent';

export type PageStrageInfo = {
    id: string,
    email: string,
    provider: string,
    fillter: boolean,
    access_token: string,
    refresh_token: string,
};
export type PageInfo = {
    id: string,
    name: string,
    storage: PageStrageInfo[],
    period: {
        type: number,
        range: string[],
    }
}
export const PageData = persistentAtom<PageInfo[]>('FUSOU-persistentPageData', [], {
    encode: JSON.stringify,
    decode: JSON.parse,
});

type ItemDisplayInfo = Pick<PageInfo, 'id' | 'storage' | 'name' | 'period'>;
export function setPageData({ id, name, storage, period }: ItemDisplayInfo) {
    let value = PageData.get().filter((v) => v.id != id);
    PageData.set([...value, { id, name, storage, period }]);
}

export function getPageData(id: string): PageInfo {
    return PageData.get().find((v) => v.id == id)!
}

export function deletePageData(id: string) {
    let value = PageData.get().filter((v) => v.id != id);
    PageData.set([...value]);
}

export function resetSession() {
    PageData.set([]);
}