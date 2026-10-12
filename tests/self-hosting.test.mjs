import assert from "node:assert/strict";
import { test } from "node:test";
import { getSmtpDomains, isS3Configured, isSmtpConfigured } from "../lib/config.js";
import { buildMediaKey, getMediaContentType, getMediaUrl, MEDIA_CACHE_CONTROL } from "../lib/media-keys.js";

test("SMTP mode is on only when SMTP_HOST has a value", () => {
	assert.equal(isSmtpConfigured({ SMTP_HOST: "mail.example.com" }), true);
	assert.equal(isSmtpConfigured({ SMTP_HOST: "  " }), false);
	assert.equal(isSmtpConfigured({ SMTP_HOST: "" }), false);
	assert.equal(isSmtpConfigured({}), false);
});

test("SMTP_DOMAINS is a clean, lowercase list without duplicates", () => {
	assert.deepEqual(getSmtpDomains({ SMTP_DOMAINS: " Example.com, mail.example.org ,,example.com " }), [
		"example.com",
		"mail.example.org",
	]);
	assert.deepEqual(getSmtpDomains({ SMTP_DOMAINS: "" }), []);
	assert.deepEqual(getSmtpDomains({}), []);
});

test("S3 storage needs both an endpoint and a bucket", () => {
	assert.equal(isS3Configured({ S3_ENDPOINT: "https://s3.example.com", S3_BUCKET: "mailcheap" }), true);
	assert.equal(isS3Configured({ S3_ENDPOINT: "https://s3.example.com" }), false);
	assert.equal(isS3Configured({ S3_BUCKET: "mailcheap" }), false);
	assert.equal(isS3Configured({ S3_ENDPOINT: " ", S3_BUCKET: "mailcheap" }), false);
});

test("an upload keeps its name and gets a random suffix before the extension", () => {
	assert.equal(buildMediaKey("images/team-photo.jpg", "a1b2c3d4e5f6"), "images/team-photo-a1b2c3d4e5f6.jpg");
	assert.equal(getMediaUrl("https://news.example.com", "images/x-1.png"), "https://news.example.com/media/images/x-1.png");
});

test("/media/ only serves picture keys it could have built, with a type from the extension", () => {
	assert.equal(getMediaContentType("images/team-photo-a1b2c3d4e5f6.jpg"), "image/jpeg");
	assert.equal(getMediaContentType("images/logo-0f0f0f0f0f0f.png"), "image/png");
	assert.equal(getMediaContentType("images/anim-1.gif"), "image/gif");
	assert.equal(getMediaContentType("images/hero-1.webp"), "image/webp");
	for (const key of [
		"images/../secret.png",
		"images/a/b.png",
		"images/page.html",
		"images/script.svg",
		"images/UPPER.png",
		"other/x.png",
		"images/.png",
		`images/${"a".repeat(81)}.png`,
		"",
		undefined,
	]) {
		assert.equal(getMediaContentType(key), null, `refused: ${key}`);
	}
	assert.match(MEDIA_CACHE_CONTROL, /immutable/);
});
