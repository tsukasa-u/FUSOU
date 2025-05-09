import { createAuthClient } from "better-auth/solid"
import { multiSessionClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
    plugins: [
        multiSessionClient()
    ]
})

type Provider = "apple" | "discord" | "facebook" | "github" | "google" | "microsoft" | "spotify" | "twitch" | "twitter" | "dropbox" | "linkedin" | "gitlab" | "tiktok" | "reddit" | "roblox" | "vk" | "kick" | "zoom";

export const signIn = async (provider: Provider) => {
    // await authClient.signOut();
    console.log(await authClient.multiSession.listDeviceSessions());
    const {data, error} = await authClient.signIn.social({
        provider: provider,
        // callbackURL: `${import.meta.env.BETTER_AUTH_URL}/api/auth/callback`,
        callbackURL: "/api/auth/callback/google",
        errorCallbackURL: "/error",
    });
    console.log(error);
    return {data, error}
}