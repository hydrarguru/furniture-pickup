// Checks a restored copy (used by deploy/backup/restore-test.sh): the database is intact, and every
// photo it refers to exists in the restored storage with the right size. Exits 1 otherwise.
// Prints counts only, never personal data.
import { count } from "drizzle-orm";
import { openDatabase } from "../src/db/client.js";
import { cancellations, employees, images, requests } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { S3Storage } from "../src/storage/s3.js";

const env = loadEnv();
const { sqlite, db } = openDatabase(env.DATABASE_PATH);
const problems: string[] = [];

const integrity = sqlite.pragma("integrity_check", { simple: true });
if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);
const brokenRefs = (sqlite.pragma("foreign_key_check") as unknown[]).length;
if (brokenRefs > 0) problems.push(`${brokenRefs} broken foreign key reference(s)`);

const storage = new S3Storage({
  endpoint: env.S3_ENDPOINT,
  publicEndpoint: env.S3_PUBLIC_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});
const photos = db.select({ key: images.s3Key, size: images.sizeBytes }).from(images).all();
let missing = 0;
let wrongSize = 0;
for (const photo of photos) {
  const obj = await storage.head(photo.key);
  if (!obj) missing++;
  else if (obj.size !== photo.size) wrongSize++;
}
if (missing > 0) problems.push(`${missing} photo(s) missing from storage`);
if (wrongSize > 0) problems.push(`${wrongSize} photo(s) with the wrong size`);

const n = (table: typeof requests | typeof employees | typeof cancellations) =>
  db.select({ n: count() }).from(table).get()?.n ?? 0;
console.log(
  JSON.stringify({
    requests: n(requests),
    photos: photos.length,
    photosChecked: photos.length - missing - wrongSize,
    employees: n(employees),
    cancellations: n(cancellations),
  }),
);
sqlite.close();

if (problems.length > 0) {
  console.error(`Restore check FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("Restore check passed.");
