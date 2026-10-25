import { createHash } from "node:crypto";
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("base64url");
export const MAX_RELEASE_RECORD_BYTES = 1024 * 1024;
