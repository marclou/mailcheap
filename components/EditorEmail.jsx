"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CircleAlert, Eye, Plus } from "lucide-react";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import EditorRich from "@/components/EditorRich";
import RowCampaign from "@/components/RowCampaign";
import { Button } from "@/components/ui/button";
import { CONFIRM_URL_PLACEHOLDER, KEEP_URL_PLACEHOLDER } from "@/lib/action-links";
import { toPreviewFrame } from "@/lib/email-preview";
import { toEditorHtml, toEmailContent } from "@/lib/newsletter-emails";
import { renderEmail } from "@/lib/render-email";

// One of the newsletter's own emails on its settings page (components/FormNewsletter.jsx): its subject and preview text,
// its body in the campaign editor, without sections, and a preview of it as readers get it. The form sends its body in
// the editor's HTML once it's edited there, and as it was saved until then, Markdown included (lib/newsletter-sections.js).
// name: its fields' prefix. email: { subject, previewText, format, content }, and onChange(changes) takes what changed.
// action: { href, label, buttonText, missing }, the link MailCheap fills in for each reader, which the email's button
// keeps, and what to say while it has none. previewNewsletter: its name, postal address and theme, for the preview.
// note: on the left under the editor, like a way back to the built-in email; children: buttons before Preview. The
// editor opens on the email as it is when this mounts: a key starts it over.
export default function EditorEmail({
	name,
	email,
	onChange,
	newsletter,
	previewNewsletter,
	sender,
	contactFields,
	action = null,
	isSubjectRequired = false,
	note = null,
	children,
}) {
	const [initialHtml] = useState(() => toEditorHtml(email));
	const [editedFields, setEditedFields] = useState(null);
	const [isPreviewOpen, setIsPreviewOpen] = useState(false);
	const editorRef = useRef(null);
	const cardRef = useRef(null);
	const fields = editedFields ?? contactFields;
	const isActionMissing = Boolean(action) && !email.content.includes(`href="${action.href}"`);
	const updateBody = useCallback((html) => onChange({ format: "rich", content: html }), [onChange]);
	const actionLink = useMemo(() => action && { href: action.href, label: action.label }, [action]);
	// Rendered only while it shows: a long email takes a few milliseconds.
	const previewHtml = useMemo(() => {
		if (!isPreviewOpen) return "";
		const { html } = renderEmail({ ...toEmailContent(email), newsletter: previewNewsletter });
		return toPreviewFrame(html).replaceAll(CONFIRM_URL_PLACEHOLDER, "#").replaceAll(KEEP_URL_PLACEHOLDER, "#");
	}, [isPreviewOpen, email, previewNewsletter]);

	function addButton() {
		editorRef.current?.append({ type: "button", attrs: { href: action.href }, content: [{ type: "text", text: action.buttonText }] });
	}

	return (
		<>
			<input type="hidden" name={`${name}Format`} value={email.format} />
			<input type="hidden" name={`${name}Content`} value={email.content} />
			<RowCampaign label="Subject">
				<input
					name={`${name}Subject`}
					value={email.subject}
					onChange={(event) => onChange({ subject: event.target.value })}
					required={isSubjectRequired}
					placeholder="Subject"
					aria-label="Subject"
					maxLength={200}
					className="h-11 w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
				/>
			</RowCampaign>
			<RowCampaign label="Preview text">
				<input
					name={`${name}PreviewText`}
					value={email.previewText}
					onChange={(event) => onChange({ previewText: event.target.value })}
					placeholder="Shown after the subject in inboxes"
					aria-label="Preview text"
					maxLength={300}
					className="h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				/>
			</RowCampaign>
			{isActionMissing && (
				<div
					role="status"
					className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-amber-50 px-4 py-3 text-sm text-amber-900 animate-enter dark:bg-amber-500/10 dark:text-amber-200"
				>
					<span className="flex min-w-0 flex-1 basis-56 items-start gap-2 text-pretty">
						<CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						{action.missing}
					</span>
					<Button type="button" variant="outline" size="sm" onClick={addButton}>
						<Plus />
						Add the button
					</Button>
				</div>
			)}
			<div ref={cardRef} className="relative">
				<EditorRich
					ref={editorRef}
					gutterRef={cardRef}
					content={initialHtml}
					onChange={updateBody}
					contactFields={fields}
					onContactFieldsChange={setEditedFields}
					newsletter={newsletter}
					actionLink={actionLink}
					minHeight="min-h-64"
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
				<div className="flex min-w-0 flex-1 items-center">{note}</div>
				<div className="flex shrink-0 items-center gap-2">
					{children}
					<Button type="button" variant="outline" size="sm" onClick={() => setIsPreviewOpen(true)}>
						<Eye />
						Preview
					</Button>
				</div>
			</div>
			<DialogPreviewEmail
				isOpen={isPreviewOpen}
				onOpenChange={setIsPreviewOpen}
				html={previewHtml}
				sender={sender}
				subject={email.subject}
				previewText={email.previewText}
				newsletterId={newsletter._id}
				contactFields={fields}
			/>
		</>
	);
}
