# TLSNotary Phase 0 ソース調査 v1

## 調査範囲

このレポートは、公式TLSNotaryソースとFUSOU repositoryをread-onlyで調査した結果を記録する。候補に関する証拠のみであり、FUSOUのupstream revision選定、profile承認、runtimeまたはmigration作業の承認は行わない。

観測時刻: `2026-09-03T07:59:13Z` (UTC)

## 正確なupstream入力

- repository: `https://github.com/tlsnotary/tlsn.git`
- 観測したremote: `refs/heads/main`
- 観測した正確なcommit: `0fe3c32d35382b3f290a43c4156399ca4512bb89`
- checkout: `/tmp/tlsn-phase0-source`、shallow clone、観測時点でclean
- 観測時点のFUSOU repository HEAD: `a103b5068251ae4d02ac2e3b7dac882f032943fe`
- 候補状態: `CANDIDATE_ONLY`。FUSOUにはTLSNotaryのpinned dependencyまたはprofile artifactがない

ソースcheckoutを再現し、revisionを検証するコマンド:

```text
git clone --depth 1 https://github.com/tlsnotary/tlsn.git /tmp/tlsn-phase0-source
git -C /tmp/tlsn-phase0-source rev-parse HEAD
```

## 公開版比較と候補分類

観測remoteの公開tagは `v0.1.0-alpha.1` から `v0.1.0-alpha.15` までであり、`alpha.16` の公開tagは観測されなかった。詳細なsource比較は、最新公開版 `v0.1.0-alpha.15` と観測時点の `refs/heads/main` に対して行った。両revisionのsource treeを対象に `notary_time`、`issued_at`、`issuance_time` の完全なfield/API名を検索したが、該当するNotary-issued時刻は見つからなかった。tag列挙とこの検索は候補探索の証拠であり、FUSOUがrevisionを選定したことを意味しない。

| 候補 | exact commit | package version | Attestation ID | time | transcript / finalization | FUSOU bindingとの関係 | 分類 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `refs/tags/v0.1.0-alpha.15` | `47aee45b53e06648c1b2ad3689b367b8c923fdec` | `0.1.0-alpha.15` | `attestation.header.id.0`、16 bytes | `ConnectionInfo.time`はTLS connection-start time | sent/received `RangeSet` disclosureとsession closeはある | FUSOU HTTP range、strict parser、one-request policyはupstream保証ではない | `REJECTED_UNDER_CURRENT_SPEC`（P0-03） |
| `refs/heads/main` | `0fe3c32d35382b3f290a43c4156399ca4512bb89` | `0.1.0-alpha.16-pre` | `attestation.header.id.0`、16 bytes | `ConnectionInfo.time`はTLS connection-start time | alpha.15と同じ根本API。mainにはclosure testが追加された | FUSOUのwrite/retry契約は保証しない | `REJECTED_UNDER_CURRENT_SPEC`（P0-03） |

alpha.15とmainで、次のfocused source filesは同一SHA-256だった。

```text
crates/attestation/src/lib.rs             be78d7e5335170398141ba1d2b6dba3b516179071bd049d4088139d73b027a0b
crates/attestation/src/serialize.rs      ec69c500a5da3f4a7de826cd964dc5fa7a18497857536b91e2ab0e92cbff1f05
crates/attestation/src/builder.rs        08851ea15be6c6b9ab241c9518d9c8c98b6f4a64fcd35cc329ce3c86495610f0
crates/core/src/connection.rs             285b3510bf9092ce87a238ca749de6b68d98a74c2f1784ddf7f45e4ffa54a461
crates/core/src/transcript/tls.rs         df6732b88fd56ce63e5efdf4c5aae80514c807dee63d7debc962906ce148a2c3
crates/core/src/transcript/tls/builder.rs 60968e4fe25e3b4d1c9d0f4607aab972b639d598511850962ad8773787117d3b
crates/tlsn/src/proxy.rs                  8ec2bb0808730e1f4976d616253bdd7d7673b536684f99d174571f68dcb6494c
```

`crates/examples/attestation/prove.rs`だけはalpha.15とmainで差分があり、Notary request/attestation wireの基本順序に影響する追加変更を含む。しかしどちらも `ConnectionInfo { time: tls_transcript.time(), ... }` をsigned Attestationへ入れ、`notary_time`を追加していない。

この比較に基づく判定は次のとおりである。

- `ADOPTABLE`: 該当なし。
- `SPEC-COMPATIBLE-BUT-NEEDS-ADAPTER`: 該当なし。public fieldやRangeSetをFUSOU adapterで接続することはできても、adapterはNotary signatureの対象となるNotary-issued `notary_time`を追加できない。
- 結論: **`NO ADOPTABLE REVISION FOUND`**。

FUSOUはまだTLSNotary revisionを選定していない。したがって「selected TLSNotary revisionが仕様不適合」とは記録せず、「今回レビューした候補が現行仕様のP0-03を満たさず、選定revisionは存在しない」と記録する。候補の16-byte ID観測だけからFUSOUのliteral `N`を16へ変更してはならない。

## パッケージとfeature metadata

観測commitにおけるCargo metadataは次のとおりである。

| パッケージ | version | 関連feature |
| --- | --- | --- |
| `tlsn` | `0.1.0-alpha.16-pre` | default `rayon`, `hash-blake3`; optional `mozilla-certs`, `web` |
| `tlsn-attestation` | `0.1.0-alpha.16-pre` | default empty; `fixtures` enables core fixtures and data fixtures |
| `tlsn-core` | `0.1.0-alpha.16-pre` | default empty; `fixtures`, `mozilla-certs`, `rstest` |
| `tlsn-sdk-core` | `0.1.0-alpha.16-pre` | default empty; `mozilla-certs`, `wasm` |

lockfileには`bcs 0.1.6`、`bincode 1.3.3`、workspaceのTLSNotary packagesが含まれる。upstream workspaceは、`tlsn-utils`をrevision `64722f7`、`mpz`を`v0.1.0-alpha.6`とする複数のgit dependencyをpinnedしている。これはupstreamの観測結果であり、FUSOUのdependency lockではない。

upstreamの`tlsn`と`tlsn-core` package manifestは`MIT OR Apache-2.0`を宣言している。`tlsn-attestation` manifestにはpackage-level license fieldがなく、このcommitで調査したrepository treeにはrootの`LICENSE`、`SECURITY`、`NOTICE` fileがない。したがってP0-01には完全な法務・security reviewがまだ必要である。

## P0-02: Attestation IDの確認

観測commitでは次のとおりである。

- `crates/attestation/src/lib.rs`は`Uid`を`pub struct Uid(pub [u8; 16]);`として定義する。
- `Header`は`pub id: Uid`を持つ。
- `Attestation`は`pub header: Header`を持つ。
- `Attestation::header()` accessorはなく、sourceはpublic field形式の`attestation.header`を使う。
- `AttestationBuilder::build`はrandomな`Uid`実装でIDを生成する。
- Attestation headerはNotary signatureの前にcrate内部のcanonical serializerでserializeされる。

これは候補fieldの幅が16 bytesで、利用可能なpublic field pathがあることを示す。しかしFUSOUの`N`を凍結するものではない。候補revisionは採用されておらず、FUSOUのgolden bytesもcommitされていない。また、現行仕様の`Attestation.header().id`という記述はこのsource APIと一致しない。source/inventoryで不充足が確定しているため、P0-02はruntime待ちの`BLOCKED`ではなく`FAIL`とする。

commit `0fe3c32d35382b3f290a43c4156399ca4512bb89`における関連source path:

```text
crates/attestation/src/lib.rs:255-257   Uid([u8; 16])
crates/attestation/src/lib.rs:321-329   Header.id
crates/attestation/src/lib.rs:436-444   Attestation.header
crates/attestation/src/serialize.rs:9-17 canonical BCS serialization
crates/attestation/src/builder.rs:124-185 header construction and signature input
```

## P0-03: authenticated timeの確認

候補はNotary-issuedな`notary_time` fieldを提供しない。

- `crates/core/src/connection.rs`は`ConnectionInfo.time`をTLS connectionが開始した時刻のUNIX timeとして説明する。
- `crates/core/src/transcript/tls.rs`はこの値をconnectionの開始時刻として公開する。
- `crates/core/src/transcript/tls/builder.rs`は`TlsTranscriptBuilder::time(u64)`でこの値を受け取る。
- `crates/tlsn/src/proxy.rs`は最初のbytesを読み取った時に、local system clockからfirst-read timeを設定する。
- upstream attestation exampleはAttestationを送る前に、`time: tls_transcript.time()`を使ってsigned `ConnectionInfo`を構築する。

この値はbody Merkle rootとsigned headerを通じてsigned attestation bodyに含まれる。しかしauthenticatedな意味はconnection-start timeであり、Notary issuance timeではない。verifier-sideまたはclient-sideで置き換えることは現行FUSOU仕様に違反する。したがってこの候補のP0-03は`FAIL`であり、別revision/design decisionとtamper fixtureなしに候補を承認できない。

正確なsource pathと観測行:

```text
crates/core/src/connection.rs:240-248              ConnectionInfo.time semantics
crates/core/src/transcript/tls.rs:38-47            TlsTranscript::time start-time getter
crates/core/src/transcript/tls/builder.rs:26-46     caller-supplied time field
crates/tlsn/src/proxy.rs:151-166                   first-read local clock capture
crates/examples/attestation/prove.rs:368-384       Notary copies tls_transcript.time()
```

## binding、range、one-requestの境界

alpha.15とmainの `ProveConfigBuilder` は `reveal_sent`、`reveal_recv`、およびdirection付き`reveal`を公開し、内部では`RangeSet<usize>`をunionする。したがってFUSOUの3つの送信rangeと1つの受信rangeを表現するデータ構造上の余地はある。しかしupstreamは次を定義しない。

- HTTP/1.1 request line、Host、`X-FUSOU-Attestation-Binding`の構文・位置・cardinality。
- FUSOUのstrict response parser、full response digest、Result schema。
- application writeが1回だけであること、redirect/retry/reconnectionがないこと。
- FUSOUの`BEFORE_APPLICATION_SEND -> SEND_COMMITTED -> RESPONSE_AVAILABLE -> COMPLETE` state machine。

mainの`crates/tlsn/tests/closure.rs`はTLS close_notify、abrupt close、fatal alert時のMPC-TLS finalizationを検査するが、Game Serverのwrite counterやFUSOU fallbackを検査しない。よってP0-05は「RangeSetが存在する」というsource factだけでPASSにせず、P0-06/P0-07とともにFUSOU fixture/runtime evidenceを待つ。one-request-per-MPC-sessionはupstream factではなく、FUSOU transport/state-machineの受入条件である。

## 数値根拠の分類

次の表はFinal Specification Section 5.1の`MAX_*`とrange count、および関連するPhase 0 acceptance thresholdの根拠分類である。`RATIONALE REQUIRED`は値を否定する判定ではなく、protocol仕様・resource安全性・実測値のどれに基づくかを独立証拠で補う必要があることを示す。未裏付けの値を実装へ確定してはならない。

| 値 | 分類 | 根拠状態 |
| --- | --- | --- |
| `MAX_VERIFIER_RESULT_JSON_BYTES = 25165824` | resource / security limit candidate | `RATIONALE REQUIRED`。upstream protocol由来またはFUSOU実測由来の証拠なし |
| `MAX_REQUEST_TRANSCRIPT_BYTES = 512000` | parser / resource limit candidate | `RATIONALE REQUIRED`。500 KiB境界は仕様上の受入値だが、capture実測との対応なし |
| `MAX_RESPONSE_TRANSCRIPT_BYTES = 16777216` | parser / privacy / resource limit candidate | `RATIONALE REQUIRED`。16 MiB境界の外部根拠なし |
| `MAX_HTTP_HEADER_BYTES = 65536` | parser / resource limit candidate | `RATIONALE REQUIRED` |
| `MAX_HTTP_HEADER_COUNT = 128` | parser / resource limit candidate | `RATIONALE REQUIRED` |
| `MAX_DECOMPRESSED_BODY_BYTES = 16777216` | decompression resource / security limit candidate | `RATIONALE REQUIRED` |
| `MAX_JSON_DEPTH = 64` | parser resource / denial-of-service limit candidate | `RATIONALE REQUIRED` |
| `MAX_GAME_JSON_STRING_BYTES = 1048576` | application parser / resource limit candidate | `RATIONALE REQUIRED` |
| `MAX_VERIFIER_JSON_STRING_BYTES = 33554432` | Result parser / resource limit candidate | `RATIONALE REQUIRED` |
| `MAX_CHALLENGE_BODY_BYTES = 33558528` | implementation-derived formula | `MAX_VERIFIER_RESULT_JSON_BYTES`、base64 overhead、4096からの算術導出は確認できるが、親limitの根拠は`RATIONALE REQUIRED` |
| `REQUEST_RANGE_COUNT = 3` | specification / security-derived | request line、Host、binding headerだけをsafe rangeとして開示するv1 privacy ruleに基づく。upstream protocolの値ではない |
| `RESPONSE_RANGE_COUNT = 1` | specification / correctness-derived | partial responseのJSON解釈を避けるfull response ruleに基づく。upstream protocolの値ではない |
| paired runs `1000`、added latency P95 `300 ms` | empirical acceptance threshold | 実測reportが未取得。thresholdの採用根拠と結果はP0-08で検証する |
| future skew `60 s` | security / operational acceptance policy | 全validator共通ruleとして設計済みだが、negative/positive fixtureはP0-16待ち |

`N`は候補観測値ではなく、選定revisionのcanonical extractionとgolden bytesから決めるprotocol/profile inputであり、現時点は未確定である。

## lifecycle、transcript、serializationの確認

upstream attestation exampleは次の順序で動作する。

1. ProverがMPC-TLS sessionを実行し、HTTP transcriptをparseする。
2. Proverが選択したtranscript rangesをcommitし、Proverをcloseする。
3. ProverがAttestation Requestを`bincode`でserializeし、Notaryへ送る。
4. NotaryがMPC sessionをverify/acceptし、Verifierをcloseし、Attestationをbuildして、`bincode`でserializeする。
5. ProverがAttestationをdeserializeし、Requestに対してvalidateし、Presentationをbuildできる。

候補のtranscript modelはsentとreceivedの2つのbyte vectorである。Selective disclosureは`RangeSet<usize>` rangesを使い、transcriptのtotal lengthを常に保持する。upstream library自身はraw transcriptにHTTP request/response semanticsを付けず、そのsemanticsはHTTP format parserとcommitterで復元される。これだけではFUSOUの`require_info` framing、binding-header position、range cardinality、strict parser contractを証明できない。

候補は内部canonical signature inputにBCSを使い、exampleのrequest/attestation transportにbincodeを使う。FUSOUのcanonical Verifier ResultとClaimBindingBytesはこのupstream sourceにはなく、別途Rust/TypeScript fixtureが必要である。

## 実行したvalidation

最初にrequired featureなしで実行したAPI testは、`api` targetが`fixtures`を必要とするためCargoに拒否された。featureを追加したnarrow testは成功した。

```text
cargo test -p tlsn-attestation --features fixtures --test api test_api -- --exact

running 1 test
test test_api ... ok

 test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

これはupstream fixture API pathのみをvalidateする。FUSOU profile、Game capture、Dedicated Verifier、delivery path、production gateはvalidateしない。

## 実行したFUSOU primitive fixture

local fixture `packages/FUSOU-WEB/supabase/tests/tlsn_identity_spec_primitives.sql`を、この調査中にFinal Specificationが参照するimmutable image digestに対して独立して再実行した。

```text
postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
```

観測結果:

```text
PASS: UInt64, four lock domains, and seven FK constraints including NULL semantics
server_version_num: 160015
server_version: PostgreSQL 16.15 on x86_64-pc-linux-musl
ROLLBACK
```

このfixtureはprimitive UInt64 checks、4つのadvisory lock domains、7つのforeign-key dependency casesを対象とする。repositoryのSupabase ignore ruleによりignoreされるworktree fileであり、checked-in target migrationまたはproduction inventoryではない。したがってこの結果はprimitive-fixture evidenceに限られる。production server/extensions、immutable target image、target migration、complete migration suiteが記録されて成功するまで、P0-11は`BLOCKED`のままとする。

## source fingerprints

調査したsource fileのSHA-256:

| path | SHA-256 |
| --- | --- |
| `crates/attestation/src/lib.rs` | `be78d7e5335170398141ba1d2b6dba3b516179071bd049d4088139d73b027a0b` |
| `crates/attestation/src/builder.rs` | `08851ea15be6c6b9ab241c9518d9c8c98b6f4a64fcd35cc329ce3c86495610f0` |
| `crates/attestation/src/presentation.rs` | `0d03f8373ac9e6b7e03c1cc830e7c34c81a64ed47c1316363cb89c915c761de2` |
| `crates/attestation/src/serialize.rs` | `ec69c500a5da3f4a7de826cd964dc5fa7a18497857536b91e2ab0e92cbff1f05` |
| `crates/core/src/connection.rs` | `285b3510bf9092ce87a238ca749de6b68d98a74c2f1784ddf7f45e4ffa54a461` |
| `crates/core/src/transcript/tls/builder.rs` | `60968e4fe25e3b4d1c9d0f4607aab972b639d598511850962ad8773787117d3b` |
| `crates/tlsn/src/proxy.rs` | `8ec2bb0808730e1f4976d616253bdd7d7673b536684f99d174571f68dcb6494c` |
| `crates/examples/attestation/prove.rs` | `7f913bc5d63e05214d281ae38531c8cea8acc219fb713f4d798e9524d05dcaa5` |

## FUSOU inventoryの範囲

このレポートのために実施したrepository inventoryでは、検索したpackage manifestsとsource pathsにconcreteなTLSNotary runtime dependencyまたはimplementationはなく、このレポート以前の`docs/security/evidence/` artifactもなく、TLSNotary profile、registry、golden fixture、production preflight、storage epoch manifestも見つからなかった。Wranglerはlocalにinstallされていない。local PostgreSQL clientの利用可能性とupstream sourceへの到達可能性は観測結果にすぎず、どちらもproduction evidenceではない。

この調査ではruntime code、migration、credential、production resource、無関係なworktree changeを変更していない。

## 攻撃別の再監査

次の監査は、Phase 0の分類更新後もsecurity contractを弱めていないことを確認するためのものである。`設計維持`は仕様上の拒否条件が残っていること、`実測`はruntime/production evidenceが未取得であることを示す。設計をPASSとして実装済みと扱わない。

| 対象 | 設計判定 | 実測状態 |
| --- | --- | --- |
| Proof Copy Attack | `MUST-REJECT`を維持 | runtime evidence pending |
| Cross-user Claim | user/device root不一致を拒否 | claim concurrency fixture pending |
| Cross-device Claim | device key不一致を拒否 | device attribution fixture pending |
| Session substitution | Session/nonce/value不一致を拒否 | Result delivery fixture pending |
| Challenge substitution | Challenge/Session/Attestationの一意性を要求 | consume-once runtime fixture pending |
| Binding substitution | authenticated transcriptのbinding headerとimmutable Sessionを一致させる | strict disclosure fixture pending |
| Result substitution | Verifier signature、profile、key registry、Session fieldsを一致させる | Result byte-path fixture pending |
| Replay | Challenge CASとterminal Session再利用禁止 | runtime replay fixture pending |
| Concurrent Claim | lock orderとChallenge CASを要求 | concurrency suite pending |
| Session issuance race | user/device lock下で一意性を要求 | runtime race fixture pending |
| Session expiry race | transaction-wide `v_db_now`で判定 | database/runtime suite pending |
| Challenge expiry race | expiryとconsumeの順序を固定 | database/runtime suite pending |
| Device revoke race | Identity/device lockとfail-closed registryを要求 | revoke rehearsal pending |
| Cleanup race | retained row、FK、single-Challenge cleanupをlock下で処理 | cleanup suite pending |
| Registry compromise | edge block、drain、REVOKED、digest一致後に再開 | production rehearsal pending |
| Verifier compromise | issuance/ingestをfail closedし、affected keyをreject | production rehearsal pending |
| Game Server request re-submission | send後の再送を`MUST NOT`とする | P0-07 counters pending |
| caller boundary | authenticated FUSOU-WEB Claim handlerだけをproduction callerとする | P0-13 deployment evidence pending |
| selected revision guarantee | 選定revisionなし。レビュー候補はP0-03 FAIL | selected revision/profile未確定 |

この再監査の結果、Proof Copyの`MUST-REJECT`、Primary Security Goal、no Game Server request re-submissionを候補のAPI不足やPhase 0未取得を理由に弱める変更はない。

## gate判定

machine-readableなstatus ledgerは[tlsn-phase0-gate-ledger-v1.json](tlsn-phase0-gate-ledger-v1.json)である。現在の集計は次のとおりである。

```text
PASS: 0
FAIL: 3
BLOCKED: 14
Phase 0: NO-GO (0/17 PASS)
Implementation: NO-GO
Proof Copy: MUST-REJECT unchanged
```
