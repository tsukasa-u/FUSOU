
import { runs } from "@trigger.dev/sdk/v3";

async function main() {
  const run = await runs.retrieve("run_06gn1r4jp8jvcmp3c6socfsva2");
  console.log("Run info:", JSON.stringify({
    id: run.id,
    status: run.status,
    error: run.error,
    tags: run.tags,
    metadata: run.metadata
  }, null, 2));
}
main();
