import "server-only";
import * as z from "zod";
import { scoped } from "@/lib/account-scope";
import { defineAction } from "@/lib/actions/define-action";
import { DnsStepsSchema, dateOutput, idInput, toDnsSteps, toIso } from "@/lib/actions/shared";
import { getNewsletterHost } from "@/lib/archive-hosts";
import { getSharedDomain } from "@/lib/config";
import { getDnsProblemMessage } from "@/lib/domain-dns-rules";
import { getDomainSetup, getDomainSummary } from "@/lib/domain-records";
import { addDomain, checkDomain, removeDomain } from "@/lib/domains";
import { getSharedAddress, isSharedSenderReady, withActiveProvider } from "@/lib/sender-rules";
import Domain from "@/models/Domain";
import Newsletter from "@/models/Newsletter";

const GROUP = "Domains";

const DomainSchema = z.object({
	id: z.string(),
	domain: z.string(),
	status: z.string().describe("In words: Ready, Waiting for DNS, Records need a fix…"),
	verified: z.boolean().describe("The email provider verified it and its records are still in DNS: newsletters can send from it"),
	dnsProblem: z
		.string()
		.nullable()
		.describe(
			"A record MailCheap found behind a proxy (Cloudflare's orange cloud), different or no longer there, and how to fix it. A verified domain sends nothing until it's fixed and checked again."
		),
	mailFromDomain: z.string(),
	dkimStatus: z.string(),
	mailFromStatus: z.string(),
	setup: DnsStepsSchema.describe("The DNS records to add at the domain's DNS provider, step by step"),
	checkedAt: dateOutput,
	verifiedAt: dateOutput,
	createdAt: dateOutput,
});

function toDomain(stored) {
	const domain = withActiveProvider(stored);
	return {
		id: String(domain._id),
		domain: domain.domain,
		status: getDomainSummary(domain).label,
		verified: Boolean(domain.verified),
		dnsProblem: getDnsProblemMessage(domain.domain, domain.dnsProblems),
		mailFromDomain: domain.mailFromDomain,
		dkimStatus: domain.dkimStatus ?? "PENDING",
		mailFromStatus: domain.mailFromStatus ?? "PENDING",
		setup: toDnsSteps(getDomainSetup(domain)),
		checkedAt: toIso(domain.checkedAt),
		verifiedAt: toIso(domain.verifiedAt),
		createdAt: toIso(domain.createdAt),
	};
}

export const domainActions = [
	defineAction({
		name: "list_domains",
		tryWithoutPlan: true,
		title: "List domains",
		group: GROUP,
		description:
			"Lists the account's own sending domains with their DNS records and status as last checked, and each newsletter's shared address (hello@<slug>.<shared domain>), which works with no setup.",
		http: { method: "GET", path: "/domains" },
		readOnly: true,
		output: z.object({
			domains: z.array(DomainSchema),
			sharedDomain: z.string().nullable(),
			sharedAddresses: z
				.array(
					z.object({
						newsletterId: z.string(),
						newsletter: z.string(),
						fromEmail: z.string(),
						archiveHost: z.string().nullable().describe("Where its website is: its website domain once it's live, else its shared subdomain"),
						ready: z.boolean().describe("Its subdomain is set up and verified: the newsletter can send from it"),
					})
				)
				.describe("Each newsletter's shared from address and website host. Replies go to its reply-to, or to the account owner."),
		}),
		handler: async ({ account }) => {
			const sharedDomain = getSharedDomain();
			const [domains, newsletters] = await Promise.all([
				Domain.find(scoped(account)).sort({ createdAt: 1 }).lean(),
				Newsletter.find(scoped(account)).sort({ createdAt: 1 }).select({ name: 1, slug: 1, archiveHost: 1, sharedSender: 1 }).lean(),
			]);
			return {
				domains: domains.map(toDomain),
				sharedDomain,
				sharedAddresses: sharedDomain
					? newsletters.map((newsletter) => ({
							newsletterId: String(newsletter._id),
							newsletter: newsletter.name,
							fromEmail: getSharedAddress(newsletter.slug, sharedDomain),
							archiveHost: getNewsletterHost(newsletter, sharedDomain),
							ready: isSharedSenderReady(newsletter, { sharedDomain }),
						}))
					: [],
			};
		},
	}),
	defineAction({
		name: "add_domain",
		title: "Add a domain",
		group: GROUP,
		description:
			"Adds a domain to send from, in the account's own tenant at the email provider: emails are signed with DKIM and bounces return to a subdomain of it (rp.<domain> on PostShiba and Groundmail, bounce.<domain> on Amazon SES). The answer lists the DNS records to add; on Cloudflare they must be DNS only, never proxied. check_domain reads them once they're in. Newsletters can send from it once it's verified. A newsletter's website goes on a domain of its own with set_website_domain.",
		http: { method: "POST", path: "/domains", status: 201 },
		openWorld: true,
		rateLimit: { limit: 10, window: "1 h" },
		example: { domain: "example.com" },
		input: z.object({
			domain: z
				.string()
				.trim()
				.max(253)
				.describe("e.g. example.com. An address or a link works too: jane@example.com and https://www.example.com/about both add example.com."),
		}),
		output: DomainSchema,
		handler: async ({ account, input }) => toDomain(await addDomain({ account, domain: input.domain })),
	}),
	defineAction({
		name: "check_domain",
		title: "Check a domain's DNS records",
		group: GROUP,
		description:
			"Asks the email provider and DNS again whether the domain's records are in, and looks up its DMARC record or its parent domain's. MailCheap also looks up the records itself, as it does each day for verified domains and before a test or a send: one behind a proxy, different or gone stops the domain from sending until it's fixed (dnsProblem). On PostShiba, a check within a minute of the last one answers what that one found.",
		http: { method: "POST", path: "/domains/{id}/check" },
		idempotent: true,
		openWorld: true,
		rateLimit: { limit: 60, window: "1 h" },
		input: z.object({ id: idInput("domain") }),
		output: DomainSchema,
		handler: async ({ account, input }) => toDomain(await checkDomain({ account, domainId: input.id })),
	}),
	defineAction({
		name: "remove_domain",
		tryWithoutPlan: true,
		title: "Remove a domain",
		group: GROUP,
		description:
			"Removes a domain from the email provider. Newsletters on it can't send until they move to another address; a website domain under it stays. Refused while a campaign from it is sending, paused or scheduled. Adding it again needs new DNS records.",
		http: { method: "DELETE", path: "/domains/{id}" },
		destructive: true,
		idempotent: true,
		openWorld: true,
		input: z.object({ id: idInput("domain") }),
		output: z.object({ removed: z.string().describe("The domain that was removed") }),
		handler: ({ account, input }) => removeDomain({ account, domainId: input.id }),
	}),
];
