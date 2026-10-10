import { formatMoney } from "./format.js";

const CONVERSION_LABELS = { lead: "per lead", click: "per click", action: "per sale" };

// "$2 per lead", "20% per sale": an offer's first commission.
export function describeOfferPayout(offer) {
	const [commission] = offer?.commissions ?? [];
	if (!commission) return null;
	const amount =
		commission.type === "percentage" ? `${commission.amount}%` : formatMoney(commission.amount).replace(/\.00$/, "");
	return `${amount} ${CONVERSION_LABELS[offer.conversion_type] ?? ""}`.trim();
}

// Where referrals have to come from: "Worldwide", "US, CA, GB +4".
export function describeGeo(geo) {
	if (!geo || geo.allow_worldwide_referrals) return "Worldwide";
	const countries = geo.allowed_countries ?? [];
	if (countries.length === 0) return null;
	const shown = countries
		.slice(0, 3)
		.map((code) => code.toUpperCase())
		.join(", ");
	return countries.length > 3 ? `${shown} +${countries.length - 3}` : shown;
}
