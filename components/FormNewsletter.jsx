"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Check, CircleAlert, ExternalLink, FlaskConical, Loader2, X } from "lucide-react";
import { checkSlug, saveNewsletter, sendWelcomeTest } from "@/app/(app)/newsletters/actions";
import BarSave from "@/components/BarSave";
import ButtonCopy from "@/components/ButtonCopy";
import InputImage from "@/components/InputImage";
import NoticeWelcomePaused from "@/components/NoticeWelcomePaused";
import PreviewEmail from "@/components/PreviewEmail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CLEANUP_LIMITS, LAST_CHANCE_DAYS, getCleanupSettings } from "@/lib/cleanup";
import { CONFIRM_URL_PLACEHOLDER } from "@/lib/confirmation-content";
import { formatNumber } from "@/lib/format";
import { KEEP_URL_PLACEHOLDER, getLastChanceContent } from "@/lib/last-chance-content";
import { fillSampleName } from "@/lib/merge-tags";
import {
	getDraftConfirmation,
	getDraftFromEmail,
	getDraftKey,
	getNewsletterDraft,
	getSlugChanges,
	getWebsiteAddress,
} from "@/lib/newsletter-form";
import { getSlugFormatProblem } from "@/lib/newsletter-settings";
import { MAX_AUTHOR_BIO_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/newsletters";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail } from "@/lib/render-email";
import { getSharedAddress } from "@/lib/sender-rules";
import { slugify } from "@/lib/slug";
import { toast } from "@/lib/toast";
import { usePaywall } from "@/lib/use-paywall";
import { cn } from "@/lib/utils";
import { prefillWelcome } from "@/lib/welcome-content";

const IMAGE_PREVIEW_PATTERN = /^(https:\/\/\S+\.\S{2,}\/\S+|\/\S+\.\w{3,4})$/;

// One section of the open newsletter's settings, on its own page (lib/newsletter-sections.js), which saves only that
// section's fields. It saves from onSubmit, not a form action: React resets a form after its action, which turned the
// switches back to how the page opened and dropped what an error refused. Discard goes back to what the newsletter has
// saved. welcomePause: the notice to show while the month's emails are used up and welcome emails are skipped. isCloud:
// MailCheap Cloud, whose plans count the confirmation and welcome emails among their monthly emails.
// defaultPostalAddress: what its emails print until it has its own (lib/postal-address.js); the editor's checks link
// to the field with #postal-address. hasArchiveHost: the server hosts websites on customers' own subdomains.
// hasSentIssue: an issue went out, so the website can be live (lib/archive-data.js).
export default function FormNewsletter({
	section,
	newsletter,
	domains,
	sharedDomain,
	appUrl,
	hasArchiveHost,
	hasSentIssue,
	defaultPostalAddress,
	isSendingEnabled,
	testEmail,
	cleanupTotals,
	welcomePause,
	isCloud = false,
}) {
	const [draft, setDraft] = useState(() => getNewsletterDraft({ newsletter, domains, sharedDomain, defaultPostalAddress }));
	const draftKey = getDraftKey(draft, { newsletter, sharedDomain });
	const [savedKey, setSavedKey] = useState(draftKey);
	const [savedAt, setSavedAt] = useState(null);
	// The image inputs keep their own URL: a discard starts them over.
	const [discardCount, setDiscardCount] = useState(0);
	const [isSaving, startSaving] = useTransition();
	const fromEmail = getDraftFromEmail(draft, sharedDomain);
	const sender = {
		name: draft.name,
		fromName: draft.fromName,
		fromEmail,
		imageUrl: IMAGE_PREVIEW_PATTERN.test(draft.imageUrl) ? draft.imageUrl : "",
	};

	function set(key, value) {
		setDraft((current) => ({ ...current, [key]: value }));
	}

	function update(key) {
		return (event) => set(key, event.target.value);
	}

	function save(event) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		startSaving(async () => {
			const result = await saveNewsletter(null, formData);
			if (result?.error) return void toast.error(result.error);
			setSavedKey(draftKey);
			setSavedAt(result.savedAt);
		});
	}

	function discard() {
		const saved = getNewsletterDraft({ newsletter, domains, sharedDomain, defaultPostalAddress });
		setDraft(saved);
		setSavedKey(getDraftKey(saved, { newsletter, sharedDomain }));
		setSavedAt(null);
		setDiscardCount((count) => count + 1);
	}

	const form = { draft, setDraft, set, update, newsletter, sender, discardCount, isCloud };

	return (
		<form onSubmit={save} className="flex flex-col gap-4">
			<input type="hidden" name="id" value={newsletter._id} />
			<input type="hidden" name="section" value={section} />
			{section === "general" && <SectionGeneral {...form} sharedDomain={sharedDomain} appUrl={appUrl} />}
			{section === "sender" && (
				<SectionSender
					{...form}
					domains={domains}
					sharedDomain={sharedDomain}
					fromEmail={fromEmail}
					defaultPostalAddress={defaultPostalAddress}
				/>
			)}
			{section === "signups" && <SectionSignups {...form} />}
			{section === "welcome" && (
				<SectionWelcome {...form} isSendingEnabled={isSendingEnabled} testEmail={testEmail} welcomePause={welcomePause} />
			)}
			{section === "cleanup" && <SectionCleanup {...form} fromEmail={fromEmail} totals={cleanupTotals} />}
			{section === "website" && (
				<SectionWebsite
					{...form}
					sharedDomain={sharedDomain}
					appUrl={appUrl}
					hasArchiveHost={hasArchiveHost}
					hasSentIssue={hasSentIssue}
				/>
			)}
			<BarSave isDirty={draftKey !== savedKey} isSaving={isSaving} savedAt={savedAt} onDiscard={discard} />
		</form>
	);
}

function SectionGeneral({ draft, setDraft, set, newsletter, sharedDomain, appUrl, discardCount }) {
	const slugId = useId();
	const { name, slug, imageUrl } = draft;
	const savedSlug = newsletter.slug ?? "";
	const slugCheck = useSlugCheck({ slug, savedSlug, newsletterId: newsletter._id });
	const isShared = Boolean(sharedDomain) && draft.fromDomain === sharedDomain;

	return (
		<Section stagger={1}>
			<Field label="Name">
				<Input
					name="name"
					value={name}
					required
					placeholder="Field notes"
					onChange={(event) => {
						const { value } = event.target;
						setDraft((current) => ({ ...current, name: value, ...(!current.isSlugEdited && { slug: slugify(value) }) }));
					}}
				/>
			</Field>
			<Field label="Slug" htmlFor={slugId}>
				<span className="relative flex">
					<Input
						id={slugId}
						name="slug"
						value={slug}
						required
						placeholder="field-notes"
						aria-invalid={slugCheck.message ? true : undefined}
						aria-describedby={slugCheck.status === "saved" ? undefined : `${slugId}-check`}
						className="pr-9 font-mono"
						onChange={(event) => {
							const { value } = event.target;
							setDraft((current) => ({ ...current, slug: value, isSlugEdited: true }));
						}}
					/>
					<IconSlugCheck status={slugCheck.status} />
				</span>
				{slugCheck.status !== "saved" && (
					<span id={`${slugId}-check`} className="flex flex-col gap-2">
						<span aria-live="polite" className={cn("text-xs", slugCheck.message ? "text-red-600 dark:text-red-400" : "sr-only")}>
							{slugCheck.message ?? (slugCheck.status === "available" ? `${slug.trim().toLowerCase()} is available` : "")}
						</span>
						<ListSlugChanges
							changes={getSlugChanges({
								slug: slug.trim().toLowerCase(),
								savedSlug,
								archiveHost: newsletter.archiveHost,
								isShared,
								sharedDomain,
								appUrl,
							})}
						/>
					</span>
				)}
			</Field>
			<Field label="Image" hint="Square logo, 128×128 or larger">
				<InputImage
					key={discardCount}
					name="imageUrl"
					defaultValue={imageUrl}
					label="newsletter image"
					onChange={(value) => set("imageUrl", value)}
				/>
			</Field>
		</Section>
	);
}

function SectionSender({ draft, set, update, domains, sharedDomain, fromEmail, defaultPostalAddress }) {
	const postalAddressRef = useRef(null);
	const { slug, fromName, fromLocal, fromDomain, postalAddress } = draft;
	const sharedAddress = sharedDomain ? getSharedAddress(slug || "slug", sharedDomain) : null;
	const isShared = Boolean(sharedDomain) && fromDomain === sharedDomain;
	const isDomainUnverified = !isShared && domains.some(({ domain, verified }) => domain === fromDomain && !verified);
	const fromHint = getFromHint({ isShared, isDomainUnverified, fromDomain, hasDomains: domains.length > 0 });

	useEffect(() => {
		if (window.location.hash === `#${POSTAL_ADDRESS_ID}`) postalAddressRef.current?.focus();
	}, []);

	return (
		<Section stagger={1}>
			<Field label="From name">
				<Input name="fromName" value={fromName} placeholder="Jane Doe" onChange={update("fromName")} />
			</Field>
			<Field label="From email" hint={fromHint} isWarning={isDomainUnverified}>
				<span className="flex flex-wrap items-center gap-2">
					<span className="flex items-center gap-2">
						<Input
							value={isShared ? sharedAddress.split("@")[0] : fromLocal}
							readOnly={isShared}
							required
							aria-label="From email name"
							placeholder="hi"
							className={cn("w-32 font-mono", isShared && "text-muted-foreground")}
							onChange={(event) => set("fromLocal", event.target.value.trim())}
						/>
						<span className="text-sm text-muted-foreground">@</span>
					</span>
					{/* The shared domain has the slug in it, so it can be wider than the column. */}
					<Select value={fromDomain} onValueChange={(value) => set("fromDomain", value)}>
						<SelectTrigger
							className="min-h-9 min-w-0 flex-auto py-1.5 text-left font-mono whitespace-normal wrap-anywhere data-[size=default]:h-auto *:data-[slot=select-value]:line-clamp-none"
							aria-label="From domain"
						>
							<SelectValue placeholder="Add a domain first" />
						</SelectTrigger>
						<SelectContent className="max-w-[calc(100vw-20px)] wrap-anywhere">
							{sharedDomain && <SelectItem value={sharedDomain}>{sharedAddress.split("@")[1]}</SelectItem>}
							{domains.map(({ domain }) => (
								<SelectItem key={domain} value={domain}>
									{domain}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</span>
				<input type="hidden" name="fromEmail" value={fromEmail} />
			</Field>
			<Field label="Reply-to">
				<Input name="replyTo" type="email" value={draft.replyTo} placeholder="Optional" onChange={update("replyTo")} />
			</Field>
			<Field
				label="Postal address"
				htmlFor={POSTAL_ADDRESS_ID}
				hint={
					defaultPostalAddress && postalAddress === defaultPostalAddress ? (
						"MailCheap's address is used by default. Replace it with yours anytime."
					) : postalAddress.trim() ? (
						"Shown in the footer of every email. Anti-spam laws require one."
					) : (
						<>
							Shown in the footer of every email. Anti-spam laws require one, so sending waits for it.
							{defaultPostalAddress && (
								<>
									{" "}
									<button
										type="button"
										onClick={() => set("postalAddress", defaultPostalAddress)}
										className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors duration-150 hover:decoration-foreground"
									>
										Use MailCheap&apos;s address
									</button>
								</>
							)}
						</>
					)
				}
			>
				<Textarea
					ref={postalAddressRef}
					id={POSTAL_ADDRESS_ID}
					name="postalAddress"
					value={postalAddress}
					rows={2}
					placeholder="Company name, street, city, country"
					className="scroll-mt-28"
					onChange={update("postalAddress")}
				/>
			</Field>
		</Section>
	);
}

// Until it's edited, the built-in confirmation email follows the name and the description. Turned on while the welcome
// email goes out, it says that saving turns the welcome email off (readSettingsForm sends both).
function SectionSignups({ draft, setDraft, set, newsletter, sender, isCloud }) {
	const { name, description, confirmationEdits, isConfirmationRequired, postalAddress } = draft;
	const isWelcomeReplaced = isConfirmationRequired && !newsletter.requireConfirmation && Boolean(newsletter.welcome?.enabled);
	const confirmation = useMemo(
		() => getDraftConfirmation({ name, description, confirmationEdits }, newsletter),
		[name, description, confirmationEdits, newsletter]
	);
	const deferredConfirmation = useDeferredValue(confirmation);
	const html = useMemo(
		() =>
			fillSampleName(
				renderEmail({ ...deferredConfirmation, newsletter: { name, postalAddress, theme: newsletter.theme } })
					.html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#")
					.replaceAll(CONFIRM_URL_PLACEHOLDER, "#"),
				{ isHtml: true }
			),
		[deferredConfirmation, name, postalAddress, newsletter.theme]
	);

	function updateConfirmation(key) {
		return (event) => {
			const { value } = event.target;
			setDraft((current) => ({ ...current, confirmationEdits: { ...(current.confirmationEdits ?? confirmation), [key]: value } }));
		};
	}

	return (
		<Section
			title="Double opt-in"
			stagger={1}
			action={
				<Switch
					name="requireConfirmation"
					checked={isConfirmationRequired}
					onCheckedChange={(isChecked) => set("isConfirmationRequired", isChecked)}
					aria-label="Double opt-in"
				/>
			}
		>
			<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
				New subscribers get an email and only join once they click its button, so fake and mistyped addresses never reach
				the list.{isConfirmationRequired && " It's the only email they get: say what comes next."}
				{isCloud && " Confirmation emails count toward your plan's monthly emails."}
			</p>
			{isWelcomeReplaced && <NoticeSwitch>Saving turns off the welcome email: new subscribers get this email instead.</NoticeSwitch>}
			{isConfirmationRequired && (
				<>
					<Field label="Subject">
						<Input name="confirmationSubject" value={confirmation.subject} required onChange={updateConfirmation("subject")} />
					</Field>
					<Field label="Preview text">
						<Input
							name="confirmationPreviewText"
							value={confirmation.previewText}
							placeholder="Optional"
							onChange={updateConfirmation("previewText")}
						/>
					</Field>
					<Field label="Content" hint={`Markdown. Keep the button: its ${CONFIRM_URL_PLACEHOLDER} becomes each subscriber's link.`}>
						<Textarea
							name="confirmationMarkdown"
							value={confirmation.markdown}
							onChange={updateConfirmation("markdown")}
							className="min-h-48 font-mono text-[13px] leading-6"
						/>
					</Field>
					<div className="p-3">
						<PreviewEmail
							html={html}
							sender={sender}
							subject={deferredConfirmation.subject}
							previewText={deferredConfirmation.previewText}
							fit="content"
						/>
					</div>
				</>
			)}
		</Section>
	);
}

// Its switch works while signups confirm too: turned on, it says that saving turns double opt-in off (readSettingsForm
// sends both).
function SectionWelcome({ draft, setDraft, newsletter, sender, isSendingEnabled, testEmail, welcomePause, isCloud }) {
	const paywall = usePaywall();
	const hasPlan = paywall?.hasPlan ?? true;
	const [isTesting, startTesting] = useTransition();
	const { name, postalAddress, isWelcomeEnabled, welcome } = draft;
	const isConfirmationOn = Boolean(newsletter.requireConfirmation);
	const deferredWelcome = useDeferredValue(welcome);
	const html = useMemo(
		() =>
			fillSampleName(
				renderEmail({
					markdown: deferredWelcome.markdown,
					subject: deferredWelcome.subject,
					previewText: deferredWelcome.previewText,
					newsletter: { name, postalAddress, theme: newsletter.theme },
				}).html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"),
				{ isHtml: true }
			),
		[deferredWelcome, name, postalAddress, newsletter.theme]
	);

	function updateWelcome(key) {
		return (event) => {
			const { value } = event.target;
			setDraft((current) => ({ ...current, welcome: { ...current.welcome, [key]: value } }));
		};
	}

	function switchWelcome(isEnabled) {
		setDraft((current) => ({
			...current,
			isWelcomeEnabled: isEnabled,
			welcome: isEnabled ? prefillWelcome(current.welcome, { name: current.name, description: current.description }) : current.welcome,
		}));
	}

	function sendTest() {
		if (!hasPlan) return paywall.open("test");
		startTesting(async () => {
			const result = await sendWelcomeTest(newsletter._id);
			if (result?.error) toast.error(result.error);
			else toast.success(`Test sent to ${testEmail}`);
		});
	}

	return (
		<Section
			title="Send to new subscribers"
			stagger={1}
			action={<Switch name="welcomeEnabled" checked={isWelcomeEnabled} onCheckedChange={switchWelcome} aria-label="Welcome email" />}
		>
			<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
				{isConfirmationOn && !isWelcomeEnabled
					? "Double opt-in is on, so new subscribers get the confirmation email instead. Turning this on turns double opt-in off."
					: "Each new subscriber gets it when they join."}
				{isCloud && " Welcome emails count toward your plan's monthly emails."}
			</p>
			{isConfirmationOn && isWelcomeEnabled && (
				<NoticeSwitch>Saving turns off double opt-in: new subscribers join right away, without confirming their address.</NoticeSwitch>
			)}
			{welcomePause && isWelcomeEnabled && <NoticeWelcomePaused {...welcomePause} className="px-4 py-3" />}
			<Field label="Subject">
				<Input name="welcomeSubject" value={welcome.subject} onChange={updateWelcome("subject")} />
			</Field>
			<Field label="Preview text">
				<Input name="welcomePreviewText" value={welcome.previewText} placeholder="Optional" onChange={updateWelcome("previewText")} />
			</Field>
			<Field label="Content" hint="Markdown">
				<Textarea
					name="welcomeMarkdown"
					value={welcome.markdown}
					onChange={updateWelcome("markdown")}
					className="min-h-48 font-mono text-[13px] leading-6"
				/>
			</Field>
			{deferredWelcome.markdown.trim() && (
				<div className="p-3">
					<PreviewEmail
						html={html}
						sender={sender}
						subject={deferredWelcome.subject}
						previewText={deferredWelcome.previewText}
						fit="content"
					/>
				</div>
			)}
			<div className="flex items-center justify-between gap-3 px-4 py-3">
				<p className="text-xs wrap-anywhere text-muted-foreground">
					{isSendingEnabled || !hasPlan ? `Sends the saved version to ${testEmail}` : "Sending is off"}
				</p>
				<Button type="button" variant="outline" size="sm" onClick={sendTest} disabled={(hasPlan && !isSendingEnabled) || isTesting}>
					{isTesting ? <Loader2 className="animate-spin" /> : <FlaskConical />}
					Send test
				</Button>
			</div>
		</Section>
	);
}

function SectionCleanup({ draft, setDraft, set, newsletter, sender, fromEmail, totals }) {
	const { name, postalAddress, isCleanupEnabled, cleanup } = draft;
	const savedCleanup = getCleanupSettings(newsletter);
	const lastChance = useMemo(() => {
		const content = getLastChanceContent({ name, fromEmail });
		const { html } = renderEmail({ ...content, newsletter: { name, postalAddress, theme: newsletter.theme } });
		return { ...content, html: html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#").replaceAll(KEEP_URL_PLACEHOLDER, "#") };
	}, [name, fromEmail, postalAddress, newsletter.theme]);

	function updateCleanup(key) {
		return (event) => {
			const { value } = event.target;
			setDraft((current) => ({ ...current, cleanup: { ...current.cleanup, [key]: value } }));
		};
	}

	return (
		<Section
			title="Clean up at each send"
			stagger={1}
			action={
				<Switch
					name="cleanupEnabled"
					checked={isCleanupEnabled}
					onCheckedChange={(isChecked) => set("isCleanupEnabled", isChecked)}
					aria-label="List cleanup"
				/>
			}
		>
			<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
				Stops sending to contacts who stopped opening, unless they answer a last-chance email. Each time you send an
				issue, contacts who ignored the last {cleanup.issues || savedCleanup.issues} issues and showed no sign of life
				for {cleanup.days || savedCleanup.days} days get this email instead. A click on its button keeps them. Anyone who
				doesn&apos;t answer by a send {LAST_CHANCE_DAYS} days later becomes dormant: not unsubscribed, not deleted, and
				back if they sign up again.
			</p>
			<Field label="Ignored issues" hint="In a row, counting from the first issue MailCheap sent">
				<Input
					name="cleanupIssues"
					type="number"
					inputMode="numeric"
					min={CLEANUP_LIMITS.minIssues}
					max={CLEANUP_LIMITS.maxIssues}
					value={cleanup.issues}
					onChange={updateCleanup("issues")}
					className="w-28 tabular-nums"
				/>
			</Field>
			<Field label="Quiet for" hint="Days since the last open, click or signup">
				<span className="flex items-center gap-2">
					<Input
						name="cleanupDays"
						type="number"
						inputMode="numeric"
						min={CLEANUP_LIMITS.minDays}
						max={CLEANUP_LIMITS.maxDays}
						value={cleanup.days}
						onChange={updateCleanup("days")}
						className="w-28 tabular-nums"
					/>
					<span className="text-sm text-muted-foreground">days</span>
				</span>
			</Field>
			{totals && <CleanupTotals totals={totals} />}
			{isCleanupEnabled && (
				<div className="p-3">
					<PreviewEmail html={lastChance.html} sender={sender} subject={lastChance.subject} previewText={lastChance.previewText} fit="content" />
				</div>
			)}
		</Section>
	);
}

function SectionWebsite({ draft, set, update, newsletter, sharedDomain, appUrl, hasArchiveHost, hasSentIssue, discardCount }) {
	const paywall = usePaywall();
	const hasPlan = paywall?.hasPlan ?? true;
	const { isArchiveEnabled } = draft;
	const archiveHost = newsletter.archiveHost;
	const websiteAddress = getWebsiteAddress({ slug: newsletter.slug || draft.slug || "slug", archiveHost }, { sharedDomain, appUrl });

	return (
		<>
			<Section
				title="Publish a website"
				stagger={1}
				action={
					<Switch
						name="archiveEnabled"
						checked={isArchiveEnabled}
						onCheckedChange={(isChecked) => set("isArchiveEnabled", isChecked)}
						aria-label="Website"
					/>
				}
			>
				<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
					Every issue you send gets a page here, with a signup form.
					{hasArchiveHost && !archiveHost && " Add a domain on the Domains page to put it on your own subdomain."}
				</p>
				<Field
					label="Address"
					as="div"
					hint={
						!isArchiveEnabled ? (
							"Your website is off. Turn it on above to give every issue you send a page."
						) : !hasSentIssue ? (
							"Goes live after your first issue."
						) : !hasPlan ? (
							<>
								It goes online once you pick a plan.{" "}
								<button
									type="button"
									onClick={() => paywall.open("website")}
									className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors duration-150 hover:decoration-foreground"
								>
									Pick a plan
								</button>
							</>
						) : !newsletter.archiveEnabled ? (
							"It goes online when you save."
						) : null
					}
				>
					<span className="flex min-w-0 items-center gap-1.5 sm:min-h-9">
						{isArchiveEnabled && hasSentIssue && hasPlan && newsletter.archiveEnabled ? (
							<a
								href={websiteAddress}
								target="_blank"
								rel="noreferrer"
								className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[13px] underline decoration-foreground/30 underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
							>
								<span className="truncate">{websiteAddress}</span>
								<ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
							</a>
						) : (
							<span className="truncate font-mono text-[13px] text-muted-foreground/70">{websiteAddress}</span>
						)}
						<ButtonCopy value={websiteAddress} label="Copy address" />
					</span>
				</Field>
			</Section>
			<Section title="Profile" stagger={2}>
				<Field label="Description" hint="One sentence under the name and in the subscribe popup">
					<Textarea
						name="description"
						value={draft.description}
						rows={2}
						maxLength={MAX_DESCRIPTION_LENGTH}
						placeholder="One idea about building things, every Sunday."
						onChange={update("description")}
					/>
				</Field>
				<Field label="Author bio" hint="Under your name on the author page">
					<Input
						name="authorBio"
						value={draft.authorBio}
						maxLength={MAX_AUTHOR_BIO_LENGTH}
						placeholder="I write about building small software companies."
						onChange={update("authorBio")}
					/>
				</Field>
				<Field label="Author photo" hint="Square photo on the author page. The newsletter image otherwise.">
					<InputImage
						key={discardCount}
						name="authorImageUrl"
						defaultValue={draft.authorImageUrl}
						label="author photo"
						onChange={(value) => set("authorImageUrl", value)}
					/>
				</Field>
				<Field label="Social links" hint="One link per line">
					<Textarea
						name="socialLinks"
						value={draft.socialLinks}
						rows={3}
						placeholder={"https://x.com/example\nhttps://youtube.com/@example"}
						className="font-mono text-[13px] leading-6"
						onChange={update("socialLinks")}
					/>
				</Field>
			</Section>
		</>
	);
}

// A card of fields. A title gets a row on top with the action on its right.
export function Section({ title, action, stagger, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="rounded-xl bg-card shadow-border animate-enter">
			{title && (
				<div className="flex h-12 items-center justify-between gap-3 px-4">
					<h2 className="text-sm font-medium">{title}</h2>
					{action}
				</div>
			)}
			{children && <div className={cn("divide-y divide-border/60", title && "border-t border-border/60")}>{children}</div>}
		</section>
	);
}

// What saving also changes in another section, said before it's saved.
function NoticeSwitch({ children }) {
	return (
		<p
			role="status"
			className="flex items-start gap-2 bg-amber-50 px-4 py-3 text-sm text-pretty text-amber-900 animate-enter dark:bg-amber-500/10 dark:text-amber-200"
		>
			<CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{children}
		</p>
	);
}

function CleanupTotals({ totals }) {
	const stats = [
		{ label: "Waiting for an answer", value: totals.waiting },
		{ label: "Kept after the email", value: totals.kept },
		{ label: "Made dormant", value: totals.dormant },
	];
	return (
		<dl className="grid grid-cols-3 divide-x divide-border/60">
			{stats.map(({ label, value }) => (
				<div key={label} className="flex flex-col gap-1 px-4 py-3">
					<dt className="text-xs text-pretty text-muted-foreground">{label}</dt>
					<dd className="text-lg font-semibold tabular-nums">{formatNumber(value)}</dd>
				</div>
			))}
		</dl>
	);
}

function getFromHint({ isShared, isDomainUnverified, fromDomain, hasDomains }) {
	if (isShared) return "The shared address follows the slug and needs no setup. Replies go to the reply-to, or to your account email.";
	if (isDomainUnverified) return `${fromDomain} isn't verified yet. Emails wait until its DNS records are in.`;
	if (!fromDomain && !hasDomains) return "Add a domain on the Domains page to send from it";
	return null;
}

// The whole row is the field's label, unless it holds more than the field (buttons, a list): then only its name is,
// for htmlFor, and as="div" has no field to name.
export function Field({ label, hint, isWarning, htmlFor, as, children }) {
	const Row = htmlFor || as === "div" ? "div" : "label";
	const Name = htmlFor ? "label" : "span";
	return (
		<Row className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
			<Name htmlFor={htmlFor} className="text-sm text-muted-foreground sm:pt-2">
				{label}
			</Name>
			<span className="flex min-w-0 flex-col gap-1.5">
				{children}
				{hint && (
					<span
						className={cn(
							"text-xs",
							isWarning ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
						)}
					>
						{hint}
					</span>
				)}
			</span>
		</Row>
	);
}

// Inside the slug field, at its end: a spinner while it's checked, then whether it's free.
function IconSlugCheck({ status }) {
	if (status === "saved") return null;
	const Icon = status === "checking" ? Loader2 : status === "available" ? Check : X;
	return (
		<Icon
			key={status}
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2",
				status === "checking" ? "animate-spin text-muted-foreground" : "animate-icon-in",
				status === "available" && "text-emerald-600 dark:text-emerald-400",
				(status === "unavailable" || status === "error") && "text-red-600 dark:text-red-400"
			)}
		/>
	);
}

function ListSlugChanges({ changes }) {
	return (
		<span className="flex flex-col gap-1.5 rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground animate-enter">
			<span className="font-medium text-foreground">Changing the slug</span>
			<ul className="flex list-disc flex-col gap-1 pl-4 text-pretty marker:text-muted-foreground/60">
				{changes.map((change) => (
					<li key={change}>{change}</li>
				))}
			</ul>
		</span>
	);
}

// While the slug isn't the saved one, it's checked once typing pauses: its format here, then on the server whether
// another newsletter has it. An answer counts for the slug it was asked for.
function useSlugCheck({ slug, savedSlug, newsletterId }) {
	const value = slug.trim().toLowerCase();
	const isChanged = Boolean(value) && value !== savedSlug;
	const [answer, setAnswer] = useState(null);

	useEffect(() => {
		if (!isChanged) return;
		let isCurrent = true;
		const timeout = setTimeout(async () => {
			const problem = getSlugFormatProblem(value);
			const result = problem
				? { available: false, ...problem }
				: await checkSlug(value, newsletterId).catch(() => ({ error: "Couldn't check the slug. Saving checks it again." }));
			if (isCurrent) setAnswer({ slug: value, ...result });
		}, SLUG_CHECK_DELAY_MS);
		return () => {
			isCurrent = false;
			clearTimeout(timeout);
		};
	}, [value, isChanged, newsletterId]);

	if (!isChanged) return { status: "saved" };
	if (answer?.slug !== value) return { status: "checking" };
	if (answer.error) return { status: "error", message: answer.error };
	return answer.available ? { status: "available" } : { status: "unavailable", message: answer.message };
}

const POSTAL_ADDRESS_ID = "postal-address";
const SLUG_CHECK_DELAY_MS = 350;
