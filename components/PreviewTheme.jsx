import AvatarNewsletter from "@/components/AvatarNewsletter";
import { getThemeVariables } from "@/lib/themes";
import { cn } from "@/lib/utils";

// A resolved theme (lib/themes.js) over its children, with the variables the archive's pages get from StyleTheme.
export function ScopeTheme({ theme, className, children }) {
	return (
		<div style={getScopeStyle(theme)} className={cn("bg-background text-foreground", className)}>
			{children}
		</div>
	);
}

// A gallery card's picture: the newsletter's website, and one of its emails on top.
export function PreviewThemeCard({ theme, newsletter }) {
	return (
		<ScopeTheme theme={theme} className="relative h-60 overflow-hidden">
			<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-dots" />
			<div className="relative flex h-9 items-center justify-between gap-2 border-b border-border/60 px-3.5">
				<span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium [font-family:var(--theme-font-heading)]">
					<AvatarNewsletter newsletter={newsletter} size={16} />
					<span className="truncate">{newsletter.name}</span>
				</span>
				<ButtonMock className="px-2 py-1 text-[9px]">Subscribe</ButtonMock>
			</div>
			<div className="relative flex flex-col items-center px-6 pt-5 text-center">
				<p className="max-w-full truncate text-[22px] leading-tight font-theme-heading">{newsletter.name}</p>
				<p className="mt-1.5 max-w-[80%] truncate text-[10px] text-muted-foreground">{getDescription(newsletter)}</p>
				<div className="mt-3.5 flex w-[64%] items-center gap-1 rounded-xl bg-background p-1 shadow-border">
					<span className="min-w-0 flex-1 truncate px-1.5 text-left text-[9px] text-muted-foreground">you@example.com</span>
					<ButtonMock className="px-2 py-1 text-[9px]">Subscribe</ButtonMock>
				</div>
			</div>
			<div className="absolute inset-x-3.5 -bottom-7 grid grid-cols-3 gap-2.5">
				{ISSUES.map((issue) => (
					<div key={issue} className="flex flex-col gap-1.5">
						<span className="block aspect-[1200/630] rounded-lg bg-[linear-gradient(135deg,var(--primary),color-mix(in_oklab,var(--primary)_30%,var(--background)))]" />
						<span className="truncate text-[9px] font-theme-heading">{issue}</span>
					</div>
				))}
			</div>
			<div className="absolute right-3.5 bottom-3.5 w-[44%] rounded-lg bg-background p-3 shadow-[0_16px_32px_-12px_rgb(0_0_0/0.45)] ring-1 ring-foreground/10">
				<p className="truncate text-[12px] leading-snug font-theme-heading">This week</p>
				<span className="mt-2 block h-1 w-full rounded-full bg-foreground/15" />
				<span className="mt-1 block h-1 w-4/5 rounded-full bg-foreground/15" />
				<ButtonMock className="mt-2.5 inline-block px-2 py-1 text-[8px]">Read more</ButtonMock>
			</div>
		</ScopeTheme>
	);
}

// The customizer's website: the archive's home and the start of an issue, in the archive's own classes.
export function PreviewThemeSite({ theme, newsletter }) {
	return (
		<ScopeTheme theme={theme} className="min-h-full">
			<div className="sticky top-0 z-10 flex h-12 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-5 backdrop-blur-md">
				<span className="flex min-w-0 items-center gap-2 text-sm font-medium tracking-tight [font-family:var(--theme-font-heading)]">
					<AvatarNewsletter newsletter={newsletter} size={24} />
					<span className="truncate">{newsletter.name}</span>
				</span>
				<ButtonMock className="px-3 py-1.5 text-xs">Subscribe</ButtonMock>
			</div>
			<div className="relative isolate overflow-hidden">
				<div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-dots" />
				<div className="mx-auto flex max-w-md flex-col items-center px-5 pt-12 pb-10 text-center">
					<AvatarNewsletter newsletter={newsletter} size={56} className="rounded-2xl shadow-[0_8px_24px_-8px_rgb(0_0_0/0.25)]" />
					<p className="mt-5 text-3xl font-theme-heading text-balance">{newsletter.name}</p>
					<p className="mt-3 text-muted-foreground text-balance">{getDescription(newsletter)}</p>
					<div className="mt-6 flex w-full items-center gap-1.5 rounded-xl bg-background p-1.5 shadow-border">
						<span className="min-w-0 flex-1 truncate px-2.5 text-left text-sm text-muted-foreground">you@example.com</span>
						<ButtonMock className="h-8 px-4 text-sm leading-8">Subscribe</ButtonMock>
					</div>
				</div>
			</div>
			<div className="grid gap-x-5 gap-y-8 px-5 pb-10 sm:grid-cols-2">
				{ISSUES.slice(0, 2).map((issue, index) => (
					<div key={issue} className="flex flex-col gap-3">
						<span className="block aspect-[1200/630] rounded-xl bg-[linear-gradient(135deg,var(--primary),color-mix(in_oklab,var(--primary)_30%,var(--background)))] outline -outline-offset-1 outline-foreground/10" />
						<span className="text-xs text-muted-foreground tabular-nums">{index ? "Oct 11" : "Oct 18"}</span>
						<span className="text-lg leading-snug font-theme-heading">{issue}</span>
					</div>
				))}
			</div>
			<div className="border-t border-border/60 px-5 py-10">
				<div className="prose-issue mx-auto max-w-md">
					<h2>Worth your time</h2>
					<p>
						Thanks for reading. Here&apos;s what I found this week, with <a href="#preview">one link</a> I keep
						coming back to and <strong>a note on what&apos;s next</strong>.
					</p>
					<blockquote>
						<p>Make it work, make it right, make it fast.</p>
					</blockquote>
					<div data-callout="">
						<p>Reply to this email: I read every answer.</p>
					</div>
				</div>
			</div>
		</ScopeTheme>
	);
}

function ButtonMock({ className, children }) {
	return <span className={cn("rounded-md bg-primary leading-none font-medium text-primary-foreground", className)}>{children}</span>;
}

function getDescription(newsletter) {
	return newsletter.description || "One idea about building things, every Sunday.";
}

// React takes standard properties in camelCase; the theme's own are custom properties.
function getScopeStyle(theme) {
	const { "color-scheme": colorScheme, ...variables } = getThemeVariables(theme);
	return { ...variables, colorScheme, fontFamily: variables["--theme-font-body"] ? "var(--theme-font-body)" : undefined };
}

const ISSUES = ["Notes from the road", "What I'd do again", "The long way round"];
