import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { FIRST_SEND, isCloud } from "@/lib/config";
import { MAX_CONTACT_FIELDS } from "@/lib/contact-fields";
import { MAX_IMPORT_ROWS } from "@/lib/csv-import";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { CONSENT_TEXT } from "@/lib/import-checks";

export const metadata = getHelpPageMetadata("importing-contacts");

export default function ImportingContactsPage() {
	return (
		<ArticleHelp slug="importing-contacts">
			<h2 id="export">Export from your current platform</h2>
			<p>
				Substack, beehiiv, Mailchimp, Kit, Buttondown and most other platforms export subscribers as a CSV file. Then, on the{" "}
				<LinkApp href="/contacts">Contacts page</LinkApp>, click Import contacts and choose the file.
				{isCloud() && " Importing needs a plan."}
			</p>
			<p>
				From beehiiv: open{" "}
				<a href="https://app.beehiiv.com/settings/publication/export_data" target="_blank" rel="noopener">
					Settings, then Export data
				</a>
				, and under Export subscribers (full version), click Export all subscribers, so custom fields, tags and stats come along.
				beehiiv emails you the file; it&apos;s also under Historical exports on that page, with a Download link. The quick version
				works too, but only brings email and status.
			</p>

			<h2 id="columns">What the import reads</h2>
			<ul>
				<li>
					<strong>Email</strong>: the only column it needs, under names like email, email address or subscriber.
				</li>
				<li>
					<strong>Status</strong>: subscribed, unsubscribed, bounced or complained in the platform&apos;s own words. A status it
					doesn&apos;t know, like unconfirmed, makes the contact dormant.
				</li>
				<li>
					<strong>Signup date</strong>, so your contacts keep the day they joined.
				</li>
				<li>
					<strong>Open and click rates</strong>, when the platform exports them: your sends reach the most engaged first, so your
					best readers get your first issue first.
				</li>
				<li>
					<strong>Opens and clicks</strong>: the last open and click, and how many emails each person opened and clicked, when the
					export has them (beehiiv&apos;s full export does). Segments on opens and clicks work from your first day.
				</li>
			</ul>
			<h2 id="check">Check before you import</h2>
			<p>
				Once you pick the file, MailCheap shows the first contacts as they&apos;ll be in your list (email, first name, status, tags
				and fields), with the number of rows. Below, every column shows a few of its values and where they go, in plain words:
				Email, First name, Status, Signup date, Tags, one of your fields, a new field, or Don&apos;t import.
			</p>
			<p>
				Columns MailCheap recognized are folded under Recognized, still yours to change. Under Needs a look are the columns going
				into a new field (each custom field, and where readers came from: beehiiv&apos;s acquisition source, channel, campaign and
				referring URL, as text, a number or a date from its values) and the ones left out, like the platform&apos;s ids, plans,
				revenue, counters and devices. The first name comes from First Name, first_name, or the first word of a Name column; tags
				from Tags or Groups.
			</p>
			<p>
				Tags label people, as many as you like each: a tags column can list several, separated by commas. A field keeps one value
				per person, like a company. Tag everyone adds tags to the whole file, to find these contacts later. An account holds up to{" "}
				{MAX_CONTACT_FIELDS} fields: past that, the other columns aren&apos;t imported. The next import puts the same columns into
				your fields on its own.
			</p>
			<p>
				For contacts already in your list, a first name and fields in the file replace theirs, and tags are added to theirs. Instead
				of the file&apos;s statuses, you can import everyone as dormant, for an old list you&apos;d rather wake up slowly: dormant
				contacts get nothing until you mark them active.
			</p>

			<h2 id="background">Big files</h2>
			<p>
				An import runs in the background, up to {MAX_IMPORT_ROWS.toLocaleString("en-US")} rows. Once the file is sent, which takes a
				few seconds, you can close the window and keep working: the <LinkApp href="/contacts">Contacts page</LinkApp> shows how far
				it is, then what it added, what was already there and what it left out, and why. A small file goes in at once.
			</p>
			<p>
				Through the API or an AI assistant, import_contacts takes 1,000 rows a call and answers right away; get_import shows the
				import&apos;s progress and counts.
			</p>

			<h2 id="consent">Consent</h2>
			<p>
				Before importing, you tick &ldquo;{CONSENT_TEXT}&rdquo;. Only import people who signed up for your newsletter: a bought or
				scraped list brings bounces and spam complaints, which pause your sends and can block your account.
			</p>

			<h2 id="left-out">What it leaves out</h2>
			<p>The import checks each address and leaves out, with a count for each reason:</p>
			<ul>
				<li>invalid addresses, and misspelled domains like gmial.com;</li>
				<li>spam traps, throwaway inboxes and role addresses like info@ or support@;</li>
				<li>duplicates in the file, and addresses on domains that can&apos;t receive email;</li>
				<li>people who unsubscribed, bounced or complained before, even if you deleted them since;</li>
				<li>addresses MailCheap knows can&apos;t receive email, because they bounced or hit a spam trap for any sender.</li>
			</ul>
			<p>
				Contacts already in your list keep their status, unless the file gives a stricter one (unsubscribed, bounced or complained),
				which is final. An import never sends welcome emails.
			</p>

			<h2 id="after">After the import</h2>
			<p>
				The first time you send to contacts who never got an email from you, a slice of them goes first and the rest follows{" "}
				{FIRST_SEND.waitMinutes / 60} hours later if the slice looks clean.{" "}
				<Link href={getHelpHref("sending", "first-send")}>First sends in steps</Link>
			</p>
			{isCloud() && (
				<p>
					Your active contacts count toward your plan&apos;s subscribers. With more than it allows, sending waits until you upgrade.{" "}
					<Link href={getHelpHref("plans")}>Plans and billing</Link>
				</p>
			)}
		</ArticleHelp>
	);
}
