import { getSession } from "@/lib/auth";
import { slugify } from "@/lib/slug";
import { isStorageConfigured, putImage } from "@/lib/storage-bucket";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-image";

// The declared type must match the file's first bytes, so nothing but pictures ends up on the CDN.
const IMAGE_TYPES = {
	"image/png": { extension: "png", signature: "\x89PNG" },
	"image/jpeg": { extension: "jpg", signature: "\xff\xd8\xff" },
	"image/gif": { extension: "gif", signature: "GIF8" },
	"image/webp": { extension: "webp", signature: "RIFF", marker: "WEBP" },
};

export async function POST(request) {
	if (!(await getSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
	if (!isStorageConfigured()) {
		return Response.json({ error: "Image uploads need Neon Object Storage (run neon deploy, then set STORAGE_*)" }, { status: 503 });
	}

	const contentType = request.headers.get("content-type");
	const type = IMAGE_TYPES[contentType];
	if (!type) return Response.json({ error: "Use a PNG, JPEG, GIF or WebP image" }, { status: 415 });

	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.length > MAX_UPLOAD_BYTES) {
		return Response.json({ error: "Images must be under 4 MB" }, { status: 413 });
	}
	if (!startsWith(bytes, type.signature) || (type.marker && !startsWith(bytes, type.marker, 8))) {
		return Response.json({ error: "This file isn't a valid image" }, { status: 415 });
	}

	const name = slugify(request.headers.get("x-file-name"), 60) || "image";
	try {
		const url = await putImage(`images/${name}.${type.extension}`, bytes, contentType);
		return Response.json({ url });
	} catch (error) {
		console.error("[uploads] Upload failed:", error);
		return Response.json({ error: "Upload failed, try again" }, { status: 502 });
	}
}

function startsWith(bytes, signature, offset = 0) {
	return [...signature].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}
