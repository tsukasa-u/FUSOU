export function tlsnDeviceProofSigningBytes(
  proof: { device_id: string; session_id: string; binding_value: string },
  challenge: Uint8Array,
): Uint8Array {
  if (challenge.length !== 32) throw new Error("device proof challenge must be 32 bytes");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [encoder.encode("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  for (const value of [
    encoder.encode(proof.device_id),
    encoder.encode(proof.session_id),
    encoder.encode(proof.binding_value),
    challenge,
  ]) {
    if (value.length > 0xffff) throw new Error("device proof field is too large");
    chunks.push(new Uint8Array([value.length >> 8, value.length & 0xff]), value);
  }
  const message = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    message.set(chunk, offset);
    offset += chunk.length;
  }
  return message;
}
