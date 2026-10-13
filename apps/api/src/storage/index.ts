export interface UploadSlot {
  key: string;
  contentType: string;
  size: number;
}

export interface StoredObject {
  size: number;
  contentType: string | undefined;
}

export interface Storage {
  /** URL the browser PUTs the file to. Content-Type and Content-Length are part of the signature. */
  presignUpload(slot: UploadSlot, expiresInSeconds: number): Promise<string>;
  /** Short-lived URL for staff to view a private image. */
  presignDownload(key: string, expiresInSeconds: number): Promise<string>;
  /** null when the object does not exist. */
  head(key: string): Promise<StoredObject | null>;
  /** Deleting a missing key is not an error. */
  delete(keys: string[]): Promise<void>;
  /** Every object under `prefix`, page by page (S3 returns at most 1000 per call). */
  list(prefix: string): AsyncIterable<{ key: string; lastModified: Date }>;
  /** Used by /api/health. */
  ping(): Promise<boolean>;
}
