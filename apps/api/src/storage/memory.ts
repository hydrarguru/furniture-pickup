import type { Storage, StoredObject, UploadSlot } from "./index.js";

/** In-memory fake for tests. `put` simulates the browser finishing an upload. */
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, StoredObject>();
  readonly presigned: UploadSlot[] = [];
  healthy = true;

  put(key: string, size: number, contentType: string | undefined = "image/jpeg") {
    this.objects.set(key, { size, contentType });
  }

  async presignUpload(slot: UploadSlot) {
    this.presigned.push(slot);
    return `https://s3.test/${slot.key}?signed=1`;
  }

  async presignDownload(key: string) {
    return `https://s3.test/${key}?download=1`;
  }

  async head(key: string) {
    return this.objects.get(key) ?? null;
  }

  async delete(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }

  async ping() {
    return this.healthy;
  }
}
