// Allows the web app to PUT photos straight to the bucket with presigned URLs.
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import { loadEnv } from "../src/env.js";

const env = loadEnv();
/** Comma-separated origins allowed besides APP_ORIGIN, e.g. localhost while testing from a phone. */
const extraOrigins = process.env.CORS_EXTRA_ORIGINS?.split(",").filter(Boolean) ?? [];
const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

await client.send(
  new PutBucketCorsCommand({
    Bucket: env.S3_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [env.APP_ORIGIN, ...extraOrigins],
          AllowedMethods: ["PUT"],
          AllowedHeaders: ["content-type"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
const { CORSRules } = await client.send(new GetBucketCorsCommand({ Bucket: env.S3_BUCKET }));
console.log(`CORS on ${env.S3_BUCKET}:`, JSON.stringify(CORSRules));
