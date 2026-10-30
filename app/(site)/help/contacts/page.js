import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import FigureHelp from "@/components/FigureHelp";
import LinkApp from "@/components/LinkApp";
import { TRIAL_CONTACTS } from "@/lib/actions/contacts";
import { isCloud } from "@/lib/config";
import { MAX_CONTACT_FIELDS, MAX_TAGS, MAX_TAG_LENGTH } from "@/lib/contact-fields";
import { LIST_STARTED_AT, SEGMENTS_FROM } from "@/lib/contacts-header";
import { isSpamListEnabled } from "@/lib/domain-reputation";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { ACTIVITY_DAYS, MAX_SEGMENT_CONDITIONS, SEGMENT_PRESETS, describeSegment } from "@/lib/segments";

export const metadata = getHelpPageMetadata("contacts");

export default function ContactsPage() {
	return (
		<ArticleHelp slug="contacts">
			<h2 id="statuses">Statuses</h2>
			<p>
				The <LinkApp href="/contacts">Contacts page</LinkApp> lists the open newsletter&apos;s contacts, newest signups first, each
				with their Gravatar photo, or else the logo of their email&apos;s domain, or their initial. Each one has a status:
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

			<h2 id="filters">Searching and filtering</h2>
			<p>
				Search by any part of an email address: <code>@example.com</code> finds everyone at that domain, and a <code>*</code> stands
				for any characters, as in <code>jane*@example.com</code>. Next to the search, filters narrow the list:
			</p>
			<ul>
				<li>
					<strong>Status</strong>: one of the statuses above, each with how many contacts have it.
				</li>
				<li>
					<strong>Signed up</strong>: before a day, after one, or between two, both included. Days are in UTC, like the dates in the
					list.
				</li>
				<li id="sources" className="scroll-mt-20">
					<strong>Source</strong>: how they joined your list: your website&apos;s signup form, the form on your own site, an import,
					by hand, the API, or a source an API call gave. It&apos;s set when they&apos;re added and doesn&apos;t change.
				</li>
				<li>
					<strong>Tag</strong>: everyone with a tag, once your contacts have tags. <a href="#tags">Tagging contacts</a>
				</li>
			</ul>
			<p>
				The cross on a filter clears it, and Clear clears them all. The filters stay in the page&apos;s address, so a bookmark keeps
				them. Export and Delete, in the <strong>⋯</strong> menu at the top, follow the search and the filters.
			</p>
			<FigureHelp
				src="/help/contacts/contacts-page.webp"
				alt="The Contacts page: a search and filters for status, signup date, source and tag, then each contact with their tags, status, opens and clicks."
				caption="The Contacts page"
			/>

			<h2 id="contact-page">Each contact&apos;s page</h2>
			<p>
				Click a contact on the <LinkApp href="/contacts">Contacts page</LinkApp> to open their page. At the top: their picture, name
				and address. Under them, a globe turned to their country, next to how many of your emails they got and the share they opened
				and clicked. Below, three tabs:
			</p>
			<ul>
				<li>
					<strong>Activity</strong>, newest first: every email they got, when they opened it, the links they clicked, any their inbox
					never took, and when they signed up, confirmed or changed status.
				</li>
				<li>
					<strong>About</strong>: when they subscribed, where they came from, their email provider (Gmail, Outlook, or their own
					domain, like their company&apos;s), when they confirmed and when they last clicked, the segments they&apos;re in and your
					other newsletters they&apos;re on.
				</li>
				<li>
					<strong>Fields and tags</strong>: their fields, each with what prints it in your emails, between double braces, and their
					tags.
				</li>
			</ul>
			<FigureHelp
				src="/help/contacts/contact-page.webp"
				alt="A contact's page: their country lit on a globe, 3 emails received, 67% opened and 33% clicked, then their activity."
				caption="A contact's page"
			/>
			<p>
				At the top right, the first button changes their status, and the <strong>⋯</strong> menu next to it has Edit fields, Edit
				tags and Delete contact. Click an issue to open its report, a tag to list everyone who has it, and a segment to open its page.
			</p>
			<p>
				Their activity keeps every change of their status, each with what made it: the unsubscribe link in your email or their mail
				app&apos;s button, a bounce or a spam complaint, the list cleanup or their answer to its last-chance email, signing up again,
				confirming, an import, or you. So someone who unsubscribed and came back shows both, in order. Before October 21, 2026, only
				the changes made by hand or through the API were kept: when one of those reveals an earlier change, that change shows dated
				before it.
			</p>
			<p>
				Their country comes from where they signed up or confirmed, or for someone who joined another way, like an import, where
				they first clicked a link in your emails, and the globe on their page lights it up. MailCheap reads it from their connection,
				then keeps the country only, never the address. Opens never give one, since inboxes load images through their own servers.
				{!isCloud() && " On a self-hosted server, countries need Vercel, which names each visitor's country."}
			</p>
			<p>
				Their picture is the one they set on Gravatar, if they did. Otherwise it shows their initial, over their company&apos;s logo
				when their address is on its domain. Google doesn&apos;t share Gmail pictures with other apps.
			</p>

			<h2 id="details">First names, tags and fields</h2>
			<p>
				Besides an email address, each contact can have a first name, tags and values for your own fields. On their page, or in
				their menu on the <LinkApp href="/contacts">Contacts page</LinkApp>, Edit fields changes their first name and fields, and Edit
				tags their tags. Next to each field is what prints it in your emails, between double braces, like{" "}
				<code>{"{{first_name}}"}</code>: click it to copy it.
			</p>
			<ul>
				<li>
					<strong>First name</strong>: what <code>{"{{first_name}}"}</code> shows in your emails.{" "}
					<Link href={getHelpHref("writing", "first-name")}>Names and fields in your emails</Link>
				</li>
				<li>
					<strong>Tags</strong>: labels a contact has or doesn&apos;t, like vip, podcast or customer, {MAX_TAGS} per contact at most.
					Use them to sort people into groups: list everyone with a tag, send to them through a segment, or show them a{" "}
					<Link href={getHelpHref("writing", "sections")}>section</Link> of an issue. Tags are lowercase, up
					to {MAX_TAG_LENGTH} characters, without commas, and never show in emails. <a href="#tags">Tagging contacts</a>
				</li>
				<li>
					<strong>Fields</strong>: your own questions with an answer for each contact, like a last name, a birthday or a plan, as
					text, a number or a date, {MAX_CONTACT_FIELDS} at most, shared by your newsletters. Each one&apos;s tag shows the
					reader&apos;s answer in your emails.{" "}
					<a href="#fields">Adding fields, step by step</a>
				</li>
			</ul>
			<p>
				When the answer is yes or no, use a tag: is this person a customer? When it&apos;s a value that differs from one person to the
				next, use a field: which company do they work at? Segments can pick contacts by both.
			</p>
			<p>
				When someone signs up again, their first name and fields only fill in what&apos;s missing, and new tags are added to theirs.
			</p>

			<h2 id="tags">Tagging contacts</h2>
			<p>
				Pick Edit tags in the <strong>⋯</strong> menu at the top of a contact&apos;s page, or in their menu on the{" "}
				<LinkApp href="/contacts">Contacts page</LinkApp>. Type a tag and press Enter or a comma after each one, or pick one
				you&apos;ve given other contacts: they&apos;re listed under the field, the most used first, each with how many contacts
				have it. Click one, or use the arrow keys then Enter. Click × on a tag to take it off, then save.
			</p>
			<FigureHelp
				src="/help/contacts/tags.webp"
				alt="The Edit tags dialog for a contact, with their tag and the tags already used, each with how many contacts have it."
				caption="Tagging a contact"
			/>
			<p>
				To tag many contacts at once, tag everyone an import adds, or use the{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>, which can also tag people as they sign up from your own
				site. Click a tag on a contact&apos;s page to list everyone who has it.
			</p>

			<h2 id="fields">Adding fields, step by step</h2>
			<p>
				Fields keep what you know about each reader besides their address: a last name, a birthday, a favorite color, the plan
				they&apos;re on. Every contact already has a first name and tags, so those need no field.
			</p>
			<FigureHelp
				src="/help/contacts/fields.webp"
				alt="The Contact fields dialog: how a field prints each reader's own value, then six fields with their tags to copy, and a new field's name and type."
				caption="Your contact fields"
			/>
			<ol>
				<li>
					<strong>Make your fields.</strong> Click Fields at the top of the <LinkApp href="/contacts">Contacts page</LinkApp>.
					Before your list has contacts, and on a phone, it&apos;s Contact fields in the <strong>⋯</strong> menu there. On a
					contact&apos;s page, Add a field opens the same list, under their fields or in Edit fields. Type a name, like Birthday,
					pick its type (text, a number or a date) and click the plus. Its key, like <code>birthday</code>, is
					what imports, segments and the API call it, and between double braces, like <code>{"{{birthday}}"}</code> next to it,
					it prints each reader&apos;s own value in your emails: click it to copy it. While writing an issue, type <kbd>/</kbd>{" "}
					and pick Add a field to make one there, which goes where you typed the slash. An import can make fields for you too, as
					below.
				</li>
				<li>
					<strong>Fill them in</strong>, whichever way suits you:
					<ul>
						<li>
							<strong>By hand</strong>: open a contact&apos;s page, or their menu at the end of their row, click Edit fields, and
							type their first name and a value for each field. A date field opens a calendar: pick the month and year at its top,
							then the day, and the cross at its end clears it.
						</li>
						<li>
							<strong>From a CSV file</strong>: import it from the <LinkApp href="/contacts">Contacts page</LinkApp>. Each column
							shows where it goes: First name, one of your fields, or a new field the import makes from the column.{" "}
							<Link href={getHelpHref("importing-contacts", "check")}>Check before you import</Link>
						</li>
						<li>
							<strong>From your signup form</strong>: turn on First name in{" "}
							<LinkApp href="/newsletters/form">Form for your site</LinkApp>, and new readers can type theirs as they sign up. The
							form asks for nothing else.
						</li>
						<li>
							<strong>From your code or an AI assistant</strong>: <Link href="/docs/api#add-contact">add_contact</Link>,{" "}
							<Link href="/docs/api#update-contact">update_contact</Link> and{" "}
							<Link href="/docs/api#import-contacts">import_contacts</Link> take a first name and fields by key, like{" "}
							<code>{'"fields": { "birthday": "1990-04-12" }'}</code>, with dates as YYYY-MM-DD, and{" "}
							<Link href="/docs/api#create-contact-field">create_contact_field</Link> makes new fields.{" "}
							<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
						</li>
					</ul>
				</li>
				<li>
					<strong>Use them in your emails.</strong> In an issue, type <kbd>/</kbd> and pick a field under Personalize, or click the
					person icon at the end of the subject, to add its tag, like <code>{"{{birthday}}"}</code>. Each reader gets their own
					value, and a fallback after a bar, like <code>{"{{plan|free}}"}</code>, shows for readers without one. Pick a contact in
					the preview to see the email with their values. <Link href={getHelpHref("writing", "first-name")}>Names and fields in your emails</Link>
				</li>
				<li>
					<strong>Pick readers by them.</strong> <a href="#segments">Segments</a> pick contacts by their fields, like everyone on the
					Pro plan.
				</li>
			</ol>
			<p>
				A value has to fit its field: a number field takes a number, and a date field a day. Clear a value to remove it. Deleting a
				field hides its values on every contact, and adding it again brings them back.
			</p>

			<h2 id="segments">Segments</h2>
			<p>
				A segment picks some of your contacts with a few conditions, and keeps up to date as they change. Once your list has{" "}
				{SEGMENTS_FROM} contacts, Segments at the top of the <LinkApp href="/contacts">Contacts page</LinkApp> opens{" "}
				<LinkApp href="/contacts/segments">yours</LinkApp>, each with its active contacts, their share of your list and how many
				opened in the last {ACTIVITY_DAYS} days. New segment opens the editor, with a few starting points:
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
				<Link href={getHelpHref("sending", "who")}>Who gets it</Link> In the editor, pick one to show a part of an issue to its
				contacts only. <Link href={getHelpHref("writing", "sections")}>Sections for some readers</Link>
			</p>
			<p>
				Click a segment to open its page, like Segments / Engaged, whose back arrow returns to all of them. At the top: its
				active contacts, the share of them who opened and clicked in the last{" "}
				{ACTIVITY_DAYS} days next to your whole list, and the campaigns sent to it. Below, its contacts of every status, with the
				search and filters of the Contacts page. Edit changes its name and conditions, and the <strong>⋯</strong> menu exports its
				contacts, deletes them, or deletes the segment, whose contacts stay.
			</p>
			<FigureHelp
				src="/help/contacts/segment.webp"
				alt="A segment's page: its active contacts, opens and clicks next to the whole list and campaigns, then its contacts filtered by status."
				caption="A segment's page"
			/>
			<p>
				Counts are of active contacts, the ones an issue goes to. Conditions on dates count back from now, so &ldquo;opened in the last
				30 days&rdquo; follows time, and a send reads its segment when it goes out. A segment that a scheduled or sending issue goes to,
				or has a section for, can&apos;t be deleted until that issue goes elsewhere or the section changes.
			</p>

			<h2 id="add">Adding contacts</h2>
			<p>
				Add contacts, in the <strong>⋯</strong> menu at the top of the <LinkApp href="/contacts">Contacts page</LinkApp>, has every
				way to add people to your list:
			</p>
			<ul>
				<li>
					<strong>Form for your site</strong> opens the <LinkApp href="/newsletters/form">signup form</LinkApp> to paste on your site,
					blog or link page: readers who sign up there join on their own.{" "}
					<Link href={getHelpHref("website", "form-on-your-site")}>A signup form on your own site</Link>
				</li>
				<li>
					<strong>Import a CSV</strong> brings in a whole list, like an export from beehiiv, Substack or Mailchimp.{" "}
					<Link href={getHelpHref("importing-contacts")}>Importing contacts</Link>
				</li>
				<li>
					<strong>With the API</strong> shows the request that signs someone up from your own site or app, with your newsletter in
					it, and where to create its key. A request can tag them too.{" "}
					<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
				</li>
				<li>
					<strong>By hand</strong> adds one person, as below.
				</li>
			</ul>
			<p>
				Your newsletter&apos;s <Link href={getHelpHref("website", "signups")}>website</Link> takes signups too, from its home page and
				its issue pages.
			</p>
			<p>
				To add someone by hand, pick By hand, type their email address and tick that they agreed to get your emails. They join at
				once, without a confirmation email, and get your welcome email if it&apos;s on. Until your list has {LIST_STARTED_AT}{" "}
				contacts, Add contact is also a button at the top of the page.
				{isCloud() && ` Without a plan, you can add ${TRIAL_CONTACTS.limit} contacts a day, enough to try it on yourself.`}
			</p>

			<h2 id="actions">Changing a status, and deleting</h2>
			<p>
				Each contact&apos;s menu, at the end of their row, has what applies to them, and so does the top right of their page: the
				first button shows their status and opens the changes it allows, and the <strong>⋯</strong> menu has the rest:
			</p>
			<ul>
				<li>
					<strong>Edit fields</strong> changes their first name and fields.
				</li>
				<li>
					<strong>Edit tags</strong> adds and takes off their tags, with the ones your other contacts have to pick from.
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
				To delete many at once, <a href="#filters">filter the list</a> or open a segment, then pick Delete in the{" "}
				<strong>⋯</strong> menu at the top. It deletes every contact the list shows, on every page, the same way.
			</p>
			<p>
				Bounced and complained contacts keep their status: their address can&apos;t receive email, or they marked one of your
				emails as spam. No email goes out when you change a status. The{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link> can change statuses too, with the same rules.
			</p>

			<h2 id="export">Exporting</h2>
			<p>
				Export, in the <strong>⋯</strong> menu at the top of the <LinkApp href="/contacts">Contacts page</LinkApp>, downloads the
				contacts that match your filters as a CSV file, with their first name, tags and a column per field. On a segment&apos;s
				page, it downloads the segment&apos;s. Its columns go back in through the import as they are, so it&apos;s also a backup.
			</p>

			<h2 id="undeliverable">Addresses no one can reach</h2>
			<p>
				When an address hard bounces or turns out to be a spam trap, MailCheap remembers it for every sender: imports and signups
				leave it out, and sends skip it, showing the contact as bounced. A bounced address is remembered for 180 days, a spam trap for
				good.
			</p>
			<p>
				MailCheap also checks in the background that your contacts&apos; domains can receive email. Contacts on one that can&apos;t show as
				bounced, marked &ldquo;No mail server&rdquo;, and come back on their own once it can.
				{(isCloud() || isSpamListEnabled()) &&
					" Contacts on a known spam domain show as bounced, marked \u201cSpam domain\u201d, unless they ever opened or clicked."}{" "}
				<Link href={getHelpHref("list-cleanup", "domains")}>
					{(isCloud() || isSpamListEnabled()) ? "Spam domains and domains without mail" : "Domains that can\u2019t receive email"}
				</Link>
			</p>
		</ArticleHelp>
	);
}
