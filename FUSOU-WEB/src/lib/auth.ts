import { betterAuth } from "better-auth";
import { Pool } from 'pg';
import { multiSession } from "better-auth/plugins"

export const auth = betterAuth({
	appName: "FUSOU",
	basePath: "/api/auth",
    database: new Pool({
        connectionString: import.meta.env.SUPABASE_DATABASE_URL,
    }),
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["google"],
		},
	},
    secret: import.meta.env.BETTER_AUTH_SECRET,
    baseURL: import.meta.env.PUBLIC_SITE_URL,
    socialProviders: {
        google: {
            // prompt: "select_account",
            clientId: import.meta.env.GOOGLE_CLIENT_ID as string,
            clientSecret: import.meta.env.GOOGLE_CLIENT_SECRET as string,
			// redirectUri: `${import.meta.env.BETTER_AUTH_URL}/api/auth/callback`
        },
    },
    plugins: [
        multiSession({
            maximumSessions: 5
        })
    ],
    trustedOrigins: ["*"]
})