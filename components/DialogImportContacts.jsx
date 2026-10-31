"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronDown, FileUp, Loader2, Upload } from "lucide-react";
import Papa from "papaparse";
import { createContactField, importContacts } from "@/app/(app)/contacts/actions";
import BadgeStatus from "@/components/BadgeStatus";
import { notifyFinished } from "@/components/CardImports";
import InputTags from "@/components/InputTags";
import ListImportGuides from "@/components/ListImportGuides";
import { useContactOptions } from "@/components/ProviderContactOptions";
import ZoneUpload from "@/components/ZoneUpload";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cleanTags } from "@/lib/contact-fields";
import {
	CSV_ACCEPT,
	MAX_IMPORT_ROWS,
	assignColumnTarget,
	canBeNewField,
	describeColumnTarget,
	getColumnTargetOptions,
	labelFromColumn,
	normalizeImportRow,
	planColumns,
	readColumnPlan,
	splitImportChunks,
} from "@/lib/csv-import";
import { formatNumber } from "@/lib/format";
import { CONSENT_TEXT } from "@/lib/import-checks";
import { toast } from "@/lib/toast";
import { acceptsFile, useFileDrop, usePageFileDrop } from "@/lib/use-file-drop";
import { usePaywall } from "@/lib/use-paywall";
import { cn } from "@/lib/utils";

const MAX_FILE_MB = 100;
const PREVIEW_ROWS = 6;

// Into the newsletter the page shows. The file is read in the browser: a preview of the first contacts and where each
// column goes, then its rows go to MailCheap in chunks and are imported in the background, which the contacts page
// follows (CardImports). Closing the dialog while the rows are sent doesn't stop them. A CSV dropped on the dialog, or
// anywhere on the page, is read like one picked; without a plan, the page drop opens the paywall, like the button.
// guides: how to export the file from other platforms, under the drop zone (siteExtensions.importGuides). isOpen and
// onOpenChange: for a page that opens it from elsewhere, like the Contacts page's Add contacts, without its own button;
// onCloseAutoFocus then says where the focus goes back.
export default function DialogImportContacts({
	newsletter,
	guides = [],
	label = "Import",
	variant = "outline",
	isOpen: isOpenProp,
	onOpenChange,
	onCloseAutoFocus,
}) {
	const router = useRouter();
	const paywall = usePaywall();
	const { fields, tags: tagOptions } = useContactOptions();
	const [isOpenState, setIsOpenState] = useState(false);
	const isOpen = isOpenProp ?? isOpenState;
	const [file, setFile] = useState(null);
	const [parsed, setParsed] = useState(null);
	const [plan, setPlan] = useState([]);
	const [mode, setMode] = useState("file");
	const [importTags, setImportTags] = useState([]);
	const [hasConsent, setHasConsent] = useState(false);
	const [sending, setSending] = useState(null);
	const [isImporting, startImporting] = useTransition();
	const { columns, profile } = useMemo(() => readColumnPlan(plan, fields), [plan, fields]);

	// Invalid rows still go to the server, which checks every row again and counts them in the import.
	const { rows, invalidRows, duplicates } = useMemo(() => {
		if (!parsed || !columns.email) return { rows: [], invalidRows: [], duplicates: 0 };
		const options = { ...(mode === "dormant" && { status: "dormant" }), profile };
		const byEmail = new Map();
		const invalid = [];
		for (const row of parsed.rows) {
			const normalized = normalizeImportRow(row, columns, options);
			if (!normalized) invalid.push({ email: String(row[columns.email] ?? "").slice(0, 254), status: "active" });
			else if (!byEmail.has(normalized.email)) byEmail.set(normalized.email, withTags(normalized, importTags));
		}
		return { rows: [...byEmail.values()], invalidRows: invalid, duplicates: parsed.rows.length - invalid.length - byEmail.size };
	}, [parsed, columns, profile, mode, importTags]);

	function setIsOpen(open) {
		setIsOpenState(open);
		onOpenChange?.(open);
	}

	function reset() {
		setFile(null);
		setParsed(null);
		setPlan([]);
		setMode("file");
		setImportTags([]);
		setHasConsent(false);
		setSending(null);
	}

	const isSending = sending !== null;
	const { isDragging, dropProps } = useFileDrop({ accept: CSV_ACCEPT, onFile: takeFile, onReject: rejectFile });
	const isPageDragging = usePageFileDrop({
		accept: CSV_ACCEPT,
		onFile(selected) {
			if (!newsletter || isSending) return;
			if (paywall && !paywall.hasPlan) return paywall.open("import");
			setIsOpen(true);
			takeFile(selected);
		},
		onReject: rejectFile,
	});

	function rejectFile() {
		toast.error("Drop a CSV file");
	}

	// A new file replaces the last one; the options, tags and consent already set stay.
	function takeFile(selected) {
		if (isSending) return;
		if (!acceptsFile(selected, CSV_ACCEPT)) return rejectFile();
		readFile(selected);
	}

	function readFile(selected) {
		if (!selected) return;
		if (selected.size > MAX_FILE_MB * 1024 * 1024) return void toast.error(`This file is over ${MAX_FILE_MB} MB: split it in parts`);
		Papa.parse(selected, {
			header: true,
			skipEmptyLines: true,
			complete: ({ data, meta }) => {
				if (data.length === 0) return void toast.error("This file has no rows");
				if (data.length > MAX_IMPORT_ROWS) {
					return void toast.error(`An import takes ${formatNumber(MAX_IMPORT_ROWS)} rows at most: split the file in parts`);
				}
				setFile(selected);
				setParsed({ rows: data });
				setPlan(planColumns(meta.fields ?? [], fields, data));
			},
			error: () => toast.error("Could not read this file"),
		});
	}

	// Fields made from columns come first, so the rows' values for them are kept.
	async function createNewFields() {
		for (const { column, target } of plan.filter((item) => item.target.startsWith("new:"))) {
			const result = await createContactField({ label: labelFromColumn(column), type: target.slice("new:".length) });
			if (result?.error && !result.error.startsWith("There's already")) return result.error;
		}
		return null;
	}

	function runImport() {
		const allRows = [...rows, ...invalidRows];
		const chunks = splitImportChunks(allRows);
		const fileName = file?.name;
		startImporting(async () => {
			const fieldProblem = await createNewFields();
			if (fieldProblem) return void toast.error(fieldProblem);
			setSending({ sent: 0, total: allRows.length });
			let importId;
			let sent = 0;
			let result;
			for (const chunk of chunks) {
				result = await importContacts({
					newsletterId: newsletter.id,
					consent: hasConsent,
					importId,
					rows: chunk,
					...(!importId && { duplicates, total: allRows.length, fileName }),
				});
				if (result?.error) {
					setSending(null);
					return void toast.error(result.error);
				}
				// The contacts page shows the import from its first chunk on.
				if (!importId) router.refresh();
				importId = result.importId;
				sent += chunk.length;
				setSending({ sent, total: allRows.length });
			}
			// A small file went in while it was sent; a bigger one goes on in the background, on the contacts page.
			if (result?.status === "done") {
				notifyFinished(result);
				router.refresh();
			}
			setIsOpen(false);
			reset();
		});
	}

	// Between the title and the button, scrolling when the preview and the columns are taller than the window.
	function renderBody() {
		if (isSending) return <StatusSending sending={sending} />;
		if (!parsed) {
			return (
				<div className="flex flex-col gap-4">
					<ZoneUpload
						icon={FileUp}
						title="Drop a CSV file or choose one"
						hint={`Up to ${formatNumber(MAX_IMPORT_ROWS)} rows`}
						dropTitle="Drop to read it"
						accept={CSV_ACCEPT}
						isDragging={isDragging}
						onFile={takeFile}
						className="py-10"
					/>
					<ListImportGuides guides={guides} />
				</div>
			);
		}
		return (
			<div className="flex min-w-0 flex-col gap-6">
				<SummaryFile file={file} rowCount={parsed.rows.length} contacts={rows} hasEmail={Boolean(columns.email)} onReplace={reset} />
				{columns.email && <TablePreview contacts={rows.slice(0, PREVIEW_ROWS)} total={rows.length} profile={profile} fields={fields} />}
				<SectionColumns plan={plan} fields={fields} onChange={(column, target) => setPlan((current) => assignColumnTarget(current, column, target))} />
				<SectionOptions mode={mode} onMode={setMode} tags={importTags} onTags={setImportTags} tagOptions={tagOptions} />
				<label className="flex items-start gap-2.5 text-sm">
					<input
						type="checkbox"
						checked={hasConsent}
						onChange={(event) => setHasConsent(event.target.checked)}
						className="mt-0.5 size-4 shrink-0 accent-foreground"
					/>
					<span>
						{CONSENT_TEXT}
						<span className="block text-xs text-muted-foreground">
							Role addresses, throwaway inboxes and addresses that bounced or complained are left out. You can bring back role
							addresses and throwaway inboxes after.
						</span>
					</span>
				</label>
			</div>
		);
	}

	return (
		<>
			{isPageDragging && !isOpen && <OverlayDrop />}
			<Dialog
				open={isOpen}
				onOpenChange={(open) => {
					setIsOpen(open);
					if (!open && !isSending) reset();
				}}
			>
				{isOpenProp === undefined && (
					<DialogTrigger asChild>
						<Button variant={variant} disabled={!newsletter}>
							<Upload data-icon="inline-start" />
							{label}
						</Button>
					</DialogTrigger>
				)}
				<DialogContent
					{...dropProps}
					onCloseAutoFocus={onCloseAutoFocus}
					className={cn(
						"max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]",
						parsed && !isSending ? "sm:max-w-2xl" : "sm:max-w-md"
					)}
				>
					{isDragging && parsed && (
						<div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-xl bg-popover/85 p-6 text-center backdrop-blur-[2px] animate-fade-in">
							<span className="flex flex-col items-center gap-2">
								<FileUp className="size-5 text-muted-foreground" aria-hidden="true" />
								<span className="text-sm font-medium">Drop to use this file instead</span>
							</span>
						</div>
					)}
					<DialogHeader>
						<DialogTitle>Import contacts</DialogTitle>
						<DialogDescription>
							Into <span className="font-medium text-foreground">{newsletter?.name}</span>.{" "}
							{parsed
								? "Check the first contacts and where each column goes."
								: "A CSV with an email column: exports from beehiiv, Substack, Mailchimp, Kit and others work as they are."}
						</DialogDescription>
					</DialogHeader>

					<div className="-mx-4 min-h-0 overflow-y-auto px-4 pb-1">{renderBody()}</div>

					{(isSending || parsed) && (
						<DialogFooter>
							{isSending ? (
								<Button variant="outline" onClick={() => setIsOpen(false)} className="min-w-24">
									Close
								</Button>
							) : (
								<Button onClick={runImport} disabled={!newsletter || rows.length === 0 || !hasConsent || isImporting} className="min-w-24">
									{isImporting ? <Loader2 className="animate-spin" /> : `Import ${formatNumber(rows.length)} ${rows.length === 1 ? "contact" : "contacts"}`}
								</Button>
							)}
						</DialogFooter>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

// While a file is dragged over the page. It lets the drag through to the page underneath, where the drop is caught.
function OverlayDrop() {
	return createPortal(
		<div
			aria-hidden="true"
			className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/60 p-6 backdrop-blur-[2px] animate-fade-in"
		>
			<div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-foreground/25 bg-background px-10 py-8 text-center shadow-lg">
				<span className="mb-1 grid size-11 place-items-center rounded-full bg-muted shadow-border">
					<FileUp className="size-5" />
				</span>
				<span className="text-sm font-medium">Drop to import contacts</span>
				<span className="text-xs text-muted-foreground">A CSV with an email column</span>
			</div>
		</div>,
		document.body
	);
}

function SummaryFile({ file, rowCount, contacts, hasEmail, onReplace }) {
	const statusCounts = Object.entries(Object.groupBy(contacts, ({ status }) => status)).map(([status, group]) => [status, group.length]);
	return (
		<div className="flex flex-col gap-2.5">
			<div className="flex min-w-0 items-center gap-3">
				<FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<p className="min-w-0 flex-1 truncate text-sm">
					<span className="font-medium">{file?.name}</span>{" "}
					<span className="text-muted-foreground tabular-nums">
						{formatNumber(rowCount)} {rowCount === 1 ? "row" : "rows"}
						{hasEmail && `, ${formatNumber(contacts.length)} unique valid ${contacts.length === 1 ? "address" : "addresses"}`}
					</span>
				</p>
				<Button variant="ghost" size="sm" onClick={onReplace} className="shrink-0 text-muted-foreground">
					Another file
				</Button>
			</div>
			{hasEmail ? (
				<div className="flex flex-wrap gap-1.5">
					{statusCounts.map(([status, count]) => (
						<BadgeStatus key={status} status={status} label={`${statusLabel(status)} ${formatNumber(count)}`} className="tabular-nums" />
					))}
				</div>
			) : (
				<p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
					No column was recognized as the email address: pick it below.
				</p>
			)}
		</div>
	);
}

// The first contacts as MailCheap will hold them: tags, and the first two fields the import fills.
function TablePreview({ contacts, total, profile, fields }) {
	const shownFields = profile.fields.slice(0, 2).map(({ column, key }) => ({
		key,
		label: fields.find((field) => field.key === key)?.label ?? labelFromColumn(column),
	}));
	const hasName = Boolean(profile.firstName);
	const hasTags = contacts.some((contact) => contact.tags?.length);
	return (
		<section className="flex min-w-0 flex-col gap-2">
			<h3 className="flex items-baseline justify-between gap-3 text-sm font-medium">
				Preview
				<span className="text-xs font-normal text-muted-foreground tabular-nums">
					First {formatNumber(contacts.length)} of {formatNumber(total)}
				</span>
			</h3>
			<div className="overflow-x-auto rounded-xl shadow-border">
				<table className="w-full text-left text-[13px]">
					<thead className="text-xs text-muted-foreground">
						<tr className="border-b border-border/60">
							<th className="px-3 py-2 font-normal">Email</th>
							{hasName && <th className="px-3 py-2 font-normal whitespace-nowrap">First name</th>}
							<th className="px-3 py-2 font-normal">Status</th>
							{hasTags && <th className="px-3 py-2 font-normal">Tags</th>}
							{shownFields.map((field) => (
								<th key={field.key} className="px-3 py-2 font-normal whitespace-nowrap">
									{field.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-y divide-border/60">
						{contacts.map((contact) => (
							<tr key={contact.email}>
								<td className="max-w-56 truncate px-3 py-2 font-medium">{contact.email}</td>
								{hasName && <td className="max-w-32 truncate px-3 py-2">{contact.firstName ?? <Empty />}</td>}
								<td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{statusLabel(contact.status)}</td>
								{hasTags && (
									<td className="max-w-44 truncate px-3 py-2 text-muted-foreground">
										{contact.tags?.length ? contact.tags.join(", ") : <Empty />}
									</td>
								)}
								{shownFields.map((field) => (
									<td key={field.key} className="max-w-40 truncate px-3 py-2 text-muted-foreground">
										{contact.fields?.[field.key] ?? <Empty />}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function Empty() {
	return <span className="text-muted-foreground/50">-</span>;
}

// Columns going into a new field or left out need a look; recognized ones fold away, still editable.
function SectionColumns({ plan, fields, onChange }) {
	const toCheck = plan.filter((item) => !item.auto && item.target !== "skip");
	const skipped = plan.filter((item) => !item.auto && item.target === "skip");
	const recognized = plan.filter((item) => item.auto);
	const rowProps = { plan, fields, onChange };
	return (
		<section className="flex min-w-0 flex-col gap-2">
			<div className="flex flex-col gap-0.5">
				<h3 className="text-sm font-medium">Columns</h3>
				<p className="text-xs text-pretty text-muted-foreground">
					Tags label people, many each. A field keeps one value per person, like a company.
				</p>
			</div>
			{(toCheck.length > 0 || skipped.length > 0) && (
				<GroupColumns title="Needs a look" items={toCheck} hidden={skipped} hiddenLabel="not imported" {...rowProps} />
			)}
			{recognized.length > 0 && <GroupColumns title="Recognized" items={recognized} isFolded {...rowProps} />}
		</section>
	);
}

function GroupColumns({ title, items, hidden = [], hiddenLabel, isFolded = false, ...rowProps }) {
	const [isOpen, setIsOpen] = useState(!isFolded);
	const [isHiddenOpen, setIsHiddenOpen] = useState(false);
	const count = items.length + hidden.length;
	return (
		<div className="rounded-xl shadow-border">
			<button
				type="button"
				onClick={() => setIsOpen((open) => !open)}
				aria-expanded={isOpen}
				className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				<span className="font-medium">{title}</span>
				<span className="text-xs text-muted-foreground tabular-nums">{formatNumber(count)}</span>
				<ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} aria-hidden="true" />
			</button>
			{isOpen && (
				<ul className="divide-y divide-border/60 border-t border-border/60">
					{items.map((item) => (
						<RowColumn key={item.column} item={item} {...rowProps} />
					))}
					{hidden.length > 0 && (
						<li>
							<button
								type="button"
								onClick={() => setIsHiddenOpen((open) => !open)}
								aria-expanded={isHiddenOpen}
								className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
							>
								{formatNumber(hidden.length)} {hidden.length === 1 ? "column" : "columns"} {hiddenLabel}, like {hidden[0].column}
								<ChevronDown className={cn("size-3.5 transition-transform duration-200", isHiddenOpen && "rotate-180")} aria-hidden="true" />
							</button>
							{isHiddenOpen && (
								<ul className="divide-y divide-border/60 border-t border-border/60">
									{hidden.map((item) => (
										<RowColumn key={item.column} item={item} {...rowProps} />
									))}
								</ul>
							)}
						</li>
					)}
				</ul>
			)}
		</div>
	);
}

// A column, a few of its values, and where they go, in plain words.
function RowColumn({ item, plan, fields, onChange }) {
	const options = getColumnTargetOptions(item);
	const newTarget = `new:${item.newType}`;
	const isNewFieldAllowed = canBeNewField(item, plan, fields);
	const describe = (target) => describeColumnTarget(target, { column: item.column, fields, newType: item.newType });
	return (
		<li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm">{item.column}</p>
				<p className="truncate text-xs text-muted-foreground">{item.samples.length ? item.samples.join(" · ") : "Empty"}</p>
			</div>
			<Select value={item.target} onValueChange={(target) => onChange(item.column, target)}>
				<SelectTrigger size="sm" className="w-full shrink-0 sm:w-60" aria-label={`Where ${item.column} goes`}>
					<SelectValue>{describe(item.target)}</SelectValue>
				</SelectTrigger>
				<SelectContent align="end">
					<SelectGroup>
						<SelectLabel>Contact</SelectLabel>
						{options.contact.map((target) => (
							<SelectItem key={target} value={target}>
								{describe(target)}
							</SelectItem>
						))}
					</SelectGroup>
					{options.recognized.length > 0 && (
						<SelectGroup>
							<SelectLabel>{"From the platform you're leaving"}</SelectLabel>
							{options.recognized.map((target) => (
								<SelectItem key={target} value={target}>
									{describe(target)}
								</SelectItem>
							))}
						</SelectGroup>
					)}
					{(fields.length > 0 || isNewFieldAllowed) && (
						<SelectGroup>
							<SelectLabel>Fields</SelectLabel>
							{fields.map(({ key }) => (
								<SelectItem key={key} value={`field:${key}`}>
									{describe(`field:${key}`)}
								</SelectItem>
							))}
							{isNewFieldAllowed && <SelectItem value={newTarget}>{describe(newTarget)}</SelectItem>}
						</SelectGroup>
					)}
					<SelectSeparator />
					<SelectItem value="skip">{describe("skip")}</SelectItem>
				</SelectContent>
			</Select>
		</li>
	);
}

function SectionOptions({ mode, onMode, tags, onTags, tagOptions }) {
	return (
		<section className="grid gap-4 sm:grid-cols-2">
			<div className="flex flex-col gap-1.5">
				<span className="text-sm font-medium">Status</span>
				<Select value={mode} onValueChange={onMode}>
					<SelectTrigger className="h-9 w-full" aria-label="Status">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="file">From the file</SelectItem>
						<SelectItem value="dormant">Everyone dormant</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-1.5">
				<span className="text-sm font-medium">Tag everyone</span>
				<InputTags value={tags} onChange={onTags} suggestions={tagOptions} maxSuggestions={6} max={10} placeholder="Optional, e.g. from-beehiiv" />
			</div>
		</section>
	);
}

function StatusSending({ sending }) {
	const share = sending.total ? sending.sent / sending.total : 0;
	return (
		<div className="flex flex-col gap-3 py-1">
			<div className="flex items-baseline justify-between gap-3 text-sm">
				<span className="font-medium">Sending the file</span>
				<span className="text-xs text-muted-foreground tabular-nums">
					{formatNumber(sending.sent)} of {formatNumber(sending.total)}
				</span>
			</div>
			<div className="h-1.5 overflow-hidden rounded-full bg-muted">
				<div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${Math.max(share, 0.02) * 100}%` }} />
			</div>
			<p className="text-xs text-pretty text-muted-foreground">
				{"You can close this: the import goes on in the background, and the contacts page shows how it's doing."}
			</p>
		</div>
	);
}

function withTags(row, tags) {
	if (tags.length === 0) return row;
	return { ...row, tags: cleanTags([...(row.tags ?? []), ...tags]) };
}

function statusLabel(status) {
	return status.charAt(0).toUpperCase() + status.slice(1);
}
