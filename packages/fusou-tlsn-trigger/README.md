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
- `TLSN_WORKER_INTERNAL_URL`
- `TLSN_TRIGGER_CALLBACK_SECRET`
- `TLSN_TRIGGER_SERVER_IDENTITY`
- `TLSN_TRIGGER_PROFILE_SHA256`
- `TLSN_TRIGGER_VERIFIER_KEY_ID`
- `TLSN_TRIGGER_NOTARY_KEY_ID`
- `TLSN_TRIGGER_NOTARY_REGISTRY`
- `TLSN_TRIGGER_TRUST_ROOT_CERTIFICATE_DER`

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
