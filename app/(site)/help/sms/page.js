import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("sms");

export default function SmsHelpPage() {
	return (
		<ArticleHelp slug="sms">
			<h2 id="overview">Text campaigns</h2>
			<p>
				MailCheap lets you send SMS campaigns alongside your regular newsletter issues. When you create or edit a draft on the{" "}
				<LinkApp href="/campaigns">Campaigns page</LinkApp>, switch the channel toggle to Text message (SMS) to compose a text
				broadcast for your subscribers.
			</p>
			<p>
				SMS campaigns reach subscribers who have a verified mobile number and have given their opt-in consent to receive text
				announcements.
			</p>

			<h2 id="segments">Character limits and segments</h2>
			<p>
				Standard text messages use the standard GSM-7 character set, allowing up to 160 characters in a single segment. When a
				message exceeds 160 characters, modern mobile phones join the segments together seamlessly, with each subsequent segment
				holding up to 153 characters.
			</p>
			<p>
				Including special accents or characters outside the GSM alphabet switches the message to Unicode (UCS-2) encoding. Under
				Unicode, a single segment can hold up to 70 characters, and multipart messages use 67 characters per segment. The editor
				shows a live segment counter and highlights when Unicode characters are detected.
			</p>

			<h2 id="links">Links and click tracking</h2>
			<p>
				Links included in your message are automatically shortened to preserve character count and allow real-time click tracking.
				Each recipient receives a unique short link that records when they open your link before instantly redirecting them to your
				destination address.
			</p>

			<h2 id="compliance">Consent and opt-out compliance</h2>
			<p>
				Telecommunication standards require clear opt-out instructions in text broadcasts. Always include an opt-out notice, such as{" "}
				<code>Reply STOP to unsubscribe</code>.
			</p>
			<p>
				When a recipient replies with a stop keyword (such as STOP, CANCEL, UNSUBSCRIBE, or END), their phone number is immediately
				unsubscribed and added to your suppression list. Future SMS dispatches skip suppressed numbers automatically.
			</p>

			<h2 id="sender-id">Sender identity and numbers</h2>
			<p>
				In supported countries, your messages can display an alphanumeric sender identifier (such as your publication name) instead
				of a phone number. In regions where sender IDs are restricted by local carriers, messages are sent from dedicated long
				codes or short codes configured in your account settings.
			</p>
		</ArticleHelp>
	);
}
