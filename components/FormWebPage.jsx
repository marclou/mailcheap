"use client";

import { useCallback, useDeferredValue, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ExternalLink, Eye, GlobeOff, MoreHorizontal, RotateCcw } from "lucide-react";
import { toggleArchivePin, updateWebPage } from "@/app/(app)/campaigns/actions";
import BadgeStatus from "@/components/BadgeStatus";
import BarSave from "@/components/BarSave";
import ButtonCopy from "@/components/ButtonCopy";
import DialogPreviewWebPage from "@/components/DialogPreviewWebPage";
import DialogUnpublishCampaign from "@/components/DialogUnpublishCampaign";
import EditorRich from "@/components/EditorRich";
import ImageFavicon from "@/components/ImageFavicon";
import ImageShareCard from "@/components/ImageShareCard";
import InputCampaignSlug from "@/components/InputCampaignSlug";
import PickerWebImage from "@/components/PickerWebImage";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { toIssueBody } from "@/lib/issue-body";
import { withMergeFallbacks } from "@/lib/merge-tags";
import { getIssueCard } from "@/lib/share-card";
import { listImageUrls } from "@/lib/thumbnail";
import { toast } from "@/lib/toast";
import { useCollapsedSidebar } from "@/lib/use-collapsed-sidebar";
import { useToastError } from "@/lib/use-toast-error";
import { MAX_WEB_DESCRIPTION_LENGTH, MAX_WEB_TITLE_LENGTH, WEB_CARD } from "@/lib/web-page";

const UPLOADING_MESSAGE = "Wait for images to finish uploading";
const MAX_PICTURES = 4;
const PAGE_FIELDS = ["title", "description", "image", "body"];

// The page of an issue that's on its website (app/(app)/campaigns/[id]/web): its title and description over its content
// as the page shows them, in the campaign editor without sections, which only emails resolve, and beside them its card
// as the website and link previews show it, with its picture, its address and its place on the website. Update page puts
// the changes on the website at once, once the content check has read them (update_campaign_archive), and the emails stay
// as they were sent; Preview shows the page with them first. content: { format, body }, what the page shows;
// emailContent: the same for the email, once the page has content of its own, which Restore brings back. otherPictures:
// what the newsletter's other issues show (lib/archive-data.js). isListed: on the website's home page, which only then
// takes a pin. author: { name, imageUrl }, who the page says wrote it.
export default function FormWebPage({
	campaign,
	content,
	emailContent,
	isWebOnly,
	publishedOn,
	publishedAt,
	newsletter,
	contactFields: savedFields,
	pageUrl,
	urlBase,
	otherPictures,
	isPinned,
	isListed,
	author,
}) {
	const router = useRouter();
	const subject = campaign.subject ?? "";
	const previewText = campaign.previewText ?? "";
	const [saved, setSaved] = useState(() => ({
		title: campaign.web?.title || subject,
		description: campaign.web?.description || previewText,
		image: campaign.web?.image ?? "",
		body: content.body,
	}));
	const [values, setValues] = useState(saved);
	const [savedAt, setSavedAt] = useState(null);
	// The editor opens on what it's given, so going back to saved content or the email's starts it over.
	const [editor, setEditor] = useState({ key: 0, body: content.body });
	const [editedFields, setEditedFields] = useState(null);
	const [isUpdating, startUpdating] = useTransition();
	const [preview, setPreview] = useState(null);
	const [isPreviewOpen, setIsPreviewOpen] = useState(false);
	const [isRemoveOpen, setIsRemoveOpen] = useState(false);
	const cardRef = useRef(null);
	useCollapsedSidebar();
	const contactFields = editedFields ?? savedFields;
	const isHtml = content.format === "html";
	const isDirty = PAGE_FIELDS.some((key) => values[key] !== saved[key]);
	const isUploading = /<img\b[^>]*\ssrc="blob:/.test(values.body);
	const body = useDeferredValue(values.body);
	const pictures = useMemo(() => listImageUrls({ format: content.format, html: body }, MAX_PICTURES), [content.format, body]);
	const autoImage = pictures[0] && !otherPictures.includes(pictures[0]) ? pictures[0] : null;
	const host = new URL(pageUrl).host;
	const title = withMergeFallbacks(values.title.trim() || subject, { contactFields });
	const description = withMergeFallbacks(values.description.trim() || previewText, { contactFields });
	const card = getIssueCard({ newsletter, title, description, slug: campaign.archiveSlug, date: publishedOn, domain: host });
	const updateBody = useCallback((html) => setValues((current) => ({ ...current, body: html })), []);

	function change(key) {
		return (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
	}

	function startEditor(nextBody) {
		setEditor((current) => ({ key: current.key + 1, body: nextBody }));
	}

	function discard() {
		setValues(saved);
		startEditor(saved.body);
	}

	function restoreEmail() {
		setValues((current) => ({ ...current, body: emailContent.body }));
		startEditor(emailContent.body);
	}

	// The page as its website will show it with what's typed, made when it opens and kept while it closes.
	function openPreview() {
		const issue = isHtml
			? { format: "html", html: values.body, subject: title, previewText: description }
			: { format: "rich", html: values.body };
		setPreview({ url: pageUrl, title, description, date: publishedAt, author, newsletter, body: toIssueBody(issue) });
		setIsPreviewOpen(true);
	}

	// Only what changed. A title or a description back to the email's own is none of the page's, and the email's content
	// as it was makes the page show the email's again.
	function update(event) {
		event.preventDefault();
		if (!isDirty || isUpdating) return;
		if (isUploading) return void toast.error(UPLOADING_MESSAGE);
		const changes = {};
		if (values.title !== saved.title) changes.title = values.title.trim() === subject ? "" : values.title;
		if (values.description !== saved.description) changes.description = values.description.trim() === previewText ? "" : values.description;
		if (values.image !== saved.image) changes.image = values.image;
		if (values.body !== saved.body) {
			Object.assign(changes, emailContent && values.body === emailContent.body ? { content: null } : { content: values.body, format: content.format });
		}
		startUpdating(async () => {
			const result = await updateWebPage(campaign._id, changes);
			if (result?.error) return void toast.error(result.error);
			setSaved(values);
			setSavedAt(Date.now());
			router.refresh();
		});
	}

	return (
		<form onSubmit={update}>
			<header className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 animate-enter">
				<TitleWebPage campaign={campaign} isWebOnly={isWebOnly} publishedOn={publishedOn} />
				<div className="flex items-center gap-2">
					<Button type="button" variant="outline" onClick={openPreview}>
						<Eye data-icon="inline-start" />
						Preview
					</Button>
					<Button asChild variant="outline">
						<a href={pageUrl} target="_blank" rel="noreferrer">
							<ExternalLink data-icon="inline-start" />
							View page
						</a>
					</Button>
					{emailContent && <MenuWebPage isWebOnly={isWebOnly} onRestore={restoreEmail} />}
				</div>
			</header>

			<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
				<section
					ref={cardRef}
					aria-label="Web page"
					style={{ "--stagger": 1 }}
					className="relative min-w-0 rounded-xl bg-card shadow-border animate-enter"
				>
					<div className="px-5 pt-8 pb-6 sm:pt-11 [@media(pointer:fine)]:pr-8 [@media(pointer:fine)]:pl-12">
						<textarea
							value={values.title}
							onChange={change("title")}
							onKeyDown={keepOnOneLine}
							placeholder={subject || "Title"}
							aria-label="Title"
							maxLength={MAX_WEB_TITLE_LENGTH}
							rows={1}
							className="block w-full resize-none bg-transparent text-3xl leading-tight font-semibold tracking-tight text-balance outline-none [field-sizing:content] placeholder:text-muted-foreground/60 sm:text-4xl"
						/>
						<textarea
							value={values.description}
							onChange={change("description")}
							onKeyDown={keepOnOneLine}
							placeholder={previewText || "A line under the title"}
							aria-label="Description"
							maxLength={MAX_WEB_DESCRIPTION_LENGTH}
							rows={1}
							className="mt-3 block w-full resize-none bg-transparent text-lg text-pretty text-muted-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground/50"
						/>
					</div>
					<div className="border-t border-border/60">
						{isHtml ? (
							<div className="relative">
								<span className="pointer-events-none absolute top-3 right-4 text-xs text-muted-foreground">HTML</span>
								<textarea
									value={values.body}
									onChange={change("body")}
									placeholder="<html>"
									spellCheck={false}
									aria-label="Content"
									className="block min-h-[560px] w-full resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground"
								/>
							</div>
						) : (
							<EditorRich
								key={editor.key}
								gutterRef={cardRef}
								content={editor.body}
								onChange={updateBody}
								contactFields={contactFields}
								onContactFieldsChange={setEditedFields}
								newsletter={newsletter}
							/>
						)}
					</div>
				</section>

				<aside style={{ "--stagger": 2 }} className="flex flex-col gap-3 animate-enter">
					<CardShared image={values.image === WEB_CARD ? null : values.image || autoImage} card={card} host={host} title={title} description={description}>
						<PickerWebImage
							value={values.image}
							pictures={pictures}
							autoImage={autoImage}
							card={card}
							onChange={(image) => setValues((current) => ({ ...current, image }))}
							isLarge
						/>
					</CardShared>
					<CardOnWebsite
						id={campaign._id}
						slug={campaign.archiveSlug}
						urlBase={urlBase}
						pageUrl={pageUrl}
						isPinned={isPinned}
						isListed={isListed}
						onRemove={() => setIsRemoveOpen(true)}
					/>
				</aside>
			</div>

			<BarSave isDirty={isDirty} isSaving={isUpdating} savedAt={savedAt} onDiscard={discard} label="Update page" />
			{preview && <DialogPreviewWebPage isOpen={isPreviewOpen} onOpenChange={setIsPreviewOpen} {...preview} />}
			<DialogUnpublishCampaign
				id={campaign._id}
				subject={subject}
				isWebOnly={isWebOnly}
				isOpen={isRemoveOpen}
				onOpenChange={setIsRemoveOpen}
				redirectTo="/campaigns"
				onRemoved={({ isDeleted }) => !isDeleted && router.replace(`/campaigns/${campaign._id}`)}
			/>
		</form>
	);
}

// A title or a description is one line: Enter adds no other.
function keepOnOneLine(event) {
	if (event.key === "Enter") event.preventDefault();
}

// Under the campaign, whose page the back arrow and its subject go back to: Subject / Web page, then when it went out.
function TitleWebPage({ campaign, isWebOnly, publishedOn }) {
	const href = `/campaigns/${campaign._id}`;
	return (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<Link
				href={href}
				aria-label="Back"
				className="-ml-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
			>
				<ChevronLeft className="size-5" />
			</Link>
			<div className="flex min-w-0 flex-col gap-1.5">
				<div className="flex min-w-0 items-center gap-2 text-2xl font-semibold tracking-tight">
					<Link href={href} className="truncate text-muted-foreground transition-colors duration-150 hover:text-foreground max-sm:hidden">
						{campaign.subject || "Untitled"}
					</Link>
					<span aria-hidden="true" className="font-normal text-muted-foreground/50 max-sm:hidden">
						/
					</span>
					<h1 className="shrink-0">Web page</h1>
				</div>
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
					<BadgeStatus status="sent" label={isWebOnly ? "Published" : "Sent"} />
					<span className="tabular-nums">{publishedOn}</span>
					<span aria-hidden="true">·</span>
					<span>{isWebOnly ? "Changes update your website" : "Changes update your website, not the email"}</span>
				</p>
			</div>
		</div>
	);
}

// The page's card as the website and link previews show it, as it's typed, over the picture's choices.
function CardShared({ image, card, host, title, description, children }) {
	return (
		<section aria-label="Card" className="overflow-hidden rounded-xl bg-card shadow-border">
			<p className="px-4 pt-3 text-xs font-medium text-muted-foreground">On your website and in link previews</p>
			<div className="p-2 pt-2.5">
				<div className="overflow-hidden rounded-lg bg-background outline -outline-offset-1 outline-foreground/10">
					{image ? (
						// eslint-disable-next-line @next/next/no-img-element -- any https:// picture of the issue, at its own size
						<img src={image} alt="" className="aspect-[1200/630] w-full bg-muted object-cover" />
					) : (
						<span className="@container block aspect-[1200/630]">
							<ImageShareCard {...card} isFluid />
						</span>
					)}
					<div className="px-3 pt-2.5 pb-3">
						<p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
							<ImageFavicon domain={host} size={12} />
							<span className="truncate">{host}</span>
						</p>
						<p className="mt-1 line-clamp-2 text-sm/snug font-semibold text-balance">{title || "Untitled"}</p>
						{description && <p className="mt-0.5 line-clamp-2 text-xs text-pretty text-muted-foreground">{description}</p>}
					</div>
				</div>
			</div>
			<div className="border-t border-border/60 px-4 pt-3 pb-4">
				<h2 className="mb-2.5 text-xs font-medium text-muted-foreground">Picture</h2>
				{children}
			</div>
		</section>
	);
}

// Where it is on the website, each at once: its address, pinned first on the home page, which only a page the home page
// lists can be, or off the website.
function CardOnWebsite({ id, slug, urlBase, pageUrl, isPinned: savedPin, isListed, onRemove }) {
	const [isPinned, setIsPinned] = useState(savedPin);
	const [isPinning, startPinning] = useTransition();
	const toastError = useToastError();

	function togglePin(checked) {
		setIsPinned(checked);
		startPinning(async () => {
			const result = await toggleArchivePin(id);
			if (result?.error) {
				setIsPinned(!checked);
				return void toastError(result);
			}
			toast.success(checked ? "Pinned to the top of your website" : "Unpinned from your website");
		});
	}

	return (
		<section aria-label="On your website" className="divide-y divide-border/60 rounded-xl bg-card shadow-border">
			<div className="pt-3 pr-1.5 pl-4">
				<h2 className="text-xs font-medium text-muted-foreground">Address</h2>
				<div className="flex items-center gap-1">
					<div className="min-w-0 flex-1">
						<InputCampaignSlug campaignId={id} initialSlug={slug} urlBase={urlBase} isPublished isCompact />
					</div>
					<ButtonCopy value={pageUrl} label="Copy link" />
				</div>
			</div>
			{isListed && (
				<label className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3">
					<span className="flex flex-col gap-0.5">
						<span className="text-sm font-medium">Pin to top</span>
						<span className="text-xs text-pretty text-muted-foreground">First on your website&apos;s home page</span>
					</span>
					<Switch checked={isPinned} onCheckedChange={togglePin} disabled={isPinning} className="mt-0.5" />
				</label>
			)}
			<div className="px-2 py-1.5">
				<Button type="button" variant="ghost" size="sm" onClick={onRemove} className="w-full justify-start text-muted-foreground hover:text-destructive">
					<GlobeOff data-icon="inline-start" />
					Remove from website
				</Button>
			</div>
		</section>
	);
}

// Once the page has content of its own: the email's back, or for a web-only issue, the content it went out with.
function MenuWebPage({ isWebOnly, onRestore }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button type="button" variant="outline" size="icon" aria-label="More actions" className="aria-expanded:bg-muted">
					<MoreHorizontal />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-52">
				<DropdownMenuItem onSelect={onRestore}>
					<RotateCcw />
					{isWebOnly ? "Restore the first version" : "Restore the email's content"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
