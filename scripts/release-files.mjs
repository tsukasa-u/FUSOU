import { constants } from "node:fs";
import { open } from "node:fs/promises";

export async function readRegularFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error("release input/output must be a regular file");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
