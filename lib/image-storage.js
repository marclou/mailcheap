import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Bucket, uniquePath } from "@upstash/blob";
import { del, put } from "@vercel/blob";

// Sent emails point at these files forever, so their names never change and browsers can cache them for a year.
const ONE_YEAR = 365 * 24 * 60 * 60;
const S3_REQUIRED = ["IMAGES_S3_ACCESS_KEY_ID", "IMAGES_S3_SECRET_ACCESS_KEY", "IMAGES_CDN_URL"];
const AWS_TIMEOUT_MS = 30_000;
// S3 deletes up to 1,000 keys a request.
const DELETE_BATCH = 1000;
// Every public Upstash Blob bucket serves its files from its own subdomain of this one.
const UPSTASH_BLOB_HOST = /^https:\/\/[a-z0-9-]+\.blob\.upstash\.io\//i;
let s3;
let cloudFront;
let upstash;

// New uploads go to the S3 bucket when there is one, served from its CDN, else to an Upstash Blob bucket, else to
// Vercel Blob. Images uploaded before stay where they are.
export function getImageStorage(env = process.env) {
	if (env.IMAGES_S3_BUCKET) return "s3";
	if (env.UPSTASH_BLOB_TOKEN) return "upstash";
	return env.BLOB_READ_WRITE_TOKEN ? "blob" : null;
}

export function getImageStorageProblem(env = process.env) {
	const storage = getImageStorage(env);
	if (!storage) {
		return "Image uploads need an S3 bucket (IMAGES_S3_BUCKET), an Upstash Blob bucket (UPSTASH_BLOB_TOKEN) or a Vercel Blob store (BLOB_READ_WRITE_TOKEN)";
	}
	if (storage !== "s3") return null;
	const missing = S3_REQUIRED.filter((name) => !env[name]);
	if (missing.length > 0) {
		return `IMAGES_S3_BUCKET is set, so ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} to be set too`;
	}
	return /^https:\/\/[^/]+/.test(env.IMAGES_CDN_URL) ? null : "IMAGES_CDN_URL must be an https:// URL";
}

export async function putImage(pathname, bytes, contentType) {
	const storage = getImageStorage();
	if (storage === "s3") return putS3Image(pathname, bytes, contentType);
	if (storage === "upstash") return putUpstashImage(pathname, bytes, contentType);
	const blob = await put(pathname, bytes, {
		access: "public",
		contentType,
		addRandomSuffix: true,
		cacheControlMaxAge: ONE_YEAR,
	});
	return { url: blob.url, pathname: blob.pathname };
}

// Only these keys: never the default AWS chain (~/.aws, instance roles), which could belong to another AWS
// account. Vercel reserves the AWS_* names, and SES has its own.
function getCredentials() {
	return {
		accessKeyId: process.env.IMAGES_S3_ACCESS_KEY_ID,
		secretAccessKey: process.env.IMAGES_S3_SECRET_ACCESS_KEY,
	};
}

function getS3() {
	s3 ??= new S3Client({
		region: process.env.IMAGES_S3_REGION || "us-east-1",
		credentials: getCredentials(),
	});
	return s3;
}

// CloudFront's API is global and signs in us-east-1, whatever the bucket's region.
function getCloudFront() {
	cloudFront ??= new CloudFrontClient({ region: "us-east-1", credentials: getCredentials() });
	return cloudFront;
}

// A random part before the extension, like Vercel Blob's suffix, so an upload never replaces another.
async function putS3Image(pathname, bytes, contentType) {
	const key = pathname.replace(/(?=\.[a-z0-9]+$)|$/i, `-${randomBytes(8).toString("hex")}`);
	const command = new PutObjectCommand({
		Bucket: process.env.IMAGES_S3_BUCKET,
		Key: key,
		Body: bytes,
		ContentType: contentType,
		CacheControl: `public, max-age=${ONE_YEAR}, immutable`,
	});
	await getS3().send(command, { abortSignal: AbortSignal.timeout(AWS_TIMEOUT_MS) });
	return { url: `${getCdnUrl()}/${key}`, pathname: key };
}

// The token is the bucket's only key, read here alone, never from a browser.
function getUpstash() {
	upstash ??= new Bucket({ token: process.env.UPSTASH_BLOB_TOKEN, enableTelemetry: false });
	return upstash;
}

// A random part before the extension, like the others, and never over a file that's there. Only a public bucket gives
// files a URL, which emails need.
async function putUpstashImage(pathname, bytes, contentType) {
	const blob = await getUpstash().put(uniquePath(pathname), bytes, {
		contentType,
		cache: "immutable",
		allowOverwrite: false,
	});
	if (!blob.url) {
		await getUpstash().del(blob.path).catch(() => {});
		throw new Error("The Upstash Blob bucket is private: image uploads need a public bucket");
	}
	return { url: blob.url, pathname: blob.path };
}

function isOnUpstash({ url }) {
	return UPSTASH_BLOB_HOST.test(url);
}

function getCdnUrl() {
	return process.env.IMAGES_CDN_URL?.replace(/\/+$/, "") || null;
}

// Uploads' files (an account's purge, or a file whose record wasn't saved): on S3 by key when they're on the CDN, on
// Upstash Blob by path when they're on its host, else on Vercel Blob by URL, where images uploaded before stay. A file
// that's gone already counts as deleted.
export async function deleteImages(uploads) {
	const cdn = getCdnUrl();
	const isOnS3 = ({ url }) => Boolean(cdn) && url.startsWith(`${cdn}/`);
	const keys = uploads.filter(isOnS3).map(({ pathname }) => ({ Key: pathname }));
	for (let start = 0; start < keys.length; start += DELETE_BATCH) {
		const command = new DeleteObjectsCommand({
			Bucket: process.env.IMAGES_S3_BUCKET,
			Delete: { Objects: keys.slice(start, start + DELETE_BATCH), Quiet: true },
		});
		const { Errors = [] } = await getS3().send(command, { abortSignal: AbortSignal.timeout(AWS_TIMEOUT_MS) });
		if (Errors.length > 0) throw new Error(`S3 didn't delete ${Errors.length} images: ${Errors[0].Code} ${Errors[0].Message ?? ""}`.trim());
	}
	const upstashPaths = uploads.filter((upload) => !isOnS3(upload) && isOnUpstash(upload)).map(({ pathname }) => pathname);
	if (upstashPaths.length > 0) {
		if (!process.env.UPSTASH_BLOB_TOKEN) throw new Error(`UPSTASH_BLOB_TOKEN isn't set, so ${upstashPaths.length} images on Upstash Blob weren't deleted`);
		await getUpstash().del(upstashPaths);
	}
	const blobs = uploads.filter((upload) => !isOnS3(upload) && !isOnUpstash(upload)).map(({ url }) => url);
	for (let start = 0; start < blobs.length; start += DELETE_BATCH) await del(blobs.slice(start, start + DELETE_BATCH));
}

// CloudFront keeps serving a deleted image from its cache, for up to a year, until its path is invalidated.
export async function invalidateAccountImages(accountId) {
	const distributionId = process.env.IMAGES_CLOUDFRONT_DISTRIBUTION_ID;
	if (!distributionId) return null;
	const path = `/accounts/${accountId}/*`;
	const command = new CreateInvalidationCommand({
		DistributionId: distributionId,
		InvalidationBatch: { CallerReference: randomUUID(), Paths: { Quantity: 1, Items: [path] } },
	});
	try {
		const { Invalidation } = await getCloudFront().send(command, { abortSignal: AbortSignal.timeout(AWS_TIMEOUT_MS) });
		return Invalidation.Id;
	} catch (error) {
		throw new Error(`CloudFront didn't invalidate ${path}: ${error.name} ${error.message}`, { cause: error });
	}
}
