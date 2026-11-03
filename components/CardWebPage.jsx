"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { updateWebPage } from "@/app/(app)/campaigns/actions";
import CardSettings from "@/components/CardSettings";
import ImageShareCard from "@/components/ImageShareCard";
import InputCampaignSlug from "@/components/InputCampaignSlug";
import PickerWebImage from "@/components/PickerWebImage";
import RowCampaign from "@/components/RowCampaign";
import { formatDate } from "@/lib/format";
import { withMergeFallbacks, withoutMergeTags } from "@/lib/merge-tags";
import { forWeb } from "@/lib/sections";
import { getIssueCard } from "@/lib/share-card";
import { slugify } from "@/lib/slug";
import { listImageUrls } from "@/lib/thumbnail";
import { toast } from "@/lib/toast";
import { useIsClient } from "@/lib/use-is-client";
import { MAX_WEB_DESCRIPTION_LENGTH, MAX_WEB_TITLE_LENGTH, WEB_CARD } from "@/lib/web-page";

const MAX_PICTURES = 4;

// The issue's page on the website, in the send step (components/PanelSend.jsx): its card as the website and link
// previews will show it, its picture, title and description, the email's until one is picked or typed (lib/web-page.js),
// and its URL. A picture saves as it's picked, a title or a description once its field loses focus, like the URL.
// subject, previewText and body: the draft as it's written, which the card follows. otherPictures: what the newsletter's
// other issues show (lib/archive-data.js listOtherIssuePictures): a first picture among them gets the card instead.
// onBeforeSave: saves the draft, whose pictures a picked one has to be among, unless it was uploaded.
export default function CardWebPage({
	campaign,
	newsletter,
	subject,
	previewText,
	body,
	format,
	contactFields,
	otherPictures,
	archiveUrlBase,
	onBeforeSave,
}) {
	const isClient = useIsClient();
	const [image, setImage] = useState(campaign.web?.image ?? "");
	const pictures = useMemo(
		() => listImageUrls({ format, html: format === "rich" ? forWeb(body) : body }, MAX_PICTURES),
		[format, body]
	);
	const autoImage = pictures[0] && !otherPictures.includes(pictures[0]) ? pictures[0] : null;
	const [isSavingImage, startSavingImage] = useTransition();
	const title = useWebField(campaign, "title");
	const description = useWebField(campaign, "description");
	const shownTitle = withMergeFallbacks(title.value.trim() || subject, { contactFields });
	const shownDescription = withMergeFallbacks(description.value.trim() || previewText, { contactFields });
	const shownImage = image === WEB_CARD ? null : image || autoImage;
	const slug = campaign.archiveSlug || slugify(withoutMergeTags(subject), 80) || "issue";
	// The browser's day, which the server doesn't know.
	const date = isClient ? formatDate(campaign.scheduledAt ?? new Date()) : "";
	const card = getIssueCard({ newsletter, title: shownTitle, description: shownDescription, slug, date, domain: new URL(archiveUrlBase).host });

	function pickImage(next) {
		const previous = image;
		if (next === previous) return;
		setImage(next);
		startSavingImage(async () => {
			if (!(await onBeforeSave())) return void setImage(previous);
			const result = await updateWebPage(campaign._id, { image: next });
			if (!result?.error) return;
			setImage(previous);
			toast.error(result.error);
		});
	}

	return (
		<CardSettings title="On your website" stagger={1}>
			<div className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
				<figure className="flex max-w-80 flex-col gap-2">
					<div className="relative aspect-[1200/630] overflow-hidden rounded-lg bg-muted outline -outline-offset-1 outline-foreground/10">
						{shownImage ? (
							// eslint-disable-next-line @next/next/no-img-element -- any https:// picture of the issue, at its own size
							<img src={shownImage} alt="" className="size-full object-cover" />
						) : (
							<span className="@container block size-full">
								<ImageShareCard {...card} isFluid />
							</span>
						)}
					</div>
					<figcaption className="flex min-w-0 flex-col gap-0.5">
						<span className="min-h-4 text-xs text-muted-foreground tabular-nums">{date}</span>
						<span className="line-clamp-2 text-sm font-medium text-balance">{shownTitle || "Untitled"}</span>
						{shownDescription && <span className="line-clamp-2 text-sm text-pretty text-muted-foreground">{shownDescription}</span>}
					</figcaption>
				</figure>
				<div className="-mx-4 -mb-4 divide-y divide-border/60 border-t border-border/60 sm:m-0 sm:border-t-0">
					<RowCampaign label="Image" className="sm:px-0">
						<PickerWebImage
							value={image}
							pictures={pictures}
							autoImage={autoImage}
							card={card}
							onChange={pickImage}
							isDisabled={isSavingImage}
						/>
					</RowCampaign>
					<RowWebField label="Title" field={title} placeholder={subject || "Same as the subject"} maxLength={MAX_WEB_TITLE_LENGTH} />
					<RowWebField
						label="Description"
						field={description}
						placeholder={previewText || "Same as the preview text"}
						maxLength={MAX_WEB_DESCRIPTION_LENGTH}
					/>
					<RowCampaign label="URL" className="sm:px-0">
						<InputCampaignSlug
							campaignId={campaign._id}
							initialSlug={campaign.archiveSlug ?? ""}
							placeholder={slugify(withoutMergeTags(subject), 80) || "issue"}
							urlBase={archiveUrlBase}
						/>
					</RowCampaign>
				</div>
			</div>
		</CardSettings>
	);
}

// The page's title or description, which saves once its field loses focus or on Enter, empty for the email's own.
function useWebField(campaign, key) {
	const [value, setValue] = useState(campaign.web?.[key] ?? "");
	const [saved, setSaved] = useState(value);
	const [isSaved, setIsSaved] = useState(false);
	const [isSaving, startSaving] = useTransition();
	const savedTimeout = useRef(null);

	useEffect(() => () => clearTimeout(savedTimeout.current), []);

	function save() {
		const next = value.trim();
		if (next === saved || isSaving) return;
		startSaving(async () => {
			const result = await updateWebPage(campaign._id, { [key]: next });
			if (result?.error) return void toast.error(result.error);
			setSaved(next);
			setIsSaved(true);
			clearTimeout(savedTimeout.current);
			savedTimeout.current = setTimeout(() => setIsSaved(false), 1500);
		});
	}

	return { value, setValue, save, isSaving, isSaved };
}

function RowWebField({ label, field, placeholder, maxLength }) {
	return (
		<RowCampaign label={label} className="sm:px-0">
			<span className="flex min-w-0 items-center gap-2">
				<input
					value={field.value}
					onChange={(event) => field.setValue(event.target.value)}
					onBlur={field.save}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						field.save();
					}}
					placeholder={placeholder}
					aria-label={label}
					maxLength={maxLength}
					className="h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				/>
				<span aria-live="polite" className="grid size-4 shrink-0 place-items-center text-muted-foreground">
					{field.isSaving && <Loader2 className="size-3.5 animate-spin" />}
					{!field.isSaving && field.isSaved && <Check key="saved" className="size-3.5 animate-draw-check" />}
					{!field.isSaving && field.isSaved && <span className="sr-only">{label} saved</span>}
				</span>
			</span>
		</RowCampaign>
	);
}
