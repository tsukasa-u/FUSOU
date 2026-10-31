export function verifySignedResultRegistryEnvelope(input: {
  registryRaw: string;
  registryEnvelopeRaw: string;
  trustedRootKeyId: string;
  trustedRootPublicKeySpki: string;
}): Promise<true>;
