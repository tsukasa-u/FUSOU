export const RUNTIME_CONFIG_MANIFEST_POINTER_KEY =
  "tlsn/runtime-config/v2/manifest.json";
const IMMUTABLE_MANIFEST_PREFIX = "tlsn/runtime-config/v2/manifests/";

export class RuntimeConfigR2ReleaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigR2ReleaseConflictError";
  }
}

export class RuntimeConfigR2ReleaseIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigR2ReleaseIntegrityError";
  }
}

export interface RuntimeConfigR2ReleaseState {
  readonly pointer: {
    readonly bytes: Uint8Array;
    readonly etag: string;
  } | null;
  readonly snapshotBytes: Uint8Array | null;
}

export interface RuntimeConfigR2ReleaseReadback {
  readonly pointerBytes: Uint8Array;
  readonly pointerEtag: string;
  readonly snapshotBytes: Uint8Array;
}

export class RuntimeConfigR2ReleaseStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async publishManifest(
    manifestRef: string,
    manifestBytes: Uint8Array,
    expectedPointerEtag: string,
  ): Promise<RuntimeConfigR2ReleaseReadback> {
    const snapshotKey = immutableManifestKey(manifestRef);
    await this.#ensureImmutableSnapshot(snapshotKey, manifestBytes);

    const putCall = this.#bucket.put(
      RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
      manifestBytes,
      {
        onlyIf:
          expectedPointerEtag.length === 0
            ? { etagDoesNotMatch: "*" }
            : { etagMatches: expectedPointerEtag },
      },
    );
    let putResult: R2Object | null = null;
    try {
      putResult = await putCall;
      if (putResult === null) {
        const current = await this.#readObject(
          RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
        );
        if (
          current === null ||
          !equalBytes(current.bytes, manifestBytes)
        ) {
          throw new RuntimeConfigR2ReleaseConflictError(
            "R2 pointer compare-and-swap did not publish the exact Manifest bytes",
          );
        }
      }

      const state = await this.readState(manifestRef);
      if (
        state.pointer === null ||
        state.snapshotBytes === null ||
        !equalBytes(state.pointer.bytes, manifestBytes) ||
        !equalBytes(state.snapshotBytes, manifestBytes)
      ) {
        throw new RuntimeConfigR2ReleaseIntegrityError(
          "R2 pointer and immutable Manifest snapshot readback differ from the publication bytes",
        );
      }
      if (
        putResult !== null &&
        state.pointer.etag !== putResult.etag
      ) {
        throw new RuntimeConfigR2ReleaseIntegrityError(
          "R2 pointer ETag changed before exact readback",
        );
      }
      return {
        pointerBytes: state.pointer.bytes,
        pointerEtag: state.pointer.etag,
        snapshotBytes: state.snapshotBytes,
      };
    } finally {
      disposeRpcResult(putResult);
      disposeRpcResult(putCall);
    }
  }

  async readState(manifestRef: string): Promise<RuntimeConfigR2ReleaseState> {
    const snapshotKey = immutableManifestKey(manifestRef);
    const [pointer, snapshot] = await Promise.all([
      this.#readObject(RUNTIME_CONFIG_MANIFEST_POINTER_KEY),
      this.#readObject(snapshotKey),
    ]);
    return {
      pointer,
      snapshotBytes: snapshot?.bytes ?? null,
    };
  }

  async readCurrentManifestPointer(): Promise<{
    readonly etag: string;
    readonly bytes: Uint8Array;
  } | null> {
    const pointer = await this.#readObject(RUNTIME_CONFIG_MANIFEST_POINTER_KEY);
    return pointer === null
      ? null
      : { etag: pointer.etag, bytes: pointer.bytes };
  }

  async readImmutableManifestSnapshot(
    reference: string,
  ): Promise<{ readonly reference: string; readonly bytes: Uint8Array } | null> {
    const snapshot = await this.#readObject(immutableManifestKey(reference));
    return snapshot === null
      ? null
      : { reference, bytes: snapshot.bytes };
  }

  async verifyExactReadback(input: {
    readonly manifestRef: string;
    readonly manifestBytes: Uint8Array;
    readonly pointerEtag: string;
  }): Promise<RuntimeConfigR2ReleaseReadback> {
    const state = await this.readState(input.manifestRef);
    if (
      state.pointer === null ||
      state.snapshotBytes === null ||
      state.pointer.etag !== input.pointerEtag ||
      !equalBytes(state.pointer.bytes, input.manifestBytes) ||
      !equalBytes(state.snapshotBytes, input.manifestBytes)
    ) {
      throw new RuntimeConfigR2ReleaseIntegrityError(
        "R2 pointer, ETag, or immutable snapshot does not match the committed Release",
      );
    }
    return {
      pointerBytes: state.pointer.bytes,
      pointerEtag: state.pointer.etag,
      snapshotBytes: state.snapshotBytes,
    };
  }

  async #ensureImmutableSnapshot(
    key: string,
    expectedBytes: Uint8Array,
  ): Promise<void> {
    const existing = await this.#readObject(key);
    if (existing !== null) {
      if (!equalBytes(existing.bytes, expectedBytes)) {
        throw new RuntimeConfigR2ReleaseIntegrityError(
          "Content-addressed R2 Manifest snapshot already contains different bytes",
        );
      }
      return;
    }

    const putCall = this.#bucket.put(key, expectedBytes, {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    let putResult: R2Object | null = null;
    try {
      putResult = await putCall;
      if (putResult !== null) return;

      const raced = await this.#readObject(key);
      if (raced === null || !equalBytes(raced.bytes, expectedBytes)) {
        throw new RuntimeConfigR2ReleaseIntegrityError(
          "Content-addressed R2 Manifest snapshot changed during publication",
        );
      }
    } finally {
      disposeRpcResult(putResult);
      disposeRpcResult(putCall);
    }
  }

  async #readObject(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly etag: string } | null> {
    const getCall = this.#bucket.get(key);
    let object: R2ObjectBody | null = null;
    try {
      object = await getCall;
      if (object === null) return null;
      if (!("body" in object) || object.body === undefined) {
        throw new RuntimeConfigR2ReleaseIntegrityError(
          "R2 returned object metadata without readable body bytes",
        );
      }
      if (typeof object.etag !== "string" || object.etag.length === 0) {
        throw new RuntimeConfigR2ReleaseIntegrityError(
          "R2 returned an invalid object ETag",
        );
      }
      return {
        bytes: new Uint8Array(await object.arrayBuffer()),
        etag: object.etag,
      };
    } finally {
      disposeRpcResult(object);
      disposeRpcResult(getCall);
    }
  }
}

function disposeRpcResult(value: object | null | undefined): void {
  if (value == null) return;
  const dispose = Reflect.get(value, Symbol.for("dispose"));
  if (typeof dispose === "function") {
    Reflect.apply(dispose, value, []);
  }
}

function immutableManifestKey(manifestRef: string): string {
  if (
    !manifestRef.startsWith(IMMUTABLE_MANIFEST_PREFIX) ||
    manifestRef.length === IMMUTABLE_MANIFEST_PREFIX.length
  ) {
    throw new RuntimeConfigR2ReleaseIntegrityError(
      "Release Manifest reference is outside the immutable R2 namespace",
    );
  }
  return manifestRef;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
