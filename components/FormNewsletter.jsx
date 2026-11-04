"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, CircleAlert, CodeXml, ExternalLink, FlaskConical, Loader2, RotateCcw, X } from "lucide-react";
import { addDefaultAuthor, setDefaultAuthor } from "@/app/(app)/campaigns/actions";
import { checkSlug, saveNewsletter, sendWelcomeTest } from "@/app/(app)/newsletters/actions";
import BarSave from "@/components/BarSave";
import ButtonCopy from "@/components/ButtonCopy";
import CardWebsiteDomain, { OWN_DOMAIN_ID } from "@/components/CardWebsiteDomain";
import DialogSendTest from "@/components/DialogSendTest";
import EditorEmail from "@/components/EditorEmail";
import InputImage from "@/components/InputImage";
import LinkHelp from "@/components/LinkHelp";
import LogoAnalyticsTool from "@/components/LogoAnalyticsTool";
import NoticeWelcomePaused from "@/components/NoticeWelcomePaused";
import PickerAuthor from "@/components/PickerAuthor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CONFIRM_URL_PLACEHOLDER, KEEP_URL_PLACEHOLDER } from "@/lib/action-links";
import { getNewsletterHost } from "@/lib/archive-hosts";
import { CLEANUP_LIMITS, LAST_CHANCE_DAYS, getCleanupSettings } from "@/lib/cleanup";
import { CONFIRM_BUTTON_TEXT } from "@/lib/confirmation-content";
import { formatNumber } from "@/lib/format";
import { KEEP_BUTTON_TEXT } from "@/lib/last-chance-content";
import { isSameEmail } from "@/lib/newsletter-emails";
import {
	getBuiltInConfirmation,
	getBuiltInLastChance,
	getDraftConfirmation,
	getDraftFromEmail,
	getDraftKey,
	getDraftLastChance,
	getNewsletterDraft,
	getSlugChanges,
	getWebsiteAddress,
} from "@/lib/newsletter-form";
import { getSlugFormatProblem } from "@/lib/newsletter-settings";
import { ADD_DOMAIN_PATH, DOMAINS_PATH, MAX_AUTHOR_BIO_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/newsletters";
import { getSharedAddress } from "@/lib/sender-rules";
import { slugify } from "@/lib/slug";
import { describeTestRecipients } from "@/lib/test-email-rules";
import { toast } from "@/lib/toast";
import { usePaywall } from "@/lib/use-paywall";
import { cn } from "@/lib/utils";
import { ANALYTICS_TOOLS, readAnalyticsField } from "@/lib/website-analytics";
import { CUSTOM_CODE_MAX_LENGTH, readCustomCode } from "@/lib/website-code";
import { prefillWelcome } from "@/lib/welcome-content";

const IMAGE_PREVIEW_PATTERN = /^(https:\/\/\S+\.\S{2,}\/\S+|\/\S+\.\w{3,4})$/;

// One section of the open newsletter's settings, on its own page (lib/newsletter-sections.js), which saves only that
// section's fields. It saves from onSubmit, not a form action: React resets a form after its action, which turned the
// switches back to how the page opened and dropped what an error refused. Discard goes back to what the newsletter has
// saved. welcomePause: the notice to show while the month's emails are used up and welcome emails are skipped.
// signupReviews: whether the content check holds the saved welcome, confirmation or last-chance email
// (lib/signup-email-review.js), never why. isCloud: MailCheap Cloud, whose plans count the confirmation and welcome
// emails among their monthly emails.
// defaultPostalAddress: what its emails print until it has its own (lib/postal-address.js); the editor's checks link
// to the field with #postal-address. hasArchiveHost: the server hosts websites on customers' own subdomains, and
// websiteDomain is the newsletter's (lib/website-domain-rules.js). hasSentIssue: an issue went out, so the website can
// be live (lib/archive-data.js). preselectDomain: one of the account's domains a link asked for in the from field; the
// page opens with it picked and unsaved. authors: the Sender page's, { list, defaultId, suggestion } (FieldAuthor).
export default function FormNewsletter({
	section,
	newsletter,
	domains,
	sharedDomain,
	appUrl,
	hasArchiveHost,
	websiteDomain = null,
	hasSentIssue,
	defaultPostalAddress,
	isSendingEnabled,
	testRecipients = [],
	cleanupTotals,
	welcomePause,
	signupReviews = null,
	contactFields = [],
	isCloud = false,
	preselectDomain = null,
	authors = null,
}) {
	const [draft, setDraft] = useState(() => {
		const saved = getNewsletterDraft({ newsletter, domains, sharedDomain, defaultPostalAddress });
		return preselectDomain ? { ...saved, fromDomain: preselectDomain } : saved;
	});
	const draftKey = getDraftKey(draft, { newsletter, sharedDomain });
	const [savedKey, setSavedKey] = useState(() =>
		getDraftKey(getNewsletterDraft({ newsletter, domains, sharedDomain, defaultPostalAddress }), { newsletter, sharedDomain })
	);
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

	// What the newsletter's own emails are previewed in (components/EditorEmail.jsx).
	const previewNewsletter = useMemo(
		() => ({ name: draft.name, postalAddress: draft.postalAddress, theme: newsletter.theme }),
		[draft.name, draft.postalAddress, newsletter.theme]
	);
	const form = { draft, setDraft, set, update, newsletter, sender, previewNewsletter, contactFields, discardCount, isCloud };

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
					authors={authors}
				/>
			)}
			{section === "signups" && <SectionSignups {...form} review={signupReviews?.confirmation} />}
			{section === "welcome" && (
				<SectionWelcome
					{...form}
					isSendingEnabled={isSendingEnabled}
					testRecipients={testRecipients}
					welcomePause={welcomePause}
					review={signupReviews?.welcome}
				/>
			)}
			{section === "cleanup" && <SectionCleanup {...form} totals={cleanupTotals} review={signupReviews?.lastChance} />}
			{section === "website" && (
				<SectionWebsite
					{...form}
					sharedDomain={sharedDomain}
					appUrl={appUrl}
					hasArchiveHost={hasArchiveHost}
					websiteDomain={websiteDomain}
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
					isCropped
					onChange={(value) => set("imageUrl", value)}
				/>
			</Field>
		</Section>
	);
}

function SectionSender({ draft, set, update, newsletter, domains, sharedDomain, fromEmail, defaultPostalAddress, authors }) {
	const postalAddressRef = useRef(null);
	const { slug, fromName, fromLocal, fromDomain, postalAddress } = draft;
	const sharedAddress = sharedDomain ? getSharedAddress(slug || "slug", sharedDomain) : null;
	const isShared = Boolean(sharedDomain) && fromDomain === sharedDomain;
	const isDomainUnverified = !isShared && domains.some(({ domain, verified }) => domain === fromDomain && !verified);
	const fromHint = getFromHint({
		isShared,
		isDomainUnverified,
		fromDomain,
		domains,
		onPickDomain: (domain) => set("fromDomain", domain),
	});

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
			{authors && <FieldAuthor newsletterId={newsletter._id} {...authors} />}
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
function SectionSignups({ draft, setDraft, set, newsletter, sender, previewNewsletter, contactFields, discardCount, isCloud, review }) {
	const { name, description, confirmationEdits, isConfirmationRequired } = draft;
	const [version, setVersion] = useState(0);
	const isWelcomeReplaced = isConfirmationRequired && !newsletter.requireConfirmation && Boolean(newsletter.welcome?.enabled);
	const confirmation = useMemo(
		() => getDraftConfirmation({ name, description, confirmationEdits }, newsletter),
		[name, description, confirmationEdits, newsletter]
	);
	const builtIn = useMemo(() => getBuiltInConfirmation({ name, description }), [name, description]);
	const changeConfirmation = useCallback(
		(changes) => setDraft((current) => ({ ...current, confirmationEdits: { ...getDraftConfirmation(current, newsletter), ...changes } })),
		[setDraft, newsletter]
	);

	function restoreBuiltIn() {
		setDraft((current) => ({ ...current, confirmationEdits: builtIn }));
		setVersion((count) => count + 1);
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
			{isWelcomeReplaced && <NoticeSection>Saving turns off the welcome email: new subscribers get this email instead.</NoticeSection>}
			{isConfirmationRequired && review && <NoticeReview review={review} instead="new subscribers get the built-in confirmation email" />}
			{isConfirmationRequired && (
				<EditorEmail
					key={`${discardCount}-${version}`}
					name="confirmation"
					email={confirmation}
					onChange={changeConfirmation}
					newsletter={newsletter}
					previewNewsletter={previewNewsletter}
					sender={sender}
					contactFields={contactFields}
					action={CONFIRM_ACTION}
					isSubjectRequired
					note={!isSameEmail(confirmation, builtIn) && <ButtonBuiltIn onClick={restoreBuiltIn} />}
				/>
			)}
		</Section>
	);
}

// Its switch works while signups confirm too: turned on, it says that saving turns double opt-in off (readSettingsForm
// sends both). Switched on empty, it starts from the newsletter's name and description.
function SectionWelcome({
	draft,
	setDraft,
	newsletter,
	sender,
	previewNewsletter,
	contactFields,
	discardCount,
	isSendingEnabled,
	testRecipients,
	welcomePause,
	isCloud,
	review,
}) {
	const paywall = usePaywall();
	const hasPlan = paywall?.hasPlan ?? true;
	const [isTestOpen, setIsTestOpen] = useState(false);
	const testButtonRef = useRef(null);
	const [version, setVersion] = useState(0);
	const { isWelcomeEnabled, welcome } = draft;
	const isConfirmationOn = Boolean(newsletter.requireConfirmation);
	const changeWelcome = useCallback((changes) => setDraft((current) => ({ ...current, welcome: { ...current.welcome, ...changes } })), [setDraft]);

	function switchWelcome(isEnabled) {
		const next = isEnabled ? prefillWelcome(welcome, { name: draft.name, description: draft.description }) : welcome;
		setDraft((current) => ({ ...current, isWelcomeEnabled: isEnabled, welcome: next }));
		if (next !== welcome) setVersion((count) => count + 1);
	}

	function openTest() {
		if (!hasPlan) return paywall.open("test");
		setIsTestOpen(true);
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
				<NoticeSection>Saving turns off double opt-in: new subscribers join right away, without confirming their address.</NoticeSection>
			)}
			{welcomePause && isWelcomeEnabled && <NoticeWelcomePaused {...welcomePause} className="px-4 py-3" />}
			{review && isWelcomeEnabled && <NoticeReview review={review} instead="new subscribers don't get it" />}
			<EditorEmail
				key={`${discardCount}-${version}`}
				name="welcome"
				email={welcome}
				onChange={changeWelcome}
				newsletter={newsletter}
				previewNewsletter={previewNewsletter}
				sender={sender}
				contactFields={contactFields}
				note={
					<p className="text-xs wrap-anywhere text-muted-foreground">
						{isSendingEnabled || !hasPlan ? `Sends the saved version to ${describeTestRecipients(testRecipients)}` : "Sending is off"}
					</p>
				}
			>
				<Button
					ref={testButtonRef}
					type="button"
					variant="outline"
					size="sm"
					onClick={openTest}
					disabled={hasPlan && !isSendingEnabled}
				>
					<FlaskConical />
					Send test
				</Button>
			</EditorEmail>
			<DialogSendTest
				isOpen={isTestOpen}
				onOpenChange={setIsTestOpen}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					testButtonRef.current?.focus();
				}}
				newsletterId={newsletter._id}
				defaultRecipients={testRecipients}
				description="Sends the saved welcome email, with [Test] before its subject."
				contactHint="The welcome email as this contact would get it, with their first name and fields."
				onSend={(values) => sendWelcomeTest(newsletter._id, values)}
			/>
		</Section>
	);
}

// Until it's edited, the built-in last-chance email follows the name.
function SectionCleanup({ draft, setDraft, set, newsletter, sender, previewNewsletter, contactFields, discardCount, totals, review }) {
	const { name, isCleanupEnabled, cleanup, lastChanceEdits } = draft;
	const savedCleanup = getCleanupSettings(newsletter);
	const [version, setVersion] = useState(0);
	const lastChance = useMemo(() => getDraftLastChance({ name, lastChanceEdits }, newsletter), [name, lastChanceEdits, newsletter]);
	const builtIn = useMemo(() => getBuiltInLastChance({ name }), [name]);
	const changeLastChance = useCallback(
		(changes) => setDraft((current) => ({ ...current, lastChanceEdits: { ...getDraftLastChance(current, newsletter), ...changes } })),
		[setDraft, newsletter]
	);

	function restoreBuiltIn() {
		setDraft((current) => ({ ...current, lastChanceEdits: builtIn }));
		setVersion((count) => count + 1);
	}

	function updateCleanup(key) {
		return (event) => {
			const { value } = event.target;
			setDraft((current) => ({ ...current, cleanup: { ...current.cleanup, [key]: value } }));
		};
	}

	return (
		<>
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
					for {cleanup.days || savedCleanup.days} days get it instead. A click on its button keeps them. Anyone who
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
			</Section>
			{isCleanupEnabled && (
				<Section title="Last-chance email" stagger={2}>
					<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
						Write it in your own words, or in your readers&apos; language. Keep its button: a click on it keeps them.
					</p>
					{review && <NoticeReview review={review} instead="contacts who stopped opening get the built-in one" />}
					<EditorEmail
						key={`${discardCount}-${version}`}
						name="lastChance"
						email={lastChance}
						onChange={changeLastChance}
						newsletter={newsletter}
						previewNewsletter={previewNewsletter}
						sender={sender}
						contactFields={contactFields}
						action={KEEP_ACTION}
						isSubjectRequired
						note={!isSameEmail(lastChance, builtIn) && <ButtonBuiltIn onClick={restoreBuiltIn} />}
					/>
				</Section>
			)}
			{totals && <SectionStoppedDomains totals={totals} stagger={isCleanupEnabled ? 3 : 2} />}
		</>
	);
}

// The list hygiene's daily check of subscribers' domains (lib/list-hygiene.js): always on, so only its counts show.
function SectionStoppedDomains({ totals, stagger }) {
	const stats = [
		{ label: "No mail server", value: totals.noMailServer },
		...(totals.isSpamListOn || totals.spamDomain > 0 ? [{ label: "Spam domain", value: totals.spamDomain }] : []),
	];
	return (
		<Section title="Stopped for their domain" stagger={stagger}>
			<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
				MailCheap checks your contacts&apos; domains in the background.
				{totals.isSpamListOn && " Contacts on a known spam domain stop getting issues at once."} Contacts on one that
				can&apos;t receive email stop after two checks a day apart, and get issues again once it can.{" "}
				<LinkHelp article="list-cleanup" section="domains" />
			</p>
			<dl className={cn("grid divide-x divide-border/60", stats.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
				{stats.map(({ label, value }) => (
					<div key={label} className="flex flex-col gap-1 px-4 py-3">
						<dt className="text-xs text-pretty text-muted-foreground">{label}</dt>
						<dd className="text-lg font-semibold tabular-nums">{formatNumber(value)}</dd>
					</div>
				))}
			</dl>
		</Section>
	);
}

function SectionWebsite({
	draft,
	setDraft,
	set,
	update,
	newsletter,
	sharedDomain,
	appUrl,
	hasArchiveHost,
	websiteDomain,
	hasSentIssue,
	discardCount,
}) {
	const paywall = usePaywall();
	const hasPlan = paywall?.hasPlan ?? true;
	const { isArchiveEnabled } = draft;
	const archiveHost = newsletter.archiveHost;
	const slug = newsletter.slug || draft.slug || "slug";
	const websiteAddress = getWebsiteAddress({ slug, archiveHost }, { sharedDomain, appUrl });

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
				<Field
					label="Address"
					as="div"
					hint={
						!isArchiveEnabled ? (
							"Your website is off. Turn it on above to publish your issues on it."
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
			{hasArchiveHost && (
				<CardWebsiteDomain
					newsletterId={newsletter._id}
					setup={websiteDomain}
					sharedAddress={getWebsiteAddress({ slug }, { sharedDomain, appUrl }).replace(/^https?:\/\//, "")}
					stagger={2}
				/>
			)}
			<Section title="Profile" stagger={3}>
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
						isCropped
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
			<SectionAnalytics
				draft={draft}
				setDraft={setDraft}
				newsletter={newsletter}
				sharedDomain={sharedDomain}
				hasArchiveHost={hasArchiveHost}
				websiteDomain={websiteDomain}
				stagger={4}
			/>
		</>
	);
}

// Where each tool's ID is, said in the tool's own words.
const ANALYTICS_HINTS = {
	googleAnalytics: "Measurement ID: in Google Analytics, Admin, then Data streams",
	googleTagManager: "Container ID: at the top of your Tag Manager workspace",
	metaPixel: "Pixel ID: under your pixel's name in Meta Events Manager",
};

// The analytics tools the website loads (lib/website-analytics.js). A field takes the ID or the code its tool gives, and
// keeps the ID. Without a host of its own, the website shares the dashboard's address and loads none. Custom code, any
// other script, runs on the newsletter's own domain only (lib/website-code.js), where the server has them (hasArchiveHost):
// its tags are checked as it's typed, its JavaScript when it's saved.
function SectionAnalytics({ draft, setDraft, newsletter, sharedDomain, hasArchiveHost, websiteDomain, stagger }) {
	const codeId = useId();
	const host = getNewsletterHost(newsletter, sharedDomain);
	const isOwnDomain = Boolean(newsletter.archiveHost);
	const codeProblem = readCustomCode(draft.customCode).problem;
	const isCodeWaiting = !isOwnDomain && Boolean(draft.customCode.trim());

	function update(key) {
		return (event) => {
			const value = readAnalyticsField(key, event.target.value);
			setDraft((current) => ({ ...current, analytics: { ...current.analytics, [key]: value } }));
		};
	}

	return (
		<Section title="Analytics" stagger={stagger}>
			<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
				Paste each tool&apos;s ID, or the code it gives you. They load on every page of your website and get an event for each
				signup there. <LinkHelp article="website-analytics" />
			</p>
			{!host && <NoticeSection>Your website shares the dashboard&apos;s address on this server, so analytics only load on your own domain.</NoticeSection>}
			{ANALYTICS_TOOLS.map(({ key, name, example }) => (
				<Field
					key={key}
					label={
						<span className="inline-flex items-center gap-2">
							<LogoAnalyticsTool tool={key} />
							{name}
						</span>
					}
					hint={
						key === "googleTagManager" && host && !isOwnDomain
							? `${ANALYTICS_HINTS[key]}. On ${host}, it runs Google's own tags; on your own domain, all of them.`
							: ANALYTICS_HINTS[key]
					}
				>
					<Input
						name={key}
						value={draft.analytics[key]}
						placeholder={example}
						autoComplete="off"
						spellCheck={false}
						className="font-mono"
						onChange={update(key)}
					/>
				</Field>
			))}
			{(hasArchiveHost || isOwnDomain) && (
				<Field
					label={
						<span className="inline-flex items-center gap-2">
							<CodeXml className="size-4 shrink-0" aria-hidden="true" />
							Custom code
						</span>
					}
					htmlFor={codeId}
					hint={
						isCodeWaiting ? (
							<HintCodeWaiting host={host} pendingHost={websiteDomain?.isLive === false ? websiteDomain.host : null} />
						) : (
							<>
								{isOwnDomain
									? "Goes in the head of every page of your website, like the code another tool gives you."
									: `Runs once your website is on your own domain${host ? `, never on ${host}, which other newsletters share` : ""}.`}{" "}
								<LinkHelp article="website-analytics" section="custom-code" />
							</>
						)
					}
					isWarning={isCodeWaiting}
				>
					<Textarea
						id={codeId}
						name="customCode"
						value={draft.customCode}
						rows={4}
						maxLength={CUSTOM_CODE_MAX_LENGTH}
						placeholder={'<script async src="https://example.com/script.js"></script>'}
						spellCheck={false}
						aria-invalid={codeProblem ? true : undefined}
						aria-describedby={codeProblem ? `${codeId}-problem` : undefined}
						className="font-mono text-[13px] leading-6"
						onChange={(event) => {
							const { value } = event.target;
							setDraft((current) => ({ ...current, customCode: value }));
						}}
					/>
					<span
						id={`${codeId}-problem`}
						aria-live="polite"
						className={cn("text-xs text-pretty", codeProblem ? "text-red-600 dark:text-red-400" : "sr-only")}
					>
						{codeProblem && `Line ${codeProblem.line}: ${codeProblem.message}`}
					</span>
				</Field>
			)}
		</Section>
	);
}

// Custom code while the website isn't on the newsletter's own domain yet: the way there, in the card above.
function HintCodeWaiting({ host, pendingHost }) {
	return (
		<>
			Not running yet:{" "}
			{pendingHost
				? `your code runs once ${pendingHost} is live.`
				: `your code runs on your own domain${host ? `, never on ${host}, which other newsletters share` : ""}.`}{" "}
			<a href={`#${OWN_DOMAIN_ID}`} onClick={goToOwnDomain} className={INLINE_LINK}>
				{pendingHost ? "Finish setting it up" : "Add your domain"}
			</a>
		</>
	);
}

function goToOwnDomain(event) {
	const card = document.getElementById(OWN_DOMAIN_ID);
	if (!card) return;
	event.preventDefault();
	const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	card.scrollIntoView({ behavior: isReduced ? "auto" : "smooth", block: "center" });
	card.querySelector("input")?.focus({ preventScroll: true });
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

// Back to the built-in confirmation or last-chance email, which follows the newsletter's name from then on.
function ButtonBuiltIn({ onClick }) {
	return (
		<Button type="button" variant="ghost" size="sm" onClick={onClick} className="-ml-2 text-muted-foreground">
			<RotateCcw />
			Use the built-in email
		</Button>
	);
}

// The links each reader of these emails gets their own of (lib/action-links.js), which their buttons keep.
const CONFIRM_ACTION = {
	href: CONFIRM_URL_PLACEHOLDER,
	label: "Confirms their subscription",
	buttonText: CONFIRM_BUTTON_TEXT,
	missing: "This email needs its button: new subscribers click it to confirm.",
};
const KEEP_ACTION = {
	href: KEEP_URL_PLACEHOLDER,
	label: "Keeps them on your list",
	buttonText: KEEP_BUTTON_TEXT,
	missing: "This email needs its button: a click on it keeps them on your list.",
};

// The content check holds the saved email (lib/signup-email-review.js): what new subscribers get meanwhile, never why.
function NoticeReview({ review, instead }) {
	return (
		<NoticeSection>
			<span>
				{review.status === "in_review"
					? `In review: a person at MailCheap checks this email before it goes out, usually within a few hours. Until then, ${instead}.`
					: `This email can't be sent${review.note ? `: ${review.note}` : ""}. Until you change it, ${instead}.`}{" "}
				<LinkHelp article="sending" section="content-check" />
			</span>
		</NoticeSection>
	);
}

// Above a section's fields: what saving also changes in another section, said before it's saved, or what the content
// check holds.
function NoticeSection({ children }) {
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

// Who the newsletter's new issues start with (lib/authors.js), whose address gets the replies to its own emails. Saved as
// it's picked, like the authors added and edited here, so Save and Discard leave it as it is. list: its authors as
// PickerAuthor takes them; defaultId: the default one's, whose place goes to the first of the others once they're removed.
function FieldAuthor({ newsletterId, list, defaultId, suggestion }) {
	const [authors, setAuthors] = useState(list);
	const [chosenId, setChosenId] = useState(defaultId);
	const authorId = authors.some(({ id }) => id === chosenId) ? chosenId : (authors[0]?.id ?? null);

	return (
		<Field
			as="div"
			label="Author"
			hint={
				authors.length > 0 ? (
					<>
						New issues start with this author, and each can have its own. Replies to your welcome and confirmation emails go
						to them too. <LinkHelp article="writing" section="author" />
					</>
				) : (
					<>
						Who writes your issues: readers see their name, and replies go to their email. Issues need one before they go
						out. <LinkHelp article="writing" section="author" />
					</>
				)
			}
		>
			<PickerAuthor
				variant="field"
				authors={authors}
				authorId={authorId}
				suggestion={suggestion}
				onPick={setDefaultAuthor}
				onAdd={(values) => addDefaultAuthor(newsletterId, values)}
				onAuthorsChange={setAuthors}
				onAuthorChange={setChosenId}
			/>
		</Field>
	);
}

// Each case ends on its way forward: a verified domain is picked right here, the rest is done on the Domains page.
function getFromHint({ isShared, isDomainUnverified, fromDomain, domains, onPickDomain }) {
	if (isShared) {
		const verified = domains.find((item) => item.verified);
		const pending = domains.find((item) => !item.verified);
		return (
			<>
				The shared address follows the slug and needs no setup. Replies go to the author below, or to your account email.{" "}
				{verified ? (
					<button type="button" onClick={() => onPickDomain(verified.domain)} className={INLINE_LINK}>
						Send from {verified.domain}
					</button>
				) : pending ? (
					<Link href={DOMAINS_PATH} className={INLINE_LINK}>
						Finish verifying {pending.domain}
					</Link>
				) : (
					<>
						Your own domain helps delivery and your brand.{" "}
						<Link href={ADD_DOMAIN_PATH} className={INLINE_LINK}>
							Add a domain
						</Link>
					</>
				)}
			</>
		);
	}
	if (isDomainUnverified) {
		const hasDnsProblem = domains.some(({ domain, dnsProblems }) => domain === fromDomain && dnsProblems?.length > 0);
		return (
			<>
				{hasDnsProblem
					? `${fromDomain}'s DNS records need a fix. Nothing sends from it until then.`
					: `${fromDomain} isn't verified yet. Emails wait until its DNS records are in.`}{" "}
				<Link href={DOMAINS_PATH} className={INLINE_LINK}>
					{hasDnsProblem ? "Fix on Domains" : "Finish on Domains"}
				</Link>
			</>
		);
	}
	if (!fromDomain && domains.length === 0) {
		return (
			<>
				<Link href={ADD_DOMAIN_PATH} className={INLINE_LINK}>
					Add a domain
				</Link>{" "}
				to send from it
			</>
		);
	}
	return (
		<Link href={DOMAINS_PATH} className={INLINE_LINK}>
			Manage your domains
		</Link>
	);
}

const INLINE_LINK =
	"font-medium text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors duration-150 hover:decoration-foreground";

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
