/**
 * 3-Tier Data Split (train / validation / test) assignment utility.
 *
 * Uses SHA-256 hash of env_uuid to deterministically assign sorties into:
 * - train (70%): Exploratory data analysis, hypothesis generation
 * - validation (20%): Hypothesis testing, parameter verification (logged access)
 * - test (10%): Private benchmark evaluation (internal access only)
 */

const DEFAULT_SALT = "FUSOU_DATASET_SPLIT_v1";

/**
 * Computes deterministic split for a given sortie env_uuid.
 *
 * @param envUuid The sortie environment UUID
 * @param salt Optional salt string for hash calculation
 * @returns "train" | "validation" | "test"
 */
export async function computeSplit(
  envUuid: string,
  salt: string = DEFAULT_SALT,
): Promise<"train" | "validation" | "test"> {
  const input = `${envUuid}:${salt}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  
  const view = new DataView(hashArray.buffer, hashArray.byteOffset, 4);
  const bucket = view.getUint32(0, false) % 100;

  if (bucket < 70) {
    return "train"; // 0-69 (70%)
  } else if (bucket < 90) {
    return "validation"; // 70-89 (20%)
  } else {
    return "test"; // 90-99 (10%)
  }
}