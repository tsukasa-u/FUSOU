
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  await s3.send(new DeleteObjectsCommand({
    Bucket: process.env.R2_BUCKET || "dev-kc-battle-data",
    Delete: {
      Objects: [
        { Key: "snapshots/overview/2026-10-14/latest.json.br" },
        { Key: "snapshots/drops/2026-10-14/latest.json.br" }
      ]
    }
  }));
  console.log("Deleted old latest.json.br files");
}
main();
