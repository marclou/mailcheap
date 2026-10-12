import { Suspense } from "react";
import { ChevronRight, ExternalLink, Globe, TriangleAlert } from "lucide-react";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonCopy from "@/components/ButtonCopy";
import HeaderPage from "@/components/HeaderPage";
import ImageFavicon from "@/components/ImageFavicon";
import SkeletonDomains from "@/components/SkeletonDomains";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { rootDomain } from "@/lib/favicon";
import { isSmtpConfigured } from "@/lib/config";
import { listSesDomains } from "@/lib/ses";

export const metadata = { title: "Domains" };

export default function DomainsPage() {
	const region = process.env.SES_REGION || "us-east-1";
	return (
		<>
			<HeaderPage title="Domains">
				<Button asChild variant="outline">
					<a href="https://postmaster.google.com/v2/" target="_blank" rel="noreferrer">
						<ImageFavicon domain="postmaster.google.com" size={16} />
						Postmaster
						<ExternalLink data-icon="inline-end" className="opacity-60" />
					</a>
				</Button>
				{!isSmtpConfigured() && (
					<Button asChild variant="outline">
						<a
							href={`https://${region}.console.aws.amazon.com/ses/home?region=${region}#/identities`}
							target="_blank"
							rel="noreferrer"
						>
							<ImageFavicon domain="aws.amazon.com" size={16} />
							SES
							<ExternalLink data-icon="inline-end" className="opacity-60" />
						</a>
					</Button>
				)}
			</HeaderPage>
			<Suspense fallback={<SkeletonDomains />}>
				<ListDomains />
			</Suspense>
		</>
	);
}

async function ListDomains() {
	const domains = await listSesDomains({ fresh: true });

	if (domains.error) {
		return (
			<StateEmpty icon={TriangleAlert} title="Could not reach SES">
				<p className="max-w-md text-sm text-muted-foreground">{domains.error}</p>
			</StateEmpty>
		);
	}
	if (domains.length === 0) {
		return <StateEmpty icon={Globe} title={isSmtpConfigured() ? "No domains in SMTP_DOMAINS" : "No domains in SES"} />;
	}

	return (
		<div className="flex flex-col gap-3">
			{domains.map((domain, index) => (
				<section
					key={domain.domain}
					style={{ "--stagger": index }}
					className="overflow-hidden rounded-xl bg-card shadow-border animate-enter"
				>
					<div className="flex flex-wrap items-center justify-between gap-3 p-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
								<ImageFavicon domain={rootDomain(domain.domain)} size={20} />
							</div>
							<p className="truncate font-medium">{domain.domain}</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{!domain.smtp && <StatusPill label="DKIM" status={domain.dkimStatus} />}
							{domain.mailFromDomain && <StatusPill label="Return path" status={domain.mailFromStatus} />}
							<BadgeStatus
								status={domain.verified ? "verified" : "pending"}
								label={domain.smtp ? "Sending via SMTP" : domain.verified ? "Verified" : "Pending"}
							/>
						</div>
					</div>

					{domain.smtp ? (
						<p className="border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
							Listed in SMTP_DOMAINS. DKIM, SPF and the return path are set up on your mail server, not checked here.
						</p>
					) : (
						<details className="group border-t border-border/60">
							<summary className="flex h-11 cursor-pointer list-none items-center gap-1.5 px-4 text-sm text-muted-foreground transition-colors duration-150 select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
								<ChevronRight className="size-4 transition-transform duration-200 group-open:rotate-90" />
								DNS records
							</summary>
							<div className="overflow-x-auto border-t border-border/60">
								<table className="w-full text-sm">
									<tbody className="divide-y divide-border/60">
										{domain.records.map((record) => (
											<tr key={`${record.type}-${record.name}-${record.value}`}>
												<td className="w-16 py-2 pl-4 align-middle font-mono text-xs text-muted-foreground">
													{record.type}
												</td>
												<td className="max-w-0 py-2 pr-2 align-middle">
													<div className="flex items-center gap-1">
														<span className="truncate font-mono text-xs">{record.name}</span>
														<ButtonCopy value={record.name} label="Copy name" />
													</div>
												</td>
												<td className="max-w-0 py-2 pr-4 align-middle">
													<div className="flex items-center gap-1">
														<span className="truncate font-mono text-xs">{record.value}</span>
														<ButtonCopy value={record.value} label="Copy value" />
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</details>
					)}
				</section>
			))}
		</div>
	);
}

function StatusPill({ label, status }) {
	const key = String(status ?? "").toLowerCase();
	return (
		<BadgeStatus
			status={key}
			label={`${label} ${key === "success" ? "ok" : key.replaceAll("_", " ") || "missing"}`}
		/>
	);
}
