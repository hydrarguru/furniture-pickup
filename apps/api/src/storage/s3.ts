import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Storage, StoredObject, UploadSlot } from "./index.js";

export interface S3Config {
  /** Internal endpoint the API talks to, e.g. http://127.0.0.1:3900 */
  endpoint: string;
  /** Endpoint the browser can reach, e.g. https://s3.example.se. Defaults to `endpoint`. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3Storage implements Storage {
  private readonly internal: S3Client;
  /** Presigned URLs embed the host, so they must be signed against the public endpoint. */
  private readonly external: S3Client;

  constructor(private readonly config: S3Config) {
    const base = {
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true, // Garage serves buckets by path
      // Avoid SDK-added checksum headers/params that a browser PUT would not send.
      requestChecksumCalculation: "WHEN_REQUIRED" as const,
      responseChecksumValidation: "WHEN_REQUIRED" as const,
    };
    this.internal = new S3Client({ ...base, endpoint: config.endpoint });
    this.external = new S3Client({ ...base, endpoint: config.publicEndpoint ?? config.endpoint });
  }

  presignUpload(slot: UploadSlot, expiresInSeconds: number) {
    return getSignedUrl(
      this.external,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: slot.key,
        ContentType: slot.contentType,
        ContentLength: slot.size,
      }),
      {
        expiresIn: expiresInSeconds,
        // Force these into the signature so the upload cannot differ from what was approved.
        signableHeaders: new Set(["content-type", "content-length"]),
      },
    );
  }

  presignDownload(key: string, expiresInSeconds: number) {
    return getSignedUrl(
      this.external,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const r = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { size: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async delete(keys: string[]) {
    // DeleteObjects accepts at most 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      const Objects = keys.slice(i, i + 1000).map((Key) => ({ Key }));
      await this.internal.send(
        new DeleteObjectsCommand({ Bucket: this.config.bucket, Delete: { Objects, Quiet: true } }),
      );
    }
  }

  async *list(prefix: string) {
    let ContinuationToken: string | undefined;
    do {
      const page = await this.internal.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, ContinuationToken }),
      );
      for (const o of page.Contents ?? [])
        if (o.Key && o.LastModified) yield { key: o.Key, lastModified: o.LastModified };
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }

  async ping() {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
