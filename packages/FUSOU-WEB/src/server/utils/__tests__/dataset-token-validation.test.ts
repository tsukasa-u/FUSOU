import { describe, expect, it } from "vitest";
import {
  generateSignedToken,
  validateDatasetToken,
  validateDatasetTokenWithConstraints,
} from "../../utils";

const secret = "x".repeat(32);

async function issueDatasetTokenPayload(payload: Record<string, unknown>) {
  return generateSignedToken(
    {
      typ: "dataset",
      sub: "user-1",
      dataset_id: "a".repeat(64),
      aud: "fusou-upload",
      ...payload,
    },
    secret,
    60,
  );
}

describe("dataset token trust_tag policy", () => {
  it("accepts unverified trust_tag for non-hardware devices", async () => {
    const token = await issueDatasetTokenPayload({ trust_tag: "unverified" });

    const validated = await validateDatasetToken(token, secret);
    expect(validated).not.toBeNull();
    expect(validated?.trust_tag).toBe("unverified");

    const constrained = await validateDatasetTokenWithConstraints({ token, secret });
    expect(constrained.ok).toBe(true);
    expect(constrained.token?.trust_tag).toBe("unverified");
  });

  it("accepts suspicious trust_tag", async () => {
    const token = await issueDatasetTokenPayload({ trust_tag: "suspicious" });

    const validated = await validateDatasetToken(token, secret);
    expect(validated).not.toBeNull();
    expect(validated?.trust_tag).toBe("suspicious");
  });

  it("rejects dataset token without trust_tag claim", async () => {
    const token = await issueDatasetTokenPayload({});

    const validated = await validateDatasetToken(token, secret);
    expect(validated).toBeNull();
  });

  it("rejects dataset token with unknown trust_tag", async () => {
    const token = await issueDatasetTokenPayload({ trust_tag: "legacy" });

    const validated = await validateDatasetToken(token, secret);
    expect(validated).toBeNull();
  });
});
