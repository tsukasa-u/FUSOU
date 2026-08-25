import { describe, expect, it } from "vitest";
import { scanLocalDirectoryHandle, scanLocalFileList } from "../manifest-scanner";

type FakeFile = File & { webkitRelativePath?: string };

function fakeFile(name: string, size = 12, lastModified = 100, actualSize = size): FakeFile {
  const file = new File([new Uint8Array(actualSize)], name, { lastModified }) as FakeFile;
  if (actualSize !== size) Object.defineProperty(file, "size", { value: size });
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

  it("skips zero period and non-positive map paths", async () => {
    const validFile = fakeFile("valid.avro") as FakeFile;
    validFile.webkitRelativePath =
      "fusou/2026-02-13/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro";
    const zeroPeriodFile = fakeFile("zero-period.avro") as FakeFile;
    zeroPeriodFile.webkitRelativePath =
      "fusou/0/transaction_data/6-5/battle/1783429201_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro";
    const zeroMapFile = fakeFile("zero-map.avro") as FakeFile;
    zeroMapFile.webkitRelativePath =
      "fusou/2026-02-13/transaction_data/0-0/battle/1783429202_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro";

    const result = await scanLocalFileList([
      validFile,
      zeroPeriodFile,
      zeroMapFile,
    ]);

    expect(result.manifest.entries).toHaveLength(1);
    expect(result.manifest.entries[0]?.relativePath).toBe(
      validFile.webkitRelativePath,
    );
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === "INVALID_DIRECTORY_LAYOUT")).toBe(true);
  });

  it("fails closed when a file exceeds the browser reader limit", async () => {
    const file = fakeFile("battle.avro", 256 * 1024 * 1024 + 1) as FakeFile;
    file.webkitRelativePath =
      "fusou/2026-02-13/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro";

    await expect(scanLocalFileList([file])).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
  });

  it("fails closed when the selected files exceed the aggregate size limit", async () => {
    const files = Array.from({ length: 9 }, (_, index) => {
      const file = fakeFile(`battle-${index}.avro`, 230 * 1024 * 1024, 100, 1) as FakeFile;
      file.webkitRelativePath =
        `fusou/2026-02-13/transaction_data/6-5/battle/${1783429200 + index}_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro`;
      return file;
    });

    await expect(scanLocalFileList(files)).rejects.toMatchObject({
      code: "MANIFEST_SIZE_EXCEEDED",
    });
  });

  it("uses a caller-provided aggregate size limit", async () => {
    const file = fakeFile("battle.avro", 12, 100, 1) as FakeFile;
    file.webkitRelativePath =
      "fusou/2026-02-13/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro";

    await expect(
      scanLocalFileList([file], { limits: { maxManifestBytes: 1 } }),
    ).rejects.toMatchObject({ code: "MANIFEST_SIZE_EXCEEDED" });
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