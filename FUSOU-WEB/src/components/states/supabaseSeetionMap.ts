import { map } from 'nanostores';

export type SessionInfo = {
    id: string,
    accessToken: string,
    refreshToken: string,
    email: string,
    provider: string,
    username: string,
}
export const Sessions = map<Record<string, SessionInfo>>({});

type ItemDisplayInfo = Pick<SessionInfo, 'id' | 'accessToken' | 'refreshToken' | 'email' | 'provider' | 'username'>;
export function setSession({ id, accessToken, refreshToken, email, provider, username }: ItemDisplayInfo) {
    Sessions.setKey(id, { id, accessToken, refreshToken, email, provider, username });
}

export function resetSession() {
    Object.keys(Sessions.get()).forEach((k) => {
        Sessions.setKey(k, undefined);
    });
}

export function getSession(): Record<string, SessionInfo> {
    return Sessions.get()
}