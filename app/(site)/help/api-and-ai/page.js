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
				writing drafts, sending tests, scheduling, adding contacts with their first name, tags and fields, tagging them, building
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
