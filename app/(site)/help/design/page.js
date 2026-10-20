import Link from "next/link";
import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { getHelpHref, getHelpPageMetadata } from "@/lib/help";
import { THEME_FONTS } from "@/lib/theme-fonts";
import { THEME_PRESETS } from "@/lib/themes";

export const metadata = getHelpPageMetadata("design");

export default function DesignPage() {
	const [mailcheap, ...presets] = THEME_PRESETS;

	return (
		<ArticleHelp slug="design">
			<h2 id="themes">Themes</h2>
			<p>
				A theme is your newsletter&apos;s look: its fonts, colors, corners, shadows and spacing, on your website and in your emails.
				Pick one in <LinkApp href="/newsletters/design">Settings, then Design</LinkApp>: each theme shows your website and one of
				your emails in it, and a click applies it. A message lets you undo it.
			</p>
			<p>
				There are {THEME_PRESETS.length}: {mailcheap.name}, the black and white look newsletters start with, then{" "}
				{presets.map(({ name }) => name).join(", ")}.
			</p>

			<h2 id="customize">Changing a theme</h2>
			<p>Customize, on the theme you use, changes it with your website and an email shown as you go:</p>
			<ul>
				<li>
					<strong>Colors</strong>: the page, the text and the accent, for buttons and links. Every other shade comes from these three.
					When the accent is too light to read as text, links keep the text color and the accent underlines them.
				</li>
				<li>
					<strong>Fonts</strong>: one for headings and one for text, out of {THEME_FONTS.length}:{" "}
					{THEME_FONTS.map(({ name }) => name).join(", ")}.
				</li>
				<li>
					<strong>Heading weight</strong>: from regular to black, as far as the heading font goes.
				</li>
				<li>
					<strong>Corners</strong>: square to round, for buttons, cards and pictures.
				</li>
				<li>
					<strong>Shadow</strong>: none, soft, lifted or hard, for cards and the signup form on your website.
				</li>
				<li>
					<strong>Spacing</strong>: the line height and the space between paragraphs.
				</li>
			</ul>
			<p>
				Save with the bar at the bottom, or discard. Reset takes the theme back to how it comes. Applying another theme starts from
				that one: your changes to the one before go.
			</p>

			<h2 id="where">Where it shows</h2>
			<ul>
				<li>
					<strong>Your website</strong>: the home page, issue pages, the author page, the signup popup and the pictures cards show
					for issues without one. <Link href={getHelpHref("website")}>Website and signups</Link>
				</li>
				<li>
					<strong>The pages your emails link to</strong>: confirming a signup, unsubscribing and the last-chance email&apos;s page.
				</li>
				<li>
					<strong>Your emails</strong>: issues written in the editor or in Markdown, the welcome email, the confirmation email and
					the last-chance email, with the previews and test emails. An issue sent as HTML designed elsewhere keeps its own look.
				</li>
			</ul>

			<h2 id="emails">In emails</h2>
			<p>
				Apple Mail and other apps that load fonts show your theme&apos;s. Gmail, Outlook and a few others don&apos;t load fonts:
				they show the closest system font, a sans-serif, a serif or a monospace like your theme&apos;s. Emails have no shadows.
			</p>

			<h2 id="dark-mode">Dark mode</h2>
			<p>
				With {mailcheap.name}&apos;s own colors, your website follows each reader&apos;s light or dark mode. Every other palette,
				changed colors included, looks the same for everyone, so a dark theme like Midnight stays dark.
			</p>

			<h2 id="api">From the API and AI assistants</h2>
			<p>
				<Link href="/docs/api#list-themes">List themes</Link> gives the themes, fonts and choices, and{" "}
				<Link href="/docs/api#update-newsletter">update a newsletter</Link> sets the theme and what&apos;s changed on top of it. Your
				AI assistant does the same through MCP. <Link href={getHelpHref("api-and-ai")}>API and AI assistants</Link>
			</p>
		</ArticleHelp>
	);
}
