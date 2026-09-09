# FUSOU alpha.15 tlsn-mux patch

This directory is copied from `tlsn-utils` revision
`64722f7de999cbd41c0cab7312dade306d50ea5f`, the mux revision used by
TLSNotary alpha.15.

The only source change is the default `max_num_streams` value, raised from 512
to 10240, together with the receive window required by that cap. The mux frame
format and stream protocol are unchanged. The 2.5 GiB default connection receive
window satisfies the pinned mux invariant:
`max_connection_receive_window >= 256 KiB * max_num_streams`.

The patch is applied by the alpha.15 `tlsn` dependencies in FUSOU Proxy and
FUSOU Notary. Both MPC endpoints must use this patched local mux; an endpoint
left at the stock 512-stream default can still fail during large preprocessing.
