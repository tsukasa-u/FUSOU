export type ResultSigningKeyRegistry = {
  keys: readonly {
    key_id: string;
    public_key_spki: string;
    status: "ACTIVE" | "VERIFY_ONLY" | "RETIRED" | "REVOKED";
    not_before: string;
    not_after: string | null;
  }[];
};

export type ProductionResultRegistryBindings = {
  publicKeySpki: string | undefined;
  signerKeyId: string | undefined;
  registryRaw: string | undefined;
  registryEnvelopeRaw: string | undefined;
  rootKeyId: string | undefined;
  rootPublicKeySpki: string | undefined;
};

export function selectProductionResultRegistryBindings(
  bindings: {
    production: ProductionResultRegistryBindings;
    canary: ProductionResultRegistryBindings;
  },
  role: "production" | "canary",
): ProductionResultRegistryBindings;

export function hasActiveResultSigningKey(
  registry: ResultSigningKeyRegistry,
  signerKeyId: string | undefined,
  signerPublicKeySpki: string | undefined,
  nowMs?: number,
): boolean;

export function verifySignedResultRegistryEnvelope(input: {
  registryRaw: string;
  registryEnvelopeRaw: string;
  trustedRootKeyId: string;
  trustedRootPublicKeySpki: string;
}): Promise<true>;
