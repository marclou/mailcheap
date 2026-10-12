import "server-only";
import { randomBytes } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getAppUrl } from "@/lib/config";
import { buildMediaKey, getMediaUrl, MEDIA_CACHE_CONTROL } from "@/lib/media-keys";

// Optional S3-compatible storage for editor uploads (Garage, MinIO, R2, AWS S3), instead of Vercel Blob
// (see isS3Configured in lib/config.js). The bucket stays private: the app serves each picture at
// APP_URL/media/<key> (app/media/[...key]/route.js), so the URLs inside sent emails live on your own
// domain and never expire.

let client = null;

function getClient() {
	client ??= new S3Client({
		endpoint: process.env.S3_ENDPOINT,
		region: process.env.S3_REGION || "us-east-1",
		// Garage and MinIO want path-style URLs (endpoint/bucket/key).
		forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
		credentials: {
			accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
			secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
		},
	});
	return client;
}

export async function putS3Image(pathname, bytes, contentType) {
	const key = buildMediaKey(pathname, randomBytes(6).toString("hex"));
	await getClient().send(
		new PutObjectCommand({
			Bucket: process.env.S3_BUCKET,
			Key: key,
			Body: bytes,
			ContentType: contentType,
			CacheControl: MEDIA_CACHE_CONTROL,
		})
	);
	return getMediaUrl(getAppUrl(), key);
}

export async function getS3Image(key) {
	try {
		const object = await getClient().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
		return { body: object.Body.transformToWebStream(), length: object.ContentLength };
	} catch (error) {
		if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
		throw error;
	}
}
