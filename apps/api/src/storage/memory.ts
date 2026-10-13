import type { Storage, StoredObject, UploadSlot } from "./index.js";

/** In-memory fake for tests. `put` simulates the browser finishing an upload. */
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, StoredObject & { lastModified: Date }>();
  readonly presigned: UploadSlot[] = [];
  healthy = true;

  put(
    key: string,
    size: number,
    contentType: string | undefined = "image/jpeg",
    lastModified = new Date(),
  ) {
    this.objects.set(key, { size, contentType, lastModified });
  }

  async presignUpload(slot: UploadSlot) {
    this.presigned.push(slot);
    return `https://s3.test/${slot.key}?signed=1`;
  }

  async presignDownload(key: string) {
    return `https://s3.test/${key}?download=1`;
  }

  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.size, contentType: o.contentType } : null;
  }

  async *list(prefix: string) {
    for (const [key, o] of [...this.objects].sort(([a], [b]) => a.localeCompare(b)))
      if (key.startsWith(prefix)) yield { key, lastModified: o.lastModified };
  }

  async delete(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }

  async ping() {
    return this.healthy;
  }
}
