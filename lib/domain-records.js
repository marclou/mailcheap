import { DNS_STATE_STATUSES } from "@/lib/domain-dns-rules";
import { rootDomain } from "@/lib/root-domain";

// The DNS records a customer adds for one domain, grouped by what each does, with its status in words.
const SES_STATUSES = {
	SUCCESS: { label: "Found", tone: "good" },
	PENDING: { label: "Waiting for DNS", tone: "wait" },
	TEMPORARY_FAILURE: { label: "Retrying", tone: "wait" },
	FAILED: { label: "Not found, check the records", tone: "bad" },
	NOT_STARTED: { label: "Not set up", tone: "none" },
};

function sesStatus(status) {
	return SES_STATUSES[status] ?? SES_STATUSES.PENDING;
}

const DMARC_STATUSES = {
	found: { label: "Found", tone: "good" },
	multiple: { label: "More than one record, keep one", tone: "bad" },
	invalid: { label: "Not valid, check the record", tone: "bad" },
};

// A parent domain's record covers the domain too.
function dmarcStatus({ domain, dmarc }) {
	const status = DMARC_STATUSES[dmarc?.status] ?? { label: "Recommended", tone: "none" };
	return dmarc?.status === "found" && dmarc.host !== domain ? { ...status, label: `Found on ${dmarc.host}` } : status;
}

const COUNTS = { 1: "One", 2: "Two", 3: "Three" };

// SES signs with three CNAMEs, PostShiba with one.
function describeRecords(records) {
	const types = [...new Set(records.map(({ type }) => type))];
	if (!COUNTS[records.length] || types.length !== 1) return "";
	return ` ${COUNTS[records.length]} ${types[0]} record${records.length === 1 ? "" : "s"}.`;
}

// A record's name as most DNS providers ask for it: they add the zone themselves, and take @ for the zone itself.
export function getDnsHost(name, zone) {
	const host = String(name ?? "")
		.toLowerCase()
		.replace(/\.$/, "");
	if (host === zone) return "@";
	return host.endsWith(`.${zone}`) ? host.slice(0, -zone.length - 1) : host;
}

// Statuses come in SES's words; the PostShiba adapter maps its own to them (lib/email-provider/postshiba-rules.js).
// A record MailCheap found proxied, different or missing says so instead. domain: as withActiveProvider sees it.
export function getDomainSetup(domain) {
	const zone = rootDomain(domain.domain);
	const withHost = (record) => ({ ...record, host: getDnsHost(record.name, zone) });
	const records = (domain.records ?? []).map(withHost);
	const dkim = records.filter(({ purpose }) => purpose === "dkim");
	const status = (purpose, providerStatus) => {
		const problem = domain.dnsProblems?.find((item) => item.purpose === purpose);
		return problem ? DNS_STATE_STATUSES[problem.state] : sesStatus(providerStatus);
	};
	return [
		{
			key: "dkim",
			title: "Signature (DKIM)",
			description: `Proves the emails come from you.${describeRecords(dkim)}`,
			status: status("dkim", domain.dkimStatus),
			records: dkim,
		},
		{
			key: "mail-from",
			title: "Return path",
			// SendHQ keeps the return path on its own provider's domain: no record of yours to publish.
			description: records.some(({ purpose }) => purpose === "mail-from")
				? `Bounces come back to ${domain.mailFromDomain}, so SPF passes for your domain.`
				: `Bounces come back to ${domain.mailFromDomain}, your email provider's domain: SPF passes for it, and DMARC passes on the DKIM signature.`,
			status: status("mail-from", domain.mailFromStatus),
			records: records.filter(({ purpose }) => purpose === "mail-from"),
		},
		{
			key: "dmarc",
			title: "DMARC",
			description:
				"Tells inboxes what to do with emails that fail the checks. Gmail and Yahoo require one from bulk senders. Start with p=none, then move to p=quarantine once your reports look clean.",
			status: dmarcStatus(domain),
			records: [withHost({ type: "TXT", name: `_dmarc.${domain.domain}`, value: "v=DMARC1; p=none;" })],
		},
	];
}

// What a domain can do right now, in a few words.
export function getDomainSummary(domain) {
	if (domain.dnsProblems?.length > 0) return { label: "Records need a fix", tone: "bad" };
	if (domain.verified) return { label: "Ready", tone: "good" };
	if (domain.dkimStatus === "FAILED") return { label: "Records not found", tone: "bad" };
	return { label: "Waiting for DNS", tone: "wait" };
}
