import { SignJWT, importPKCS8 } from "jose";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type AdminLogRow = {
  timestamp: string;
  event_type: string;
  dataset_id: string;
  trust_tag: string;
  attestation_level: string;
  details: string;
};

function assertServiceAccount(value: unknown): ServiceAccount {
  if (!value || typeof value !== "object") {
    throw new Error("Service account key JSON is invalid");
  }
  const sa = value as Partial<ServiceAccount>;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service account key JSON is missing required fields");
  }
  return {
    client_email: sa.client_email,
    private_key: sa.private_key,
    token_uri: sa.token_uri,
  };
}

async function fetchGoogleAccessToken(
  serviceAccount: ServiceAccount,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri || "https://oauth2.googleapis.com/token";

  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/spreadsheets",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(serviceAccount.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google access token: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Google token response did not include access_token");
  }

  return payload.access_token;
}

export async function logToAdminSpreadsheet(options: {
  spreadsheetId: string;
  sheetName: string;
  googleServiceAccountKey: string;
  row: AdminLogRow;
}): Promise<void> {
  const serviceAccount = assertServiceAccount(
    JSON.parse(options.googleServiceAccountKey),
  );
  const accessToken = await fetchGoogleAccessToken(serviceAccount);

  const range = `${encodeURIComponent(options.sheetName)}!A:F`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${options.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      values: [
        [
          options.row.timestamp,
          options.row.event_type,
          options.row.dataset_id,
          options.row.trust_tag,
          options.row.attestation_level,
          options.row.details,
        ],
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to append spreadsheet row: HTTP ${response.status}`);
  }
}
