import { getMediaContentType, getS3Image, isS3Configured, MEDIA_CACHE_CONTROL } from "@/lib/s3-images";

export const dynamic = "force-dynamic";

// Pictures uploaded in the editor when S3 storage is on (lib/s3-images.js). Public: sent emails load them.
export async function GET(_request, { params }) {
	const key = ((await params).key ?? []).join("/");
	const contentType = getMediaContentType(key);
	if (!isS3Configured() || !contentType) return new Response("Not found", { status: 404 });

	const image = await getS3Image(key);
	if (!image) return new Response("Not found", { status: 404 });
	return new Response(image.body, {
		headers: {
			"Content-Type": contentType,
			...(image.length && { "Content-Length": String(image.length) }),
			"Cache-Control": MEDIA_CACHE_CONTROL,
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": "default-src 'none'",
		},
	});
}
