import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { isCloud } from "@/lib/config";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { UNSUBSCRIBE_PLACEHOLDER } from "@/lib/render-email";

export const metadata = getHelpPageMetadata("writing");

export default function WritingPage() {
	return (
		<ArticleHelp slug="writing">
			<h2 id="steps">Write, review, send</h2>
			<p>
				Start a draft from the <LinkApp href="/campaigns">Campaigns page</LinkApp>. A campaign goes through three steps, shown at the
				top: Write, where you type the
				subject, the preview text and the issue; Review, a checklist of what to fix before it can go out; and Send, where you pick who
				gets it and when. Everything saves as you type, and a check shows each time it&apos;s saved.
			</p>
			<p>
				The preview text is what inboxes show after the subject. Without one, they show your issue&apos;s first words.
			</p>

			<h2 id="editor">The editor</h2>
			<ul>
				<li>
					<strong>Formatting</strong>: select text to get bold, italic, strikethrough, a link, two heading sizes and a quote.
				</li>
				<li>
					<strong>Slash commands</strong>: type <kbd>/</kbd> on an empty line for text, three heading sizes, bulleted and numbered
					lists, a picture, a quote, a divider or a box, which sets a block apart on a gray background.
				</li>
				<li>
					<strong>Links</strong>: select text, press <kbd>⌘ K</kbd> (<kbd>Ctrl K</kbd> on Windows) and paste the address. An email
					address becomes a link that opens an email to it.
				</li>
				<li>
					<strong>Markdown</strong>: shortcuts work as you type, like <code>#</code> and a space for a heading, <code>-</code> for a
					list or <code>&gt;</code> for a quote.
				</li>
			</ul>

			<h2 id="pictures">Pictures</h2>
			<p>
				Paste a picture, drop it in the editor, or type <kbd>/</kbd> and pick Image to upload one or use one you uploaded before. PNG,
				JPEG, GIF and WebP work, under 4 MB. Wider pictures are resized to 1,200 pixels. A picture shows at once and uploads in the
				background, and its address never changes, so sent emails keep showing it.
			</p>
			<p>
				Drag the handles on a picture&apos;s sides to resize it. Point at it to show its toolbar, inside its top edge (on a touch
				screen, tap the picture): place it on the left, in the center or on the right, add its alt text, or delete it. Emails and your
				website keep it where you put it.
			</p>
			<p>
				Alt text describes the picture in a few words, for readers who can&apos;t see it, inboxes that block images and search
				engines reading your website. Click Alt and type it: it saves as you type, and <kbd>Enter</kbd> closes it. The Alt button
				stays highlighted once a picture has one.
			</p>

			<h2 id="moving-blocks">Moving blocks</h2>
			<p>
				With a mouse, a grip appears to the left of the paragraph, heading, list, picture or box under the pointer. Drag it to move the
				block, and a line shows where it lands. Click it to select the block. From the keyboard, <kbd>⌘ Shift ↑</kbd> and{" "}
				<kbd>⌘ Shift ↓</kbd> (<kbd>Ctrl</kbd> instead of <kbd>⌘</kbd> on Windows) move the block the cursor is in. Moves undo like any
				other change.
			</p>

			<h2 id="first-name">Greeting readers by name</h2>
			<p>
				<code>{"{{first_name}}"}</code> shows each reader&apos;s first name. Type <kbd>/</kbd> and pick First name, or click the person
				icon at the end of the subject. Both add <code>{"{{first_name|there}}"}</code>: the word after the bar is what readers without a
				first name see, so &ldquo;Hi {"{{first_name|there}}"}&rdquo; reads &ldquo;Hi Jane&rdquo; or &ldquo;Hi there&rdquo;. Change it,
				or remove it with the bar to show nothing.
			</p>
			<p>
				It works in the subject, the preview text and the content, and in your welcome and confirmation emails. Your website and its
				issue pages always show the fallback, so no reader&apos;s name is ever public. The preview and test emails show the name Jane,
				or in a test email your own first name if you&apos;re one of your contacts with one. The review step flags any other{" "}
				<code>{"{{...}}"}</code>, like a tag from another platform, since it would go out as written. First names come from{" "}
				<Link href={getHelpHref("contacts", "details")}>your contacts</Link>.
			</p>

			<h2 id="preview">Preview and test emails</h2>
			<p>
				Preview, in the write step and in the <strong>⋯</strong> menu at any step, shows the email in a mail app&apos;s window on a
				desktop, or in Gmail on a phone: the inbox first, then the email once you tap it. Press <kbd>Esc</kbd> to close it.
			</p>
			<p>
				Send a test email, in the same menu, sends the email as saved to your account&apos;s address, with [Test] before the subject.
				Nobody else gets it.{isCloud() && " It counts toward your plan's emails."} The review step reminds you when you haven&apos;t
				sent one.
			</p>

			<h2 id="other">Duplicate, discard and HTML</h2>
			<p>
				The <strong>⋯</strong> menu also duplicates a campaign into a new draft, or discards a draft. A sent campaign can&apos;t be
				changed or deleted.
			</p>
			<p>
				A campaign made with the API or an AI assistant can be a whole HTML document. The dashboard then shows its HTML to edit, and it
				needs <code>{UNSUBSCRIBE_PLACEHOLDER}</code> where the unsubscribe link goes.{" "}
				<Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
			</p>
			<p>
				When you&apos;re done, <Link href={getHelpHref("sending")}>send or schedule it</Link>.
			</p>
		</ArticleHelp>
	);
}
