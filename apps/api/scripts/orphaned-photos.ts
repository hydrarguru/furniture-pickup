// Lists photos in storage that no request or pending upload refers to; deletes them with --delete.
// The API also does this hourly for photos older than 24 hours.
//   pnpm --filter @hamtning/api orphaned-photos                      # report only
//   pnpm --filter @hamtning/api orphaned-photos --delete             # delete (older than 24 h)
//   pnpm --filter @hamtning/api orphaned-photos --delete --min-age-hours=0
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { loadEnv } from "../src/env.js";
import { ORPHAN_MIN_AGE_MS, sweepOrphanedPhotos } from "../src/retention/orphans.js";
import { S3Storage } from "../src/storage/s3.js";

const args = process.argv.slice(2);
const remove = args.includes("--delete");
const hoursArg = args.find((a) => a.startsWith("--min-age-hours="))?.split("=")[1];
const minAgeMs = hoursArg !== undefined ? Number(hoursArg) * 3600_000 : ORPHAN_MIN_AGE_MS;
if (!Number.isFinite(minAgeMs) || minAgeMs < 0) {
  console.error("--min-age-hours must be a number >= 0");
  process.exit(1);
}

const env = loadEnv();
const { sqlite, db } = openDatabase(env.DATABASE_PATH);
runMigrations(db);
const storage = new S3Storage({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
});

const result = await sweepOrphanedPhotos({ db, storage }, { minAgeMs, dryRun: !remove });
console.log(`Database: ${env.DATABASE_PATH}`);
console.log(
  `Scanned ${result.scanned} photos in ${env.S3_BUCKET}; ${result.orphans.length} not referenced (older than ${minAgeMs / 3600_000} h).`,
);
for (const key of result.orphans) console.log(`  ${key}`);
if (remove) console.log(`Deleted ${result.deleted}.`);
else if (result.orphans.length > 0)
  console.log("Nothing deleted. Re-run with --delete to remove them.");
sqlite.close();
