
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function deletePrefix(prefix) {
  let continuationToken = undefined;
  let deletedCount = 0;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET || "dev-kc-battle-data",
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));
    const objects = (res.Contents || []).map(c => ({ Key: c.Key }));
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: process.env.R2_BUCKET || "dev-kc-battle-data",
        Delete: { Objects: objects }
      }));
      deletedCount += objects.length;
      console.log(`Deleted ${objects.length} objects under ${prefix}`);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);
  console.log(`Total deleted under ${prefix}: ${deletedCount}`);
}

async function main() {
  await deletePrefix("snapshots/overview/latest");
  await deletePrefix("snapshots/drops/latest");
  await deletePrefix("snapshots/env_detail/latest");
  await deletePrefix("snapshots/detail/latest");
}
main().catch(console.error);
