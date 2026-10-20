import Link from "next/link";
import { ArrowRight } from "lucide-react";
import BlockCode from "@/components/BlockCode";
import ButtonCopy from "@/components/ButtonCopy";
import HeaderDocs from "@/components/HeaderDocs";
import LinkApp from "@/components/LinkApp";
import { API_BASE_PATH } from "@/lib/api/rest";
import { getAppUrl } from "@/lib/config";
import { getDocsPageMetadata } from "@/lib/docs/llms";
import { getClaudeCodeCommand, getMcpUrl } from "@/lib/docs/mcp-clients";
import { getEndpointGroups } from "@/lib/docs/reference";

export const metadata = getDocsPageMetadata("/docs");

export default function DocsPage() {
	const appUrl = getAppUrl();
	const groups = getEndpointGroups(appUrl);
	const endpointCount = groups.reduce((sum, { endpoints }) => sum + endpoints.length, 0);

	return (
		<div className="relative isolate">
			<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-10 -z-10 h-80 bg-dots" />
			<HeaderDocs kicker="REST API and MCP" title="Everything the dashboard does, from code or an AI assistant">
				The REST API and the MCP server run the same {endpointCount} actions as the dashboard, with the same checks: plan limits, sender
				rules, pre-send checks, campaigns paused for their bounce or complaint rates or Gmail&apos;s spam rate, blocked accounts and first
				sends in steps.
			</HeaderDocs>

			<div style={{ "--stagger": 1 }} className="grid gap-3 animate-enter sm:grid-cols-2">
				<CardAddress label="REST API" value={`${appUrl}${API_BASE_PATH}`} detail="JSON in and out" />
				<CardAddress label="MCP server" value={getMcpUrl(appUrl)} detail="Streamable HTTP" />
			</div>

			<ol style={{ "--stagger": 2 }} className="mt-14 flex flex-col animate-enter">
				<Step number="1" title="Create an API key">
					<p>
						On the{" "}
						<LinkApp href="/api-keys" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
							API keys page
						</LinkApp>
						. Full access for scripts and AI assistants; signups only for signup forms in your website&apos;s code. Keys are shown once.
					</p>
				</Step>
				<Step number="2" title="Make a request">
					<p>Every request sends the key as a bearer token. This one lists your newsletters with their settings.</p>
					<BlockCode
						title="Terminal"
						className="mt-4"
						code={`curl ${appUrl}${API_BASE_PATH}/newsletters \\\n  -H "Authorization: Bearer $MAILCHEAP_API_KEY"`}
					/>
				</Step>
				<Step number="3" title="Or connect an AI assistant" isLast>
					<p>
						One command for Claude Code. Codex and Cursor take a few lines, and ChatGPT, Claude and Grok Bot connect with your sign-in, on
						the{" "}
						<Link href="/docs/mcp" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
							MCP page
						</Link>
						.
					</p>
					<BlockCode title="Terminal" className="mt-4" code={getClaudeCodeCommand(appUrl)} />
				</Step>
			</ol>

			<section style={{ "--stagger": 3 }} className="mt-16 animate-enter">
				<h2 className="text-xl font-semibold tracking-tight">What you can do</h2>
				<div className="mt-5 grid gap-3 sm:grid-cols-2">
					{groups.map(({ group, slug, description, endpoints }) => (
						<Link
							key={slug}
							href={`/docs/api#${slug}`}
							className="group flex flex-col gap-2 rounded-xl bg-card p-4 shadow-border transition-shadow duration-150 hover:shadow-border-hover"
						>
							<span className="flex items-center justify-between gap-3">
								<span className="font-medium">{group}</span>
								<span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
									{endpoints.length}
									<ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
								</span>
							</span>
							<span className="text-sm text-pretty text-muted-foreground">{description}</span>
						</Link>
					))}
				</div>
			</section>

			<section style={{ "--stagger": 4 }} className="mt-16 rounded-2xl bg-muted/50 p-5 animate-enter sm:p-6">
				<h2 className="font-semibold tracking-tight">For agents reading this</h2>
				<ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
					<li>
						<a href="/llms.txt" className="font-mono text-foreground underline decoration-foreground/30 underline-offset-4">
							/llms.txt
						</a>{" "}
						lists these pages and every endpoint.
					</li>
					<li>
						<a href="/llms-full.txt" className="font-mono text-foreground underline decoration-foreground/30 underline-offset-4">
							/llms-full.txt
						</a>{" "}
						is the whole reference in Markdown.
					</li>
					<li>
						<a href={`${API_BASE_PATH}/openapi.json`} className="font-mono text-foreground underline decoration-foreground/30 underline-offset-4">
							{API_BASE_PATH}/openapi.json
						</a>{" "}
						is the API as OpenAPI 3.1, made from the same schemas as the MCP tools.
					</li>
				</ul>
			</section>
		</div>
	);
}

function CardAddress({ label, value, detail }) {
	return (
		<div className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-border">
			<span className="flex items-center justify-between text-xs text-muted-foreground">
				{label}
				<span className="font-mono text-[11px]">{detail}</span>
			</span>
			<span className="flex items-center justify-between gap-2">
				<code className="truncate font-mono text-[13px]">{value}</code>
				<ButtonCopy value={value} label={`Copy the ${label} address`} />
			</span>
		</div>
	);
}

function Step({ number, title, isLast, children }) {
	return (
		<li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-4 pb-10 last:pb-0">
			{!isLast && <span aria-hidden="true" className="absolute top-9 bottom-1 left-4 w-px bg-border" />}
			<span className="relative grid size-8 place-items-center rounded-full bg-foreground font-mono text-xs font-semibold text-background">
				{number}
			</span>
			<div className="min-w-0 pt-1 text-[15px] leading-7 text-pretty text-foreground/80">
				<h2 className="mb-1.5 text-base font-semibold tracking-tight text-foreground">{title}</h2>
				{children}
			</div>
		</li>
	);
}
