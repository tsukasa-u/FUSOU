import { sha256 } from "./release-manifest.mjs";

// Boundary audit only, not an HTTP/WebSocket handshake semantics or TLS verifier.
export function verifyHandshakeOnlyArtifact({ request, response, clientRequest, clientResponse }) {
  const buffers = {};
  for (const [key, bytes] of Object.entries({ request, response, clientRequest, clientResponse })) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 128 * 1024) throw new Error("handshake audit requires bounded raw bytes");
    const raw = Buffer.from(bytes);
    const end = raw.indexOf("\r\n\r\n");
    if (end < 0 || end + 4 !== raw.length) throw new Error("handshake artifact is incomplete or includes post-header/frame bytes");
    buffers[key] = raw;
  }
  if (!buffers.request.equals(buffers.clientRequest) || !buffers.response.equals(buffers.clientResponse)) {
    throw new Error("artifact differs from its own client-observed HTTP bytes");
  }
  if (!/^GET [^\r\n ]+ HTTP\/1\.1\r\n/.test(buffers.request.toString("latin1")) ||
      !/^HTTP\/1\.1 101 [^\r\n]+\r\n/.test(buffers.response.toString("latin1"))) {
    throw new Error("expected HTTP Upgrade request and client-facing 101 response");
  }
  return { scope: "http-handshake-byte-boundary-only", request_sha256: sha256(buffers.request),
    response_sha256: sha256(buffers.response), websocket_frames_included: false, tlsn_status: "NOT_CHECKED" };
}
