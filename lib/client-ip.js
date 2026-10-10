export function getClientIp(headers) {
	const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0].trim();
	return forwardedFor || headers.get("x-real-ip") || "unknown";
}
