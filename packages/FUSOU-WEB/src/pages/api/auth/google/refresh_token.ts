import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';

    // Googleから取得したリフレッシュトークン、クライアントID、クライアントシークレットを設定
    const googleRefreshToken = (await request.json()).refreshToken;
    const googleClientId = import.meta.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = import.meta.env.GOOGLE_CLIENT_SECRET;

    try {
        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: googleRefreshToken,
                client_id: googleClientId,
                client_secret: googleClientSecret,
            }),
        });

        if (!response.ok) {
            let msg = await response.text();
            console.error('Google refresh token error:', response.status, msg);
            return new Response(msg, { status: 500 });
        }

        const data = await response.json();
        console.log('New Google access token:', data.access_token);
        console.log('Expires in:', data.expires_in);
        console.log('New Google refresh token (if provided):', data.refresh_token);

        return new Response(
            JSON.stringify({
                accessToken: data.access_token,
                expiresIn: data.expires_in,
                newRefreshToken: data.refresh_token, // 新しいリフレッシュトークンが返ってくる場合もあります
            })
        );
    } catch (error) {
        console.error('Error refreshing Google access token:', error);
        return new Response(JSON.stringify(error), { status: 500 });
    }
}