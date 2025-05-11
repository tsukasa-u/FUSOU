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
}
export const Sessions = persistentAtom<SessionInfo[]>('FUSOU-persistentSupabaseSession', [], {
    encode: JSON.stringify,
    decode: JSON.parse,
});

type ItemDisplayInfo = Pick<SessionInfo, 'id' | 'accessToken' | 'refreshToken' | 'email' | 'provider' | 'username' | 'providerToken' | 'providerRefreshToken'>;
export function setSession({ id, accessToken, refreshToken, email, provider, username, providerToken, providerRefreshToken }: ItemDisplayInfo) {
    Sessions.set([...Sessions.get(), { id, accessToken, refreshToken, email, provider, username,  providerToken, providerRefreshToken }]);
}

export function resetSession() {
    Sessions.set([]);
}