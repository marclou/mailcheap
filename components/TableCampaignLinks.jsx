import LinkHelp from "@/components/LinkHelp";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber, formatRate } from "@/lib/format";
import { formatLinkUrl, getLinkLabels } from "@/lib/link-stats";

const SHOWN = 50;

// A sent issue's clicked links, most clicked first: the contacts who clicked each, every click, and each link's share of
// the contacts who clicked any. Labels are what the email shows: the link's text, or its picture's alt text. Only for an
// issue with clicked links: the report's Clicked card already says when there are none.
export default function TableCampaignLinks({ stats, html, webUrl, style }) {
	const labels = getLinkLabels(html, { webUrl });
	const links = stats.links.slice(0, SHOWN);

	return (
		<div style={style} className="flex flex-col gap-2 animate-enter">
			<div className="overflow-hidden rounded-xl shadow-border">
				<Table className="table-fixed">
					<TableHeader>
						<TableRow className="hover:bg-transparent">
							<TableHead className="w-full pl-4">Link</TableHead>
							<TableHead className="w-20 text-right sm:w-24">Contacts</TableHead>
							<TableHead className="hidden w-20 text-right sm:table-cell">Clicks</TableHead>
							<TableHead className="w-16 pr-4 text-right sm:w-28">Share</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{links.map((link) => (
							<RowLink key={link.key} link={link} label={labels.get(link.key)} total={stats.clickers} />
						))}
					</TableBody>
				</Table>
			</div>
			{!stats.isComplete && stats.countedSince && (
				<p className="px-1 text-xs text-muted-foreground">
					Counted since {formatDate(stats.countedSince)}. <LinkHelp article="sending" section="report" />
				</p>
			)}
		</div>
	);
}

function RowLink({ link, label, total }) {
	const url = formatLinkUrl(link.url);
	const share = total ? Math.min(link.clickers / total, 1) : 0;

	return (
		<TableRow className="tabular-nums">
			<TableCell className="max-w-0 pl-4">
				<span className="flex min-w-0 flex-col">
					{label && <span className="truncate font-medium">{label}</span>}
					<a
						href={link.url}
						target="_blank"
						rel="noopener noreferrer nofollow"
						title={link.url}
						className={label ? "truncate text-xs text-muted-foreground hover:underline" : "truncate hover:underline"}
					>
						{url}
					</a>
				</span>
			</TableCell>
			<TableCell className="text-right">{formatNumber(link.clickers)}</TableCell>
			<TableCell className="hidden text-right sm:table-cell">{formatNumber(link.clicks)}</TableCell>
			<TableCell className="pr-4">
				<span className="flex items-center justify-end gap-2.5">
					<span aria-hidden="true" className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted sm:block">
						<span className="block h-full rounded-full bg-foreground/70" style={{ width: `${share * 100}%` }} />
					</span>
					<span className="w-11 text-right">{formatRate(link.clickers, total, 0) ?? "0%"}</span>
				</span>
			</TableCell>
		</TableRow>
	);
}
