
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  let continuationToken = undefined;
  const periodMap = new Map();
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET || "dev-kc-battle-data",
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));
    for (const c of (res.Contents || [])) {
      const k = c.Key;
      if (k.startsWith("snapshots/")) continue;
      // match version/period/tier/... or compacted/version/period/tier/...
      const m = k.match(/^(compacted\/)?([^\/]+)\/([^\/]+)\/([^\/]+)\//);
      if (m) {
        const isCompacted = !!m[1];
        const version = m[2];
        const period = m[3];
        const tier = m[4];
        const key = `${isCompacted ? "compacted/" : ""}${version} | ${period} | ${tier}`;
        periodMap.set(key, (periodMap.get(key) || 0) + 1);
      } else {
        const top = k.split("/").slice(0, 2).join("/");
        periodMap.set(`[other] ${top}`, (periodMap.get(`[other] ${top}`) || 0) + 1);
      }
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  console.log("=== R2 Storage Structure by Version / Period / Tier ===");
  for (const [k, count] of Array.from(periodMap.entries()).sort()) {
    console.log(`  ${k}: ${count} files`);
  }
}
main().catch(console.error);
