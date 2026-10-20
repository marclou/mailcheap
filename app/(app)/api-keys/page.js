import Link from "next/link";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { revokeApiKey } from "@/app/(app)/api-keys/actions";
import BadgeStatus from "@/components/BadgeStatus";
import ButtonRevoke from "@/components/ButtonRevoke";
import DialogCreateApiKey from "@/components/DialogCreateApiKey";
import GatePlan from "@/components/GatePlan";
import HeaderPage from "@/components/HeaderPage";
import IconBrand, { AGENTS } from "@/components/IconBrand";
import StateEmpty from "@/components/StateEmpty";
import TableConnectedApps from "@/components/TableConnectedApps";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { getKeyLevel, listApiKeys } from "@/lib/api-keys";
import { requireAccount } from "@/lib/auth";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { getMcpClients, getMcpConnectors, getMcpUrl } from "@/lib/docs/mcp-clients";
import { formatDate, formatRelative } from "@/lib/format";
import { listConnectedApps } from "@/lib/oauth";
import { cn } from "@/lib/utils";

export const metadata = { title: "API keys" };

const LEVEL_LABELS = { full: "Full access", signups: "Signups only" };

export default async function ApiKeysPage() {
	const { account } = await requireAccount();
	await connectDb();
	const [apiKeys, connectedApps] = await Promise.all([listApiKeys(account), listConnectedApps(account)]);
	const appUrl = getAppUrl();

	return (
		<>
			<HeaderPage title="API keys">
				<Button asChild variant="outline">
					<Link href="/docs">
						API docs
						<ArrowUpRight data-icon="inline-end" className="opacity-60" />
					</Link>
				</Button>
				<GatePlan reason="apiKey">
					<DialogCreateApiKey />
				</GatePlan>
			</HeaderPage>

			<div className="flex flex-col gap-8">
				{apiKeys.length === 0 ? (
					<StateEmpty icon={KeyRound} title="No API keys yet" />
				) : (
					<div className="overflow-hidden rounded-xl shadow-border animate-enter">
						<Table>
							<TableHeader>
								<TableRow className="hover:bg-transparent">
									<TableHead className="pl-4">Name</TableHead>
									<TableHead>Key</TableHead>
									<TableHead className="hidden md:table-cell">Access</TableHead>
									<TableHead className="hidden sm:table-cell">Created</TableHead>
									<TableHead className="hidden sm:table-cell">Last used</TableHead>
									<TableHead className="w-24 pr-2" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{apiKeys.map((apiKey) => (
									<TableRow key={apiKey._id.toString()}>
										<TableCell className="py-2.5 pl-4 font-medium">{apiKey.name}</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">{apiKey.prefix}</TableCell>
										<TableCell className="hidden text-muted-foreground md:table-cell">
											{LEVEL_LABELS[getKeyLevel(apiKey)]}
										</TableCell>
										<TableCell className="hidden text-muted-foreground sm:table-cell">
											{formatDate(apiKey.createdAt)}
										</TableCell>
										<TableCell className="hidden text-muted-foreground sm:table-cell">
											{apiKey.lastUsedAt ? formatRelative(apiKey.lastUsedAt) : "Never"}
										</TableCell>
										<TableCell className="pr-2 text-right">
											{apiKey.revokedAt ? (
												<BadgeStatus status="revoked" />
											) : (
												<ButtonRevoke
													id={apiKey._id.toString()}
													revoke={revokeApiKey}
													confirmMessage={`Revoke "${apiKey.name}"? Apps using it stop working.`}
													successMessage="Key revoked"
												/>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}

				<section style={{ "--stagger": 1 }} className="flex flex-col gap-3 animate-enter">
					<h2 className="text-sm font-medium text-muted-foreground">Connected apps</h2>
					<TableConnectedApps apps={connectedApps} mcpUrl={getMcpUrl(appUrl)} />
				</section>

				<CardAgents agents={getAgentLinks(appUrl)} />
			</div>
		</>
	);
}

function CardAgents({ agents }) {
	return (
		<section style={{ "--stagger": 2 }} className="@container rounded-xl bg-card p-4 shadow-border animate-enter sm:p-5">
			<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
				<div className="max-w-lg">
					<h2 className="font-semibold tracking-tight">Run your newsletter with your AI agent</h2>
					<p className="mt-1 text-sm text-muted-foreground">Connect MailCheap to your AI agent. It writes, schedules and sends for you.</p>
				</div>
				<Link
					href="/docs/api"
					target="_blank"
					className="relative -my-1 inline-flex items-center gap-1 py-1 text-sm text-muted-foreground transition-colors duration-150 after:absolute after:-inset-x-2 after:-inset-y-2 hover:text-foreground"
				>
					API reference
					<ArrowUpRight className="size-3.5" />
				</Link>
			</div>
			<ul className={cn("mt-5 grid grid-cols-2 gap-2", agents.length > 4 ? "@lg:grid-cols-3" : "@lg:grid-cols-4")}>
				{agents.map(({ id, name, href }) => (
					<li key={id}>
						<Link
							href={href}
							target="_blank"
							className="group flex flex-col gap-3 rounded-2xl p-2.5 shadow-border transition-[box-shadow,background-color,scale] duration-150 ease-out hover:bg-muted/40 hover:shadow-border-hover active:scale-[0.96]"
						>
							<span className="flex items-start justify-between">
								<IconBrand brand={id} className="size-8" />
								<ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
							</span>
							<span className="px-0.5 text-sm font-medium">{name}</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}

// Each agent's section of the MCP page, or the page itself for an agent it doesn't cover yet.
function getAgentLinks(appUrl) {
	const documented = new Set([...getMcpConnectors(appUrl), ...getMcpClients(appUrl)].map(({ id }) => id));
	return AGENTS.map(({ id, name }) => ({ id, name, href: documented.has(id) ? `/docs/mcp#${id}` : "/docs/mcp" }));
}
