import ImageFavicon from "@/components/ImageFavicon";
import { rootDomain } from "@/lib/favicon";
import { cn } from "@/lib/utils";

// One row per SES domain: whether it can send, its DKIM records and its return path (MAIL FROM), in words.
// With SMTP, the domains come from SMTP_DOMAINS and their DKIM and SPF are the mail server's job.
const SMTP_CHECKS = [
	{ key: "verification", label: "Sending via SMTP", tone: "good" },
	{ key: "dkim", label: "DKIM on the SMTP server", tone: "none" },
	{ key: "return-path", label: "Return path on the SMTP server", tone: "none" },
];

export default function ListDomainStatus({ domains }) {
	return (
		<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
			{domains.map((domain) => {
				const checks = domain.smtp
					? SMTP_CHECKS
					: [verificationCheck(domain), dkimCheck(domain), returnPathCheck(domain)];
				return (
					<li
						key={domain.domain}
						className="flex min-h-16 items-center gap-3 px-4 py-3 lg:grid lg:min-h-14 lg:grid-cols-[minmax(0,1fr)_9.5rem_8rem_9.5rem] lg:gap-6"
					>
						<div className="flex min-w-0 items-center gap-3">
							<ImageFavicon domain={rootDomain(domain.domain)} size={20} />
							<div className="flex min-w-0 flex-col gap-1">
								<p className="truncate text-sm font-medium">{domain.domain}</p>
								<div className="flex flex-wrap gap-x-3 gap-y-1 lg:hidden">
									{checks.map((check) => (
										<TextCheck key={check.key} {...check} className="text-xs" />
									))}
								</div>
							</div>
						</div>
						{checks.map((check) => (
							<TextCheck key={check.key} {...check} className="hidden text-sm lg:flex" />
						))}
					</li>
				);
			})}
		</ul>
	);
}

function TextCheck({ label, tone, className }) {
	return (
		<span className={cn("flex min-w-0 items-center gap-2 text-muted-foreground", className)}>
			<span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_TONES[tone])} />
			<span className="truncate">{label}</span>
		</span>
	);
}

function verificationCheck({ verified, dkimStatus }) {
	if (verified) return { key: "verification", label: "Verified", tone: "good" };
	if (dkimStatus === "FAILED") return { key: "verification", label: "Verification failed", tone: "bad" };
	return { key: "verification", label: "Pending verification", tone: "wait" };
}

function dkimCheck({ dkimStatus }) {
	const status = STATUS_WORDS[dkimStatus] ?? STATUS_WORDS.NOT_STARTED;
	return { key: "dkim", label: `DKIM ${status.word}`, tone: status.tone };
}

// Without a custom MAIL FROM domain, SES uses its own (amazonses.com): mail still sends, unaligned for SPF.
function returnPathCheck({ mailFromDomain, mailFromStatus }) {
	if (!mailFromDomain) return { key: "return-path", label: "Default return path", tone: "none" };
	const status = STATUS_WORDS[mailFromStatus] ?? STATUS_WORDS.PENDING;
	return { key: "return-path", label: `Return path ${status.word}`, tone: status.tone };
}

const STATUS_WORDS = {
	SUCCESS: { word: "verified", tone: "good" },
	PENDING: { word: "pending", tone: "wait" },
	TEMPORARY_FAILURE: { word: "retrying", tone: "wait" },
	FAILED: { word: "failed", tone: "bad" },
	NOT_STARTED: { word: "not set up", tone: "none" },
};

const DOT_TONES = {
	good: "bg-emerald-500",
	wait: "bg-amber-500",
	bad: "bg-red-500",
	none: "bg-zinc-300 dark:bg-zinc-600",
};
