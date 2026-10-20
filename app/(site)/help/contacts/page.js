import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { TRIAL_CONTACTS } from "@/lib/actions/contacts";
import { isCloud } from "@/lib/config";
import { MAX_CONTACT_FIELDS, MAX_TAGS, MAX_TAG_LENGTH } from "@/lib/contact-fields";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { MAX_SEGMENT_CONDITIONS, SEGMENT_PRESETS, describeSegment } from "@/lib/segments";

export const metadata = getHelpPageMetadata("contacts");

export default function ContactsPage() {
	return (
		<ArticleHelp slug="contacts">
			<h2 id="statuses">Statuses</h2>
			<p>
				The <LinkApp href="/contacts">Contacts page</LinkApp> lists the open newsletter&apos;s contacts, newest signups first. Filter
				them by status or by tag, or search by email address.
			</p>
			<table>
				<thead>
					<tr>
						<th>Status</th>
						<th>What it means</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Active</td>
						<td>Gets your issues.{isCloud() && " Counts toward your plan's subscribers."}</td>
					</tr>
					<tr>
						<td>Pending</td>
						<td>Signed up and hasn&apos;t clicked the confirmation email yet. Gets nothing else until then.</td>
					</tr>
					<tr>
						<td>Dormant</td>
						<td>
							Stopped opening and didn&apos;t answer the <Link href={getHelpHref("list-cleanup")}>last-chance email</Link>, was
							imported as dormant, or you marked them dormant. Gets no issues until you mark them active.
						</td>
					</tr>
					<tr>
						<td>Unsubscribed</td>
						<td>
							Unsubscribed, or you unsubscribed them. Back if they sign up again, or if you resubscribe them because they asked.
						</td>
					</tr>
					<tr>
						<td>Bounced</td>
						<td>Their address can&apos;t receive email. Never emailed again.</td>
					</tr>
					<tr>
						<td>Complained</td>
						<td>Marked one of your emails as spam. Never emailed again.</td>
					</tr>
				</tbody>
			</table>

			<h2 id="details">First names, tags and fields</h2>
			<p>
				Besides an email address, each contact can have a first name, tags and values for your own fields. Open a contact&apos;s menu
				and click Edit details to change them.
			</p>
			<ul>
				<li>
					<strong>First name</strong>: what <code>{"{{first_name}}"}</code> shows in your emails.{" "}
					<Link href={getHelpHref("writing", "first-name")}>Greeting readers by name</Link>
				</li>
				<li>
					<strong>Tags</strong>: labels like vip or podcast, {MAX_TAGS} per contact at most. Tags are lowercase, up to {MAX_TAG_LENGTH}{" "}
					characters, without commas. Tag lists everyone the page shows with its filters, or takes a tag off them.
				</li>
				<li>
					<strong>Fields</strong>: your own, like a company or a birthday, as text, a number or a date, {MAX_CONTACT_FIELDS} at most.
					Add them from Fields, at the top of the <LinkApp href="/contacts">Contacts page</LinkApp>. They&apos;re shared by your
					newsletters. Deleting a field hides its
					values, and adding it again brings them back.
				</li>
			</ul>
			<p>
				A signup form, an import and the <Link href={getHelpHref("api-and-ai")}>API</Link> can fill them in too. When someone signs
				up again, their first name and fields only fill in what&apos;s missing, and new tags are added to theirs.
			</p>

			<h2 id="segments">Segments</h2>
			<p>
				A segment picks some of your contacts with a few conditions, and keeps up to date as they change. The{" "}
				<LinkApp href="/contacts">Contacts page</LinkApp> shows each one as a card with its count: click it to list its contacts, and
				the export follows. New segment opens the editor, with a few starting points:
			</p>
			<ul>
				{SEGMENT_PRESETS.map((segment) => (
					<li key={segment.name}>
						<strong>{segment.name}</strong>: {describeSegment(segment).toLowerCase()}.
					</li>
				))}
			</ul>
			<p>
				Conditions can be on opens and clicks, issues missed in a row, the number of emails opened, the signup date, where they signed
				up (your website&apos;s signup form, the form on your own site, an import, by hand or the API), the email address, a tag,
				whether they have a first name, and your own fields, {MAX_SEGMENT_CONDITIONS} at most. A segment matches all of its
				conditions, or any of them. In the send step, pick one to send an issue to its contacts only.{" "}
				<Link href={getHelpHref("sending", "who")}>Who gets it</Link>
			</p>
			<p>
				Counts are of active contacts, the ones an issue goes to. Conditions on dates count back from now, so &ldquo;opened in the last
				30 days&rdquo; follows time, and a send reads its segment when it goes out. A segment that a scheduled or sending issue goes to
				can&apos;t be deleted until that issue goes elsewhere.
			</p>

			<h2 id="add">Adding someone by hand</h2>
			<p>
				On the <LinkApp href="/contacts">Contacts page</LinkApp>, click Add a contact and type their email address. It works like a
				signup on your website: they get your confirmation email if
				the newsletter confirms signups, or your welcome email if it&apos;s on.
				{isCloud() && ` Without a plan, you can add ${TRIAL_CONTACTS.limit} contacts a day, enough to try it on yourself.`}
			</p>
			<p>
				For a whole list, import a CSV file instead: <Link href={getHelpHref("importing-contacts")}>Importing contacts</Link>.
			</p>

			<h2 id="actions">Changing a status, and deleting</h2>
			<p>Each contact&apos;s menu, at the end of their row, has what applies to them:</p>
			<ul>
				<li>
					<strong>Edit details</strong> changes their first name, tags and fields.
				</li>
				<li>
					<strong>Mark as active</strong> brings back a dormant contact: they get your next issue. On a pending contact, it skips
					the confirmation email, once you confirm they asked for your emails.
				</li>
				<li>
					<strong>Mark as dormant</strong> stops issues to an active contact without unsubscribing them, as the list cleanup does.
					Mark them active again any time.
				</li>
				<li>
					<strong>Unsubscribe</strong> stops every email to them.
				</li>
				<li>
					<strong>Resubscribe</strong> brings back someone who unsubscribed. Do it only when they asked: MailCheap asks you to
					confirm it, and keeps who did it and when. Someone who unsubscribed can&apos;t be marked dormant, so they only come back
					this way or by signing up again.
				</li>
				<li>
					<strong>Delete contact</strong> removes them with their dates and engagement, and can&apos;t be undone. For someone who
					unsubscribed, bounced or complained, MailCheap keeps a scrambled trace of the address, so adding it again never emails it.
					Anyone else can be added again like a new contact.
				</li>
			</ul>
			<p>
				Bounced and complained contacts keep their status: their address can&apos;t receive email, or they marked one of your
				emails as spam. No email goes out when you change a status. The{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link> can change statuses too, with the same rules.
			</p>

			<h2 id="export">Exporting</h2>
			<p>
				Export downloads the contacts that match your filters as a CSV file, with their first name, tags and a column per field. Its
				columns go back in through the import as they are, so it&apos;s also a backup.
			</p>

			<h2 id="undeliverable">Addresses no one can reach</h2>
			<p>
				When an address hard bounces or turns out to be a spam trap, MailCheap remembers it for every sender: imports and signups
				leave it out, and sends skip it, showing the contact as bounced. A bounced address is remembered for 180 days, a spam trap for
				good.
			</p>
		</ArticleHelp>
	);
}
