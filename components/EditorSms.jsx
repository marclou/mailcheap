"use client";

import { useMemo } from "react";
import { CircleAlert, User, ShieldAlert } from "lucide-react";
import { analyzeSmsContent } from "@/lib/sms-utils";
import { Button } from "@/components/ui/button";

export default function EditorSms({ value = "", onChange }) {
	const stats = useMemo(() => analyzeSmsContent(value), [value]);

	function insertTag(tag) {
		const next = value ? `${value} ${tag}` : tag;
		onChange(next);
	}

	return (
		<div className="flex flex-col gap-3 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertTag("{{first_name}}")}
						className="h-8 gap-1.5 text-xs font-normal"
					>
						<User className="h-3.5 w-3.5 text-muted-foreground" />
						First name
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => insertTag("Reply STOP to opt out")}
						className="h-8 gap-1.5 text-xs font-normal"
					>
						<ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
						Add STOP
					</Button>
				</div>

				<div className="font-mono text-xs text-muted-foreground">
					{stats.length} chars · {stats.segments} segment{stats.segments === 1 ? "" : "s"} ({stats.encoding})
				</div>
			</div>

			<textarea
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Write your SMS message here... Remember to include an opt-out instruction."
				aria-label="SMS text"
				rows={8}
				className="w-full resize-none bg-transparent font-sans text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
			/>

			{stats.isUcs2 && (
				<div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
					<CircleAlert className="h-4 w-4 shrink-0" />
					<span>
						Non-standard characters detected: message encoded in UCS-2 (limited to 70 characters per segment instead of 160).
					</span>
				</div>
			)}
		</div>
	);
}
