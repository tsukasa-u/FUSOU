
import { S3Client, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET || "dev-kc-battle-data";

async function restoreObject(compactedPath, originalPath, orphanPath) {
  console.log(`Restoring ${compactedPath} -> ${originalPath}...`);
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${compactedPath}`,
    Key: originalPath,
  }));
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: compactedPath,
  }));
  if (orphanPath) {
    console.log(`Deleting orphan ${orphanPath}...`);
    try {
      await s3.send(new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: orphanPath,
      }));
    } catch {}
  }
  console.log(`Done restoring ${originalPath}`);
}

async function main() {
  // 1. Restore 2026-09-10 airbase_airattack
  await restoreObject(
    "compacted/0.6.0/2026-09-10/period/1792454400-3990124b3e91/airbase_airattack-001.avro",
    "0.6.0/2026-09-10/period/1792454400-3990124b3e91/airbase_airattack-001.avro",
    "0.6.0/2026-09-10/period/9007199254740-754c44fb255e/airbase_airattack-001.avro"
  );

  // 2. Restore 2026-08-05 airbase
  await restoreObject(
    "compacted/0.6.0/2026-08-05/period/1792454400-3990124b3e91/airbase-001.avro",
    "0.6.0/2026-08-05/period/1792454400-3990124b3e91/airbase-001.avro",
    "0.6.0/2026-08-05/period/9007199254740-754c44fb255e/airbase-001.avro"
  );
}
main().catch(console.error);
