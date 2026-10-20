import BlockCode from "@/components/BlockCode";
import HeaderDocs from "@/components/HeaderDocs";
import { ERRORS } from "@/lib/actions/errors";
import { getDocsPageMetadata } from "@/lib/docs/llms";

export const metadata = getDocsPageMetadata("/docs/errors");

export default function ErrorsPage() {
	return (
		<>
			<HeaderDocs kicker="Guides" title="Errors">
				Every error has the same shape, with a code that never changes meaning. Branch on the code; show the message.
			</HeaderDocs>

			<div style={{ "--stagger": 1 }} className="grid max-w-3xl gap-4 animate-enter">
				<BlockCode
					title="409 Conflict"
					code={JSON.stringify({ error: { code: "conflict", message: "This campaign is already sending" } }, null, 2)}
				/>
				<p className="text-[15px] leading-7 text-pretty text-foreground/80">
					The message names the field when the input is wrong, and says what to do when a rule stops the action. MCP tools answer the
					same object in an error result. Sending a campaign that is already sending or sent answers <Code>conflict</Code>, so a retried
					send never goes out twice.
				</p>
			</div>

			<div style={{ "--stagger": 2 }} className="mt-10 max-w-3xl overflow-hidden rounded-xl shadow-border animate-enter">
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b border-border/60 text-xs text-muted-foreground">
							<th className="py-2 pl-4 font-normal">Code</th>
							<th className="w-16 py-2 font-normal">Status</th>
							<th className="hidden py-2 pr-4 font-normal sm:table-cell">Meaning</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border/60 align-top">
						{Object.entries(ERRORS).map(([code, { status, description }]) => (
							<tr key={code} id={code} className="scroll-mt-20 transition-colors duration-500 target:bg-muted/60">
								<td className="py-3 pr-3 pl-4">
									<code className="font-mono text-[13px]">{code}</code>
									<p className="mt-1 text-[13px] leading-5 text-muted-foreground sm:hidden">{description}</p>
								</td>
								<td className="py-3 font-mono text-[13px] text-muted-foreground tabular-nums">{status}</td>
								<td className="hidden py-3 pr-4 text-[13px] leading-5 text-pretty text-muted-foreground sm:table-cell">{description}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}

function Code({ children }) {
	return <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">{children}</code>;
}
