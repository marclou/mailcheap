import "server-only";
import { randomBytes } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getAppUrl } from "@/lib/config";

// Optional S3-compatible storage for editor uploads (Garage, MinIO, R2, AWS S3), instead of Vercel Blob.
// The bucket stays private: the app serves each picture at APP_URL/media/<key>, so the URLs inside sent
// emails live on your own domain and never expire.

export const MEDIA_PATH = "/media/";
const ONE_YEAR = 365 * 24 * 60 * 60;
// Only what /api/uploads stores: images/<slug>-<random>.<extension>.
const KEY_PATTERN = /^images\/[a-z0-9-]{1,80}\.(png|jpg|gif|webp)$/;
const CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

let client = null;

export function isS3Configured() {
	return Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
}

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
	const dot = pathname.lastIndexOf(".");
	const key = `${pathname.slice(0, dot)}-${randomBytes(6).toString("hex")}${pathname.slice(dot)}`;
	await getClient().send(
		new PutObjectCommand({
			Bucket: process.env.S3_BUCKET,
			Key: key,
			Body: bytes,
			ContentType: contentType,
			CacheControl: `public, max-age=${ONE_YEAR}, immutable`,
		})
	);
	return `${getAppUrl()}${MEDIA_PATH}${key}`;
}

// The content type comes from the key's extension, never from the stored object, so this route can
// only ever answer with a picture.
export function getMediaContentType(key) {
	if (!KEY_PATTERN.test(key)) return null;
	return CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1)];
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

export const MEDIA_CACHE_CONTROL = `public, max-age=${ONE_YEAR}, immutable`;
