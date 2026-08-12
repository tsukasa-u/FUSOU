import { describe, expect, it } from "vitest";
import { scanLocalDirectoryHandle, scanLocalFileList } from "../manifest-scanner";

type FakeFile = File & { webkitRelativePath?: string };

function fakeFile(name: string, size = 12, lastModified = 100): FakeFile {
  const file = new File([new Uint8Array(size)], name, { lastModified }) as FakeFile;
  return file;
}

function fakeFileHandle(file: File) {
  return {
    kind: "file" as const,
    name: file.name,
    getFile: async () => file,
  } as unknown as FileSystemFileHandle;
}

function fakeDirectoryHandle(
  name: string,
  children: Array<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>,
) {
  return {
    kind: "directory" as const,
    name,
    entries: async function* () {
      yield* children;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe("local AVRO manifest scanner", () => {
  it("recursively scans transaction and master AVRO with relative paths", async () => {
    const battle = fakeFile(
      "1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro",
    );
    const master = fakeFile("mst_ships.avro", 20, 200);
    const root = fakeDirectoryHandle("fusou", [
      [
        "2026-02-13",
        fakeDirectoryHandle("2026-02-13", [
          ["master_data", fakeDirectoryHandle("master_data", [[master.name, fakeFileHandle(master)]])],
          [
            "transaction_data",
            fakeDirectoryHandle("transaction_data", [
              [
                "6-5",
                fakeDirectoryHandle("6-5", [
                  ["battle", fakeDirectoryHandle("battle", [[battle.name, fakeFileHandle(battle)]])],
                ]),
              ],
            ]),
          ],
        ]),
      ],
      ["ignored.txt", fakeFileHandle(fakeFile("ignored.txt"))],
    ]);

    const result = await scanLocalDirectoryHandle(root);

    expect(result.fileCount).toBe(2);
    expect(result.manifest.entries.map((entry) => entry.relativePath)).toEqual([
      "fusou/2026-02-13/master_data/mst_ships.avro",
      "fusou/2026-02-13/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro",
    ]);
    expect(result.manifest.entries[1]?.handle).toBeDefined();
    expect(result.manifest.entries[0]?.handle).toBeDefined();
    expect(result.manifest.entries[0]?.file).toBeUndefined();
    expect(result.manifest.entries[0]?.relativePath).not.toMatch(/^\//);
    expect(result.manifest.entries[0]?.relativePath).not.toContain("..");
  });

  it("accepts webkitdirectory paths without absolute filesystem paths", async () => {
    const file = fakeFile("battle.avro") as FakeFile;
    file.webkitRelativePath =
      "fusou/2026-02-13/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro";

    const result = await scanLocalFileList([file]);

    expect(result.manifest.entries[0]?.relativePath).toBe(file.webkitRelativePath);
    expect(result.manifest.entries[0]?.relativePath).not.toMatch(/^\//);
  });

  it("fails closed when a file exceeds the browser reader limit", async () => {
    const file = fakeFile("battle.avro", 256 * 1024 * 1024 + 1) as FakeFile;
    file.webkitRelativePath =
      "fusou/2026-02-13/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro";

    await expect(scanLocalFileList([file])).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("stops immediately when a directory file loses read permission", async () => {
    const file = fakeFile("1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro");
    const deniedFile = {
      kind: "file" as const,
      name: file.name,
      getFile: async () => {
        throw new Error("permission lost");
      },
    } as unknown as FileSystemFileHandle;
    const root = fakeDirectoryHandle("fusou", [
      [
        "2026-02-13",
        fakeDirectoryHandle("2026-02-13", [
          [
            "transaction_data",
            fakeDirectoryHandle("transaction_data", [
              [
                "6-5",
                fakeDirectoryHandle("6-5", [
                  ["battle", fakeDirectoryHandle("battle", [[file.name, deniedFile]])],
                ]),
              ],
            ]),
          ],
        ]),
      ],
    ]);

    await expect(scanLocalDirectoryHandle(root)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});