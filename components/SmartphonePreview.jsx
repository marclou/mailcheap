"use client";

export default function SmartphonePreview({ message = "", senderName = "MailCheap" }) {
	const rendered = (message || "").replace(/\{\{\s*first_name\s*\}\}/gi, "Alex");

	return (
		<div className="mx-auto w-[280px] shrink-0 rounded-[36px] border-4 border-border/80 bg-background p-3 shadow-xl">
			{/* Top phone speaker cutout */}
			<div className="mx-auto mb-4 h-3 w-20 rounded-full bg-muted" />

			{/* Conversation header */}
			<div className="mb-4 border-b border-border/60 pb-2 text-center">
				<div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-muted font-mono text-xs font-medium text-muted-foreground">
					{senderName.slice(0, 2).toUpperCase()}
				</div>
				<p className="text-xs font-medium text-foreground">{senderName}</p>
				<p className="text-[10px] text-muted-foreground">SMS message</p>
			</div>

			{/* Conversation body */}
			<div className="flex min-h-[200px] flex-col justify-end">
				{rendered ? (
					<div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-xs leading-relaxed text-primary-foreground shadow-sm">
						{rendered}
					</div>
				) : (
					<div className="py-8 text-center text-xs italic text-muted-foreground">
						Start writing to preview the message...
					</div>
				)}
				<p className="mt-1 pr-1 text-right text-[10px] text-muted-foreground">Now</p>
			</div>

			{/* Bottom home notch indicator */}
			<div className="mx-auto mt-6 h-1 w-24 rounded-full bg-muted-foreground/30" />
		</div>
	);
}
