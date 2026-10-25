
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
  let allKeys = [];
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET || "dev-kc-battle-data",
      Prefix: "snapshots/",
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));
    const keys = (res.Contents || []).map(c => c.Key);
    allKeys = allKeys.concat(keys);
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  console.log("Total snapshot objects in R2:", allKeys.length);
  const byDir = new Map();
  for (const k of allKeys) {
    const parts = k.split("/");
    const dir = parts.slice(0, 3).join("/");
    byDir.set(dir, (byDir.get(dir) || 0) + 1);
  }
  for (const [dir, count] of byDir) {
    console.log(`  ${dir}: ${count} objects`);
  }
}
main().catch(console.error);
