# FUSOU alpha.15 tlsn-mux patch

**Inactive historical copy:** APP and Proxy no longer apply this path patch.
They resolve the pinned upstream mux and use its public configuration setters
through the opt-in `tlsn/fusou-large-mux` feature. That feature preserves the
previous 10240-stream / 2.5 GiB window ceilings; it does not raise them or claim
that these are acceptable process-memory bounds. Standalone Verifier retains
upstream defaults. No mux frame, stream protocol, or TLSN evidence format was
changed. This directory is retained for provenance, not runtime resolution.

This directory is copied from `tlsn-utils` revision
`64722f7de999cbd41c0cab7312dade306d50ea5f`, the mux revision used by
TLSNotary alpha.15.

The only source change is the default `max_num_streams` value, raised from 512
to 10240, together with the receive window required by that cap. The mux frame
format and stream protocol are unchanged. The 2.5 GiB default connection receive
window satisfies the pinned mux invariant:
`max_connection_receive_window >= 256 KiB * max_num_streams`.

The patch was previously applied by the alpha.15 `tlsn` dependencies in FUSOU
Proxy and FUSOU APP. The tracked FUSOU Verifier manifest has no `tlsn-utils` path patch;
its lockfile resolves `tlsn-mux` from pinned `tlsn-utils` revision
`64722f7de999cbd41c0cab7312dade306d50ea5f`. No separate tracked FUSOU Notary
Cargo manifest was found in the source mapping. Whether an external Notary
needs matching mux resource defaults is therefore unresolved.

The raised limits enlarge the per-connection stream and receive-window
ceilings. This source change is not evidence that the full window is eagerly
allocated. Resource/DoS behavior and peer compatibility require independent
review; the default change does not establish a TLSN wire-contract requirement.
The copied license files also differ from the pinned upstream notices; see the
alpha.15 audit dossier before making any distribution decision.
