import crypto from "node:crypto";

// Third-party API keys are stored encrypted with a key derived from SESSION_SECRET, so a database dump
// alone doesn't leak them. Rotating SESSION_SECRET makes them unreadable: they're entered again.
const VERSION = "v1";

function getKey() {
	const secret = process.env.SESSION_SECRET;
	if (!secret) throw new Error("SESSION_SECRET is required to store secrets");
	return Buffer.from(crypto.hkdfSync("sha256", secret, "", "mailcheap-secrets-v1", 32));
}

export function sealSecret(value) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
	const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
	return [VERSION, iv, cipher.getAuthTag(), data].map((part) => (Buffer.isBuffer(part) ? part.toString("base64url") : part)).join(".");
}

// Null when it can't be read: another SESSION_SECRET, or a value that was tampered with.
export function openSecret(sealed) {
	const [version, iv, tag, data] = String(sealed ?? "").split(".");
	if (version !== VERSION || !iv || !tag || !data) return null;
	try {
		const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
		decipher.setAuthTag(Buffer.from(tag, "base64url"));
		return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
	} catch {
		return null;
	}
}
