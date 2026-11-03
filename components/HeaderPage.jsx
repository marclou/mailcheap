import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// parent: { label, href } of the page this one is under, named before the title as in Settings / General, which the
// back arrow goes to. backHref: a back arrow alone, where the title needs the room. details: a line under the title.
export default function HeaderPage({ title, parent, backHref, children, meta, details, icon }) {
	return (
		<header className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 animate-enter">
			<TitlePage title={title} parent={parent} backHref={backHref} icon={icon} meta={meta} details={details} />
			{children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
		</header>
	);
}

// A page's title, after the back arrow and its parent's name. On a phone, the arrow alone leaves the title its room.
export function TitlePage({ title, parent, backHref, icon, meta, details }) {
	const back = parent?.href ?? backHref;
	if (details) {
		return (
			<div className="flex min-w-0 items-center gap-3">
				{back && <LinkBack href={back} />}
				{icon}
				<div className="flex min-w-0 flex-col gap-1.5">
					<span className="flex min-w-0 items-center gap-2">
						<h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
						{meta}
					</span>
					{details}
				</div>
			</div>
		);
	}
	return (
		<div className="flex min-w-0 items-center gap-2">
			{back && <LinkBack href={back} />}
			{parent && (
				<span className="flex shrink-0 items-center gap-2 text-2xl font-semibold tracking-tight max-sm:hidden">
					<Link href={parent.href} className="text-muted-foreground transition-colors duration-150 hover:text-foreground">
						{parent.label}
					</Link>
					<span aria-hidden="true" className="font-normal text-muted-foreground/50">
						/
					</span>
				</span>
			)}
			{icon}
			<h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
			{meta}
		</div>
	);
}

function LinkBack({ href }) {
	return (
		<Link
			href={href}
			aria-label="Back"
			className="-ml-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
		>
			<ChevronLeft className="size-5" />
		</Link>
	);
}
