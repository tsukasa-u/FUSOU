import { persistentAtom } from '@nanostores/persistent';

export type SessionInfo = {
    id: string,
    accessToken: string,
    refreshToken: string,
    email: string,
    provider: string,
    username: string,
    providerToken: string,
    providerRefreshToken: string,
    date: string,
}
export const Sessions = persistentAtom<SessionInfo[]>('FUSOU-persistentSupabaseSession', [], {
    encode: JSON.stringify,
    decode: JSON.parse,
});

type ItemDisplayInfo = Pick<SessionInfo, 'id' | 'accessToken' | 'refreshToken' | 'email' | 'provider' | 'username' | 'providerToken' | 'providerRefreshToken' | 'date'>;
export function setSession({ id, accessToken, refreshToken, email, provider, username, providerToken, providerRefreshToken, date }: ItemDisplayInfo) {
    let value = Sessions.get().filter((v) => v.id != id);
    Sessions.set([...value, { id, accessToken, refreshToken, email, provider, username,  providerToken, providerRefreshToken, date }]);
}

export function resetSession() {
    Sessions.set([]);
}