
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function listPeriod(prefix) {
  let continuationToken = undefined;
  const files = [];
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET || "dev-kc-battle-data",
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));
    for (const c of (res.Contents || [])) {
      files.push(c.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  return files;
}

async function main() {
  for (const period of ["2026-08-05", "2026-09-10", "2026-10-14"]) {
    const active = await listPeriod(`0.6.0/${period}/period/`);
    const comp = await listPeriod(`compacted/0.6.0/${period}/period/`);
    console.log(`=== ${period} ===`);
    console.log(`  Active files (${active.length}):`);
    active.forEach(f => console.log("   ", f));
    if (comp.length > 0) {
      console.log(`  Compacted files (${comp.length}):`);
      comp.forEach(f => console.log("   ", f));
    }
  }
}
main().catch(console.error);
