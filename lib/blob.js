import "server-only";
import { put } from "@vercel/blob";
import { isS3Configured, putS3Image } from "@/lib/s3-images";

// Sent emails point at these files forever, so their URLs never change and browsers can cache them for a year.
const ONE_YEAR = 365 * 24 * 60 * 60;

// S3-compatible storage (S3_ENDPOINT + S3_BUCKET) when set, Vercel Blob otherwise.
export function isImageStorageConfigured() {
	return isS3Configured() || Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function putImage(pathname, bytes, contentType) {
	if (isS3Configured()) return putS3Image(pathname, bytes, contentType);
	const blob = await put(pathname, bytes, {
		access: "public",
		contentType,
		addRandomSuffix: true,
		cacheControlMaxAge: ONE_YEAR,
	});
	return blob.url;
}
