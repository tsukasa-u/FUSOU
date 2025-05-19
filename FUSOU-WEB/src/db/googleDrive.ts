export async function listGoogleDriveFilesWebClient(accessToken: string) {
    try {
        const response = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                //   'Content-Type': 'application/json; charset=utf-8',

            },
        });

        if (!response.ok) {
            console.error('Google Drive API error:', response.status, await response.text());
            return null;
        }

        const data = await response.json();
        console.log('Google Drive files:', data.files);
        return data.files;
    } catch (error) {
        console.error('Error listing Google Drive files:', error);
        return null;
    }
}

export async function refreshToken(refreshToken: string) {
    let response = await fetch(import.meta.env.PUBLIC_SITE_URL + "/api/auth/google/refresh_token",
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                refreshToken: refreshToken
            }),
        }).then((response) => response.json());

    return response;
}

export async function listGoogleDriveFoldersWebClient(accessToken: string) {
    try {
        const response = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27%20and%20%27root%27%20in%20parents%20and%20trashed%20%3D%20false&corpora=user', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            console.error('Google Drive API error:', response.status, await response.text());
            return null;
        }

        const data = await response.json();
        console.log('Google Drive Folders:', data.files);
        return data.files;
    } catch (error) {
        console.error('Error listing Google Drive files:', error);
        return null;
    }
}

export async function check_file(accessToken: string, folder_name: string, parent: string = "root", mime_type: string = "application%2Fvnd.google-apps.folder") {
    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27${mime_type}%27%20and%20name%3D%27${folder_name}%27%20and%20%27${parent}%27%20in%20parents%20and%20trashed%20%3D%20false&corpora=user`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            let res_text = await response.text();
            console.error('Google Drive API error:', response.status, res_text);
            return [null, JSON.parse(res_text).error.message];
        }

        const data = await response.json();
        if (data.files.length > 1) {
            console.error('duplicate files are existed')
        }
        return [data.files[0], null];
    } catch (error) {
        console.error('Error listing Google Drive files:', error);
        return [null, error];
    }
}

export async function check_period(accessToken: string, folder_name: string, parent: string) {
    return check_file(accessToken, folder_name, parent,  "application%2Fvnd.google-apps.folder")
}

