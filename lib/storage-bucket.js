import "server-only";
import crypto from "node:crypto";
import { AwsClient } from "aws4fetch";

// Editor images live in a public_read Neon Object Storage bucket (neon.ts), on the same branch as the
// database. Vercel reserves the AWS_* names, so STORAGE_* stand in there. Locally, `neon env pull`
// writes the AWS_* ones. next.config.mjs and lib/thumbnail.js allow this bucket's path for next/image.
const BUCKET = "mailcheap-images";
// Sent emails point at these files forever, so their URLs never change and browsers can cache them for a year.
const ONE_YEAR = 365 * 24 * 60 * 60;
let client;

function getStorageConfig() {
	const env = process.env;
	const config = {
		endpoint: env.STORAGE_ENDPOINT_URL || env.AWS_ENDPOINT_URL_S3,
		region: env.STORAGE_REGION || env.AWS_REGION,
		accessKeyId: env.STORAGE_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID,
		secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY,
	};
	return config.endpoint && config.region && config.accessKeyId && config.secretAccessKey ? config : null;
}

export function isStorageConfigured() {
	return Boolean(getStorageConfig());
}

// aws4fetch signs plain fetch requests with SigV4, which is all one PUT needs.
function getClient(config) {
	client ??= new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		region: config.region,
		service: "s3",
	});
	return client;
}

// A random suffix keeps every upload at its own key: a new image never replaces one an email links to.
export async function putImage(pathname, bytes, contentType) {
	const config = getStorageConfig();
	if (!config) throw new Error("Neon Object Storage is not configured");
	const extension = pathname.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
	const key = `${pathname.slice(0, pathname.length - extension.length)}-${crypto.randomBytes(6).toString("base64url")}${extension}`;
	// Neon Object Storage only speaks path-style addressing: <endpoint>/<bucket>/<key>.
	const url = `${config.endpoint.replace(/\/$/, "")}/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
	const response = await getClient(config).fetch(url, {
		method: "PUT",
		body: bytes,
		headers: { "Content-Type": contentType, "Cache-Control": `public, max-age=${ONE_YEAR}, immutable` },
	});
	if (!response.ok) throw new Error(`Upload failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
	return url;
}
