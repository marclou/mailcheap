import assert from "node:assert/strict";
import { test } from "node:test";
import { withEnv } from "./helpers/app.mjs";
import { clients, objects } from "./stubs/s3.mjs";
import * as upstash from "./stubs/upstash-blob.mjs";
import { deleted as blobsDeleted, stored as blobs } from "./stubs/vercel-blob.mjs";

const { deleteImages, getImageStorage, getImageStorageProblem, putImage } = await import("../lib/image-storage.js");

const S3 = {
	IMAGES_S3_BUCKET: "mailcheap-images-test",
	IMAGES_S3_ACCESS_KEY_ID: "images-key-id",
	IMAGES_S3_SECRET_ACCESS_KEY: "images-secret",
	IMAGES_CDN_URL: "https://cdn.example.com/",
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("new images go to S3 when its bucket is set, else to Vercel Blob, else uploads are off", () => {
	assert.equal(getImageStorage({ ...S3, BLOB_READ_WRITE_TOKEN: "blob" }), "s3");
	assert.equal(getImageStorage({ BLOB_READ_WRITE_TOKEN: "blob" }), "blob");
	assert.equal(getImageStorage({}), null);
	assert.equal(getImageStorageProblem(S3), null);
	assert.equal(getImageStorageProblem({ BLOB_READ_WRITE_TOKEN: "blob" }), null);
	assert.match(getImageStorageProblem({}), /IMAGES_S3_BUCKET.*BLOB_READ_WRITE_TOKEN/);
});

test("a bucket without its keys or CDN says what's missing, instead of quietly using Blob", () => {
	assert.equal(
		getImageStorageProblem({ IMAGES_S3_BUCKET: "mailcheap-images-test", BLOB_READ_WRITE_TOKEN: "blob" }),
		"IMAGES_S3_BUCKET is set, so IMAGES_S3_ACCESS_KEY_ID, IMAGES_S3_SECRET_ACCESS_KEY, IMAGES_CDN_URL have to be set too"
	);
	assert.equal(getImageStorageProblem({ ...S3, IMAGES_CDN_URL: "" }), "IMAGES_S3_BUCKET is set, so IMAGES_CDN_URL has to be set too");
	assert.equal(getImageStorageProblem({ ...S3, IMAGES_CDN_URL: "http://cdn.example.com" }), "IMAGES_CDN_URL must be an https:// URL");
});

test("S3 uploads get a name of their own in the folder, a year of cache, and the CDN's URL, with MailCheap's keys only", async () => {
	const env = { ...S3, AWS_ACCESS_KEY_ID: "machine-key", AWS_SECRET_ACCESS_KEY: "machine-secret", AWS_PROFILE: "main" };
	const first = await withEnv(env, () => putImage("accounts/abc/images/cover.png", PNG, "image/png"));
	const second = await withEnv(env, () => putImage("accounts/abc/images/cover.png", PNG, "image/png"));

	assert.match(first.pathname, /^accounts\/abc\/images\/cover-[0-9a-f]{16}\.png$/);
	assert.notEqual(first.pathname, second.pathname, "the same name twice never replaces the first file");
	assert.equal(first.url, `https://cdn.example.com/${first.pathname}`);
	assert.deepEqual(
		objects.map(({ Bucket, Key, ContentType, CacheControl, bytes }) => ({ Bucket, Key, ContentType, CacheControl, bytes })),
		[first, second].map(({ pathname }) => ({
			Bucket: "mailcheap-images-test",
			Key: pathname,
			ContentType: "image/png",
			CacheControl: "public, max-age=31536000, immutable",
			bytes: PNG.length,
		}))
	);
	assert.equal(blobs.length, 0);
	assert.equal(clients.length, 1, "one client for every upload");
	assert.deepEqual(clients[0].config, {
		region: "us-east-1",
		credentials: { accessKeyId: "images-key-id", secretAccessKey: "images-secret" },
	});
});

test("without S3, images go to Vercel Blob as before", async () => {
	const s3Count = objects.length;
	const stored = await withEnv({ BLOB_READ_WRITE_TOKEN: "blob-test" }, () => putImage("accounts/abc/images/logo.png", PNG, "image/png"));
	assert.equal(stored.url, `https://blob.example.com/${stored.pathname}`);
	assert.deepEqual(blobs.at(-1).options, {
		access: "public",
		contentType: "image/png",
		addRandomSuffix: true,
		cacheControlMaxAge: 31536000,
	});
	assert.equal(objects.length, s3Count, "nothing went to S3");
});

test("with an Upstash Blob token and no S3 bucket, new images go to Upstash Blob, ahead of Vercel Blob", () => {
	assert.equal(getImageStorage({ UPSTASH_BLOB_TOKEN: "upstash", BLOB_READ_WRITE_TOKEN: "blob" }), "upstash");
	assert.equal(getImageStorage({ ...S3, UPSTASH_BLOB_TOKEN: "upstash" }), "s3");
	assert.equal(getImageStorageProblem({ UPSTASH_BLOB_TOKEN: "upstash" }), null);
	assert.match(getImageStorageProblem({}), /UPSTASH_BLOB_TOKEN/);
});

test("Upstash Blob uploads get a name of their own, a year of cache, never replace a file, and its public URL", async () => {
	const s3Count = objects.length;
	const blobCount = blobs.length;
	const stored = await withEnv({ UPSTASH_BLOB_TOKEN: "upstash-test", BLOB_READ_WRITE_TOKEN: "blob" }, () =>
		putImage("accounts/abc/images/hero.jpg", PNG, "image/jpeg")
	);
	assert.match(stored.pathname, /^accounts\/abc\/images\/hero-\w{8}\.jpg$/);
	assert.equal(stored.url, `https://b0f3a91c24d.blob.upstash.io/${stored.pathname}`);
	assert.deepEqual(upstash.stored.at(-1), {
		path: stored.pathname,
		bytes: PNG.length,
		options: { contentType: "image/jpeg", cache: "immutable", allowOverwrite: false },
	});
	assert.deepEqual(upstash.buckets[0].options, { token: "upstash-test", enableTelemetry: false });
	assert.equal(objects.length, s3Count, "nothing went to S3");
	assert.equal(blobs.length, blobCount, "nothing went to Vercel Blob");
});

test("a private Upstash Blob bucket refuses the upload: emails need public URLs", async () => {
	upstash.state.private = true;
	try {
		await assert.rejects(
			withEnv({ UPSTASH_BLOB_TOKEN: "upstash-test" }, () => putImage("accounts/abc/images/hero.png", PNG, "image/png")),
			/private: image uploads need a public bucket/
		);
		assert.equal(upstash.deleted.at(-1), upstash.stored.at(-1).path, "the file it couldn't link to doesn't stay behind");
	} finally {
		upstash.state.private = false;
	}
});

test("deleting images reaches each one where it is: Upstash Blob by path, Vercel Blob by URL", async () => {
	const uploads = [
		{ url: "https://b0f3a91c24d.blob.upstash.io/accounts/abc/images/a-11111111.png", pathname: "accounts/abc/images/a-11111111.png" },
		{ url: "https://blob.example.com/accounts/abc/images/b-1.png", pathname: "accounts/abc/images/b-1.png" },
		{ url: "https://evil.test/x.blob.upstash.io/c.png", pathname: "accounts/other/images/c.png" },
	];
	await withEnv({ UPSTASH_BLOB_TOKEN: "upstash-test" }, () => deleteImages(uploads));
	assert.deepEqual(upstash.deleted.slice(-1), ["accounts/abc/images/a-11111111.png"]);
	assert.deepEqual(blobsDeleted.slice(-2), ["https://blob.example.com/accounts/abc/images/b-1.png", "https://evil.test/x.blob.upstash.io/c.png"]);
});

test("images on Upstash Blob without its token aren't silently left behind", async () => {
	const upload = { url: "https://b0f3a91c24d.blob.upstash.io/accounts/abc/images/a.png", pathname: "accounts/abc/images/a.png" };
	await assert.rejects(
		withEnv({ UPSTASH_BLOB_TOKEN: "" }, () => deleteImages([upload])),
		/UPSTASH_BLOB_TOKEN isn't set, so 1 images on Upstash Blob weren't deleted/
	);
});
