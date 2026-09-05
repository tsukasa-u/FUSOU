# Historical Natural Capture Forensic Review

Status: `P0-04 PASS under corrected natural-evidence semantics; P0-15 BLOCKED`. This review uses existing local artifacts and source inspection only. It did not access the Game Server, replay the capture, or recollect traffic.

## Reviewed Artifact

- Capture kind: natural `require_info` candidate.
- Capture ID: `capture-1788576230860226802-419421-0-connection-6`.
- Wire fidelity: `EXACT_WIRE`.
- Complete artifact SHA-256: `825cfdb8271fba72f647e6eebcc7fc13ebbe729f5f2e248d1b5abaa369880bc1`.
- Artifact integrity: `PASS`.
- Operator provenance: ordinary FUSOU-APP startup and ordinary gameplay were reported; no standalone request, injection, replay, or retry was reported.
- Raw artifact: remains private and is not committed.

The natural provenance claim is supported by the external operator record and the exact-wire verifier. The request is the observed `POST /kcsapi/api_get_member/require_info` exchange with an HTTP 200 response and the allowlisted Game Server identity recorded in the candidate/review metadata. These facts qualify the natural-evidence requirement; they are not, by themselves, a privacy or side-effect qualification.

## Historical Upload and Persistence Findings

The effective user configuration for the session had all of the following enabled:

- proxy API request, API response, resource, and local `main.js` persistence;
- database cloud, shared-cloud, and local providers;
- asset upload worker;
- quest-tree, ship-growth, soku-speed, and remodel senders;
- authentication bootstrap.

The relevant source paths establish these additional behaviors:

1. `FUSOU-PROXY-DATA` persistence stored client-facing API material and non-API resources locally. The asset worker skips `kcsapi` paths, so the captured `require_info` files were not shown to enter the asset upload path. Non-`kcsapi` resources were eligible for asset upload.
2. Shared-cloud storage used `https://fusou.dev/api/battle-data/upload` and `https://fusou.dev/api/master-data/upload`. The historical pending metadata contains a 526,103-byte master-data payload for the 13-table `2026-08-05` batch and its master-data upload context.
3. Asset sync used `https://fusou.dev/api/asset-sync/upload`. Historical logs record upload attempts for `kcs2/version.json`, two port image files, and two `friendly_panel` resource files. The corresponding pending metadata records their remote asset keys, content hashes, sizes, and dataset IDs.
4. The four custom sender modules were enabled in the historical user configuration and are started during app initialization. No session-specific successful sender event was required to establish the risk: the configured paths were active and were not disabled by the old launcher.
5. Snapshot sync had a separate fleet endpoint and did not have a launcher-level gate in the old revision. No snapshot invocation was found in the reviewed session, so it remains a possible path, not an observed upload.
6. Startup loaded or refreshed authentication state and fetched provider tokens when a session was available. This is separate from `require_info` payload upload, but it is an external side effect that the old launcher did not suppress.
7. The app-level retry service performs a forced retry at startup and periodic retries afterward. The historical log records an authentication-related retry failure and a later master-data retry failure. Pending files persist across shutdown and can be retried by a later process.

## Timeline

All times below are local APP log time in JST; the capture manifest is UTC.

| Time | Evidence | Interpretation |
| --- | --- | --- |
| 11:39:20 | Expired dataset token warning | Existing auth state was present but not usable. |
| 11:39:21 | Retry of an existing pending upload; HTTP 401 | An upload attempt occurred before the capture exchange. |
| 11:39:47 | `require_info` capture enabled | Exact-wire capture worker active. |
| 11:40:06-11:40:12 | Asset upload 401 responses and pending-file creation; master-data pending creation | App-originated upload attempts and durable local queue writes occurred in the same session. |
| 11:43:30 | Master-data pending retry failed with invalid context | Pending retry processing remained active. |
| 11:43:48Z-11:43:50Z | Captured `require_info` request/response | The reviewed exact-wire exchange. |

## Claim Classification

- “No successful upload was logged”: supported by the reviewed local log, with the ordinary limitation that logs are not a network trace.
- “No upload attempt occurred”: false for the session; asset upload attempts and retry attempts are recorded.
- “No external transmission occurred”: unsupported. Requests were sent to the configured FUSOU endpoints, and local evidence cannot establish that no request metadata or payload bytes were accepted before the 401 responses.
- “The captured `require_info` bytes were uploaded”: not established by the reviewed source, pending metadata, or logs. The asset path explicitly skips `kcsapi`; the unresolved transmission boundary disqualifies privacy/clean-capture claims, but does not establish that the observed `require_info` request was fabricated or invalidate its natural provenance.

## Gate Decision

The side-effect-aware v2 review records:

- `natural_provenance=true`;
- `external_transmission_status=POSSIBLE_UNRESOLVED`;
- `privacy_disposition=DISQUALIFIED`;
- `privacy_qualified=false`;
- `P0-04=PASS` under the corrected model: exact-wire integrity, natural provenance, allowlisted Game Server identity, and `require_info` evidence pass;
- `P0-15=BLOCKED` because privacy/non-persistence/redaction approval is not qualified;
- `P0-05=BLOCKED`;
- `IMPLEMENTATION=NO-GO`.

The old v1 review's `natural_provenance=true` output did not qualify privacy or operational isolation because it had no fields for launcher revision, app upload state, pending uploads, or external transmission disposition. Those missing fields do not invalidate the separate natural-evidence result under the corrected P0-04 model.

## Future Clean Session Conditions

The updated manual launcher now temporarily disables proxy persistence, database providers, asset upload, custom senders, authentication bootstrap, pending-upload retries, and snapshot sync. The app honors `deny_auth`, suppresses retry services while authentication is denied, and rejects manual snapshot sync while asset upload is disabled. The temporary configuration is restored after the launcher exits.

These changes establish safer collection conditions for a future operator-controlled session. They do not retroactively qualify this historical capture for privacy or operational isolation and do not authorize recollection in this review. The existing capture is sufficient for the corrected P0-04 natural-evidence decision; P0-15 remains blocked.