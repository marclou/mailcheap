import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { MAX_ACTIVE_API_KEYS } from "@/lib/actions/api-keys";
import { isCloud } from "@/lib/config";
import { getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("api-and-ai");

export default function ApiAndAiPage() {
	return (
		<ArticleHelp slug="api-and-ai">
			<h2 id="same-actions">The same actions, from anywhere</h2>
			<p>
				Everything you do in the dashboard also works from code, through the REST API, and from AI assistants, through the MCP server:
				writing drafts, previewing them as one of your contacts, sending tests, scheduling, adding contacts with their first name,
				tags and fields, tagging them, seeing the emails each one got, building
				segments, reading reports. Each action runs the same checks
				and limits as in the dashboard.{isCloud() && " Both need a plan."} The <Link href="/docs">API and MCP docs</Link> have the setup
				and every endpoint.
			</p>

			<h2 id="ai-assistants">AI assistants</h2>
			<p>
				ChatGPT, Claude and Grok Bot connect with your sign-in: add MailCheap in the assistant, then approve it on MailCheap&apos;s
				page. Claude Code, Codex and Cursor connect with an API key. Your assistant can then write drafts, send you tests, schedule
				issues and read your stats. Sending to your list can&apos;t be undone, so it asks you first. In ChatGPT, OpenAI lets apps make
				changes only on its Business, Enterprise and Edu plans. <Link href="/docs/mcp">See the setup for each assistant</Link>.
			</p>
			<p>
				Apps connected with your sign-in are listed on the <LinkApp href="/api-keys">API keys page</LinkApp>, with when they last did
				something. Each one has full access,
				like a full access key, until you disconnect it.
			</p>

			<h2 id="agents">An agent working on its own</h2>
			<p>
				An AI agent that runs a task without you at the keyboard gets in through AgentOnboard instead of an API key: the agent holds
				one key of yours there, and mints a short-lived token each time it calls MailCheap. The token carries your verified email, so
				MailCheap hands it your account, nothing more to set up.
			</p>
			{isCloud() && (
				<p>
					On MailCheap Cloud an agent can open your account itself: its first call answers that there&apos;s no account, it creates one
					at the signup endpoint it&apos;s told about, and you get an email saying so. If that wasn&apos;t you, delete the account on the{" "}
					<LinkApp href="/account">account page</LinkApp>. An agent opens up an account with the same rules as you would: no throwaway
					inboxes, and no more than three a day from one address.
				</p>
			)}
			<p>
				The agent reads <code>auth.md</code> at the server&apos;s address to find all of this — the agent hostnames, the endpoints under{" "}
				<code>/api/v1/agents</code>, what each error means — and then calls the same actions as the <Link href="/docs/api">REST API</Link>{" "}
				runs, with every plan, rate limit and sending check on them. Nothing lasts: each token is good for five minutes, and turning the
				agent&apos;s AgentOnboard key off stops any new ones.
			</p>

			<h2 id="api-keys">API keys</h2>
			<p>
				Create keys on the <LinkApp href="/api-keys">API keys page</LinkApp>. A key is shown once: copy it then, since MailCheap only
				keeps a fingerprint of it.
			</p>
			<ul>
				<li>
					<strong>Full access</strong>: everything the dashboard does, for your scripts and AI assistants.
				</li>
				<li>
					<strong>Signups only</strong>: can only add contacts, so it&apos;s safe in your website&apos;s code, for a signup form of
					your own.
				</li>
			</ul>
			<p>
				An account has up to {MAX_ACTIVE_API_KEYS} active keys. Revoking one stops it at once, for good. The{" "}
				<Link href="/docs/authentication">authentication page</Link> lists the rate limits.
			</p>
		</ArticleHelp>
	);
}
