// An in-memory Upstash Blob bucket: uploads are kept here instead of going to Upstash, and state.private makes it a
// bucket without public URLs.
export const stored = [];
export const deleted = [];
export const buckets = [];
export const state = { private: false };

export function uniquePath(path) {
	return path.replace(/(\.\w+)?$/, `-${String(stored.length + 1).padStart(8, "0")}$1`);
}

export class Bucket {
	constructor(options) {
		this.options = options;
		buckets.push(this);
	}

	async put(path, body, options) {
		stored.push({ path, bytes: body.length, options });
		const url = state.private ? undefined : `https://b0f3a91c24d.blob.upstash.io/${path}`;
		return { path, url, size: body.length, etag: "etag", uploadedAt: new Date(), contentType: options.contentType };
	}

	async del(target) {
		deleted.push(...(Array.isArray(target) ? target : [target]));
	}
}
