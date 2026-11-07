import type {
  ProductionFreshnessResponseSigner,
  ProductionReleaseAuthoritySigner,
  TestOnlyFreshnessResponseSigner,
  TestOnlyReleaseAuthoritySigner,
} from "../src/signers.ts";
import type { FreshnessIssueInput } from "../src/freshness-issue.ts";

// These expected errors keep the two test-only ports out of Production bindings.
declare const productionReleaseSigner: ProductionReleaseAuthoritySigner;
declare const productionFreshnessSigner: ProductionFreshnessResponseSigner;
declare const testReleaseSigner: TestOnlyReleaseAuthoritySigner;
declare const testFreshnessSigner: TestOnlyFreshnessResponseSigner;
declare const issueInput: FreshnessIssueInput;

// @ts-expect-error Release signers expose only typed append authorization.
productionReleaseSigner.sign(new Uint8Array());
// @ts-expect-error Freshness signers expose only challenge-bound issuance.
productionFreshnessSigner.sign(new Uint8Array());
// @ts-expect-error A caller-supplied state declaration is not an issuer input.
void issueInput.verifiedCurrentState;
// @ts-expect-error A test-only signer is not a Production signer.
const unsafeReleaseBinding: ProductionReleaseAuthoritySigner = testReleaseSigner;
// @ts-expect-error A test-only signer is not a Production signer.
const unsafeFreshnessBinding: ProductionFreshnessResponseSigner = testFreshnessSigner;

void unsafeReleaseBinding;
void unsafeFreshnessBinding;
