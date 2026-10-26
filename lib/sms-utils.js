import { parsePhoneNumberWithError } from "libphonenumber-js";

// Standard GSM 03.38 7-bit character set (including standard extension table)
const GSM_7_REGEX = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~\]|€]*$/;

// Analyzes SMS text to determine encoding, length, and billing segments.
export function analyzeSmsContent(text = "") {
	const isGsm7 = GSM_7_REGEX.test(text);
	const length = text.length;

	if (isGsm7) {
		const segments = length <= 160 ? (length > 0 ? 1 : 0) : Math.ceil(length / 153);
		const maxInCurrent = segments <= 1 ? 160 : segments * 153;
		return {
			encoding: "GSM-7",
			length,
			segments,
			remainingInSegment: maxInCurrent - length,
			isUcs2: false,
		};
	}

	const segments = length <= 70 ? (length > 0 ? 1 : 0) : Math.ceil(length / 67);
	const maxInCurrent = segments <= 1 ? 70 : segments * 67;
	return {
		encoding: "UCS-2",
		length,
		segments,
		remainingInSegment: maxInCurrent - length,
		isUcs2: true,
	};
}

// Normalizes and validates a phone number to international E.164.
export function formatE164(rawPhone, defaultCountry = "US") {
	if (!rawPhone || typeof rawPhone !== "string") return null;
	const trimmed = rawPhone.trim();
	if (!trimmed) return null;

	try {
		const parsed = parsePhoneNumberWithError(trimmed, defaultCountry);
		if (!parsed.isValid()) return null;
		return {
			e164: parsed.number,
			country: parsed.country || null,
		};
	} catch {
		return null;
	}
}
