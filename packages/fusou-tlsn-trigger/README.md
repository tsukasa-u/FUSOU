# fusou-tlsn-trigger

This package owns the Trigger.dev task that performs heavy TLSNotary alpha.15 verification.
It is separate from `fusou-compaction-trigger`: compaction merges battle Avro blocks, while
this package verifies authenticated TLSNotary presentations.

## Boundary

- `FUSOU-TLSN-VERIFICATION-WORKER` authenticates the device, stores the presentation, owns
  the single-use binding, and signs the final result.
- This package receives only the binding metadata and R2 object reference through the
  Trigger task payload.
- The task fetches the presentation through the Worker HMAC boundary, runs the pinned
  verifier WASM, and posts the unsigned prepared result back to the Worker.

The presentation is never included in the Trigger task payload. The Worker remains the
result authority and deletes the input object after a successful commit.

## Configuration

Copy `.env.example` to `.env` and encrypt it with `packages/.env.keys`. The package requires:

- `TRIGGER_PROJECT_REF`
- `TRIGGER_SECRET_KEY`
- `TLSN_TRIGGER_DEPLOYMENT_ROLE` (`production` or `canary`)
- `TLSN_WORKER_INTERNAL_URL`
- `TLSN_TRIGGER_CALLBACK_SECRET`
- `TLSN_TRIGGER_VERIFIER_KEY_ID`
- `TLSN_TRIGGER_NOTARY_KEY_ID`
- `TLSN_TRIGGER_NOTARY_REGISTRY`

Production Trigger deployments derive the Origin identity from the Notary-authenticated
Presentation, require it to match the shared 20-host HTTPS inventory, and compute the selected
complete/sparse profile digest for that identity. Production rejects static Origin identity or
profile values. Canary deployments set the role to `canary` and provide
`TLSN_TRIGGER_SERVER_IDENTITY`, `TLSN_TRIGGER_PROFILE_SHA256`, and
`TLSN_TRIGGER_SPARSE_PROFILE_SHA256`; Worker task payloads select this fixed-target path.
Neither role accepts a custom trust root. The inventory is an allowlist, not a substitute for
Web PKI certificate validation.

Trigger deployment records the raw-byte SHA-256 of the inventory asset it packages as
`TLSN_TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256`; the runtime checks that metadata against the
bytes it loads and includes it in task logs. This digest identifies the deployed artifact only; it
is not an Origin authorization source or a certificate trust anchor. Production authorization
continues to bind the Worker's task digest to the Trigger runtime inventory bytes, while Web PKI
validates the TLS certificate and the Notary authenticates the Presentation.

The Trigger project reference may be shared with another Trigger package, but source code,
configuration, and deployment credentials remain package-specific.

## Commands

```bash
pnpm run typecheck
pnpm run typecheck:config
pnpm run trigger:deploy
```

All deployment commands run through dotenvx. The deploy wrapper verifies the required
configuration and the Worker WASM artifacts before invoking the Trigger CLI.
