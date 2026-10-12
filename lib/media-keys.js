// Keys and URLs for pictures uploaded to S3-compatible storage (lib/s3-images.js), kept free of SDK
// imports so they can be tested. Only keys this file builds are ever served back from /media/.

export const MEDIA_PATH = "/media/";
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

const KEY_PATTERN = /^images\/[a-z0-9-]{1,80}\.(png|jpg|gif|webp)$/;
const CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

// "images/logo.png" + "a1b2c3" -> "images/logo-a1b2c3.png": same name, never the same key twice.
export function buildMediaKey(pathname, suffix) {
	const dot = pathname.lastIndexOf(".");
	return `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}`;
}

// The content type comes from the key's extension, never from the stored object, so /media/ can only
// ever answer with a picture. Anything that doesn't look like a key we built is refused.
export function getMediaContentType(key) {
	if (typeof key !== "string" || !KEY_PATTERN.test(key)) return null;
	return CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1)];
}

export function getMediaUrl(appUrl, key) {
	return `${appUrl}${MEDIA_PATH}${key}`;
}
