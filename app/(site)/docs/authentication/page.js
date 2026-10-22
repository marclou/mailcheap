import Link from "next/link";
import BlockCode from "@/components/BlockCode";
import HeaderDocs from "@/components/HeaderDocs";
import LinkApp from "@/components/LinkApp";
import { MAX_ACTIVE_API_KEYS } from "@/lib/actions/api-keys";
import { SIGNUPS_PER_KEY, SIGNUPS_PER_VISITOR } from "@/lib/actions/contacts";
import { SLUG_CHANGES } from "@/lib/newsletters";
import { ACTIONS } from "@/lib/actions/registry";
import { API_BASE_PATH, REQUESTS_PER_KEY } from "@/lib/api/rest";
import { getAppUrl, isCloud } from "@/lib/config";
import { getDocsPageMetadata } from "@/lib/docs/llms";
import { formatNumber, formatWindow } from "@/lib/format";
import { PLANS, getSignupScale } from "@/lib/plans";

export const metadata = getDocsPageMetadata("/docs/authentication");

export default function AuthenticationPage() {
	const appUrl = getAppUrl();
	const limited = ACTIONS.filter(({ rateLimit }) => rateLimit);
	const signupsOnly = ACTIONS.filter(({ permission }) => permission === "signups");
	const largest = PLANS.at(-1);
	const signupsAnHour = isCloud()
		? `${formatNumber(SIGNUPS_PER_KEY.limit)} an hour on Starter, up to ${formatNumber(SIGNUPS_PER_KEY.limit * largest.signupScale)} on ${largest.name}`
		: `${formatNumber(SIGNUPS_PER_KEY.limit * getSignupScale(null))} an hour`;

	return (
		<>
			<HeaderDocs kicker="Guides" title="Authentication">
				Every request carries an API key as a bearer token. The key decides the account, and its level decides what it can do. ChatGPT and
				Claude don&apos;t need one: they connect to the{" "}
				<Link href="/docs/mcp#chatgpt" className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
					MCP server with OAuth
				</Link>
				.
			</HeaderDocs>

			<Section title="Send the key" stagger={1}>
				<p>
					Create keys on the dashboard&apos;s{" "}
					<LinkApp href="/api-keys" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
						API keys page
					</LinkApp>
					. They start with <Code>mc_</Code> and are shown once: MailCheap only keeps
					their hash, their first characters and when they were last used. The REST API and the MCP server take the same header. An
					account has up to {MAX_ACTIVE_API_KEYS} active keys.
				</p>
				<BlockCode title="Header" className="mt-4" code="Authorization: Bearer mc_…" />
			</Section>

			<Section title="Two levels" stagger={2}>
				<div className="overflow-hidden rounded-xl shadow-border">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-border/60 text-xs text-muted-foreground">
								<th className="py-2 pl-4 font-normal">Level</th>
								<th className="py-2 pr-4 font-normal">Can</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border/60 align-top">
							<tr>
								<td className="py-3 pr-4 pl-4 font-medium whitespace-nowrap">Full access</td>
								<td className="py-3 pr-4 text-muted-foreground">
									Every endpoint and MCP tool, including creating and revoking keys. Keep it on a server or in your AI assistant&apos;s
									settings.
								</td>
							</tr>
							<tr>
								<td className="py-3 pr-4 pl-4 font-medium whitespace-nowrap">Signups only</td>
								<td className="py-3 pr-4 text-muted-foreground">
									Only {signupsOnly.map(({ name }) => name).join(", ")} (<Code>POST {API_BASE_PATH}/contacts</Code>), for signup forms.
									It can go in a web page: that endpoint answers browsers, and the key can&apos;t read or send anything.
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<p className="mt-4">
					A signups only key calling anything else gets <Code>403 forbidden</Code>. Keys made before levels existed are signups only.
					Revoked keys get <Code>401 unauthorized</Code>.
				</p>
			</Section>

			<Section title="A signup form" stagger={3}>
				<p>With a signups only key, from the browser. Pass the visitor&apos;s IP from a server to limit signups per visitor.</p>
				<BlockCode
					title="JavaScript"
					className="mt-4"
					code={`await fetch("${appUrl}${API_BASE_PATH}/contacts", {
  method: "POST",
  headers: {
    Authorization: "Bearer mc_your_signups_only_key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email: form.email.value, source: "website" }),
});`}
				/>
			</Section>

			<Section title="Rate limits" stagger={4}>
				<p>
					Each key gets {REQUESTS_PER_KEY.limit} requests {formatWindow(REQUESTS_PER_KEY.window)} across REST and MCP. Some actions have
					their own limit, for each key and for the account: its keys, connected apps and dashboard share the account&apos;s, so more keys
					don&apos;t raise it. Over a limit the answer is <Code>429 rate_limited</Code>; wait and retry.
				</p>
				<div className="mt-4 overflow-hidden rounded-xl shadow-border">
					<table className="w-full text-left text-sm">
						<tbody className="divide-y divide-border/60">
							<tr>
								<td className="py-2.5 pl-4 font-mono text-[13px]">add_contact</td>
								<td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">
									{signupsAnHour}, {SIGNUPS_PER_VISITOR.limit} per visitor in 10 minutes
								</td>
							</tr>
							<tr>
								<td className="py-2.5 pl-4 font-mono text-[13px]">update_newsletter</td>
								<td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">
									{SLUG_CHANGES.limit} slug changes {formatWindow(SLUG_CHANGES.window)} per account
								</td>
							</tr>
							{limited.map(({ name, rateLimit }) => (
								<tr key={name}>
									<td className="py-2.5 pl-4 font-mono text-[13px]">{name}</td>
									<td className="py-2.5 pr-4 text-right text-muted-foreground tabular-nums">
										{rateLimit.limit} {formatWindow(rateLimit.window)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>

			<Section title="Plans" stagger={5}>
				{isCloud() ? (
					<p>
						Everything but the billing endpoints needs an active plan; without one the answer is <Code>402 subscription_required</Code>.
						Signups and confirmation emails keep coming in over the plan&apos;s limits. Campaign sends stop with{" "}
						<Code>plan_limit_emails</Code> or <Code>plan_limit_subscribers</Code>. Welcome emails count toward the month&apos;s emails
						like issues: once they&apos;re used up, new subscribers get none until the count starts over or the plan grows, and don&apos;t
						get one later. <Code>usage.welcomeEmailsPaused</Code> in <Code>get_billing</Code> and <Code>get_overview</Code> says so.
					</p>
				) : (
					<p>
						This server is self-hosted without billing: no plans and no limits on emails or subscribers. The billing endpoints answer{" "}
						<Code>404 billing_off</Code>.
					</p>
				)}
			</Section>
			<Section title="AgentOnboard tokens" stagger={6}>
			<p>
				An agent holding an AgentOnboard key mints a five-minute token for this server&apos;s bare hostname (that of {appUrl}); MailCheap
				verifies it against AgentOnboard&apos;s public keys on every request and runs it as the account of the verified email the token
				carries, exactly as that person&apos;s full access key would. Possessing a valid token for an email counts as owning that inbox:
				for its five minutes, the token is that person. The token goes on the same header and the same {REQUESTS_PER_KEY.limit}{" "}
				requests {formatWindow(REQUESTS_PER_KEY.window)} count for it.
			</p>
			<p>
				An agent reads <Link href="/auth.md">auth.md</Link> — the audience, the endpoints, the error handling — and calls the same action
				routes under <Code>{"/api/v1/agents"}</Code>, each failure answering <Code>&#123;&#123; &quot;code&quot;: … &#125;&#125;</Code>.{" "}
				{isCloud() ? (
					<>
						An accountless identity answers <Code>403 ACCOUNT_REQUIRED</Code>, and opens an account at{" "}
						<Code>POST {"/api/v1/agents/signup"}</Code> with the same token: the human signup rules apply, and the owner gets an email
						saying it happened.
					</>
				) : (
					<>
						An accountless identity answers <Code>403 ACCOUNT_REQUIRED</Code>: the allow list decides, so the human signs in once at the
						server&apos;s sign-in page, then the agent retries once.
					</>
				)}
			</p>
		</Section>
	</>
	);
}

function Section({ title, stagger, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="mt-12 max-w-3xl animate-enter first-of-type:mt-0">
			<h2 className="mb-3 text-xl font-semibold tracking-tight">{title}</h2>
			<div className="text-[15px] leading-7 text-pretty text-foreground/80">{children}</div>
		</section>
	);
}

function Code({ children }) {
	return <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{children}</code>;
}
