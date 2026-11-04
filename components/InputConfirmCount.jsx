"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";

// What a dialog asks before a change to many contacts that can't be undone: how many they are, typed in, with or without
// its commas (isCountTyped).
export default function InputConfirmCount({ count, value, onChange, disabled }) {
	const id = useId();
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id} className="font-normal text-muted-foreground">
				To confirm, type <span className="font-semibold text-foreground tabular-nums">{formatNumber(count)}</span>
			</Label>
			<Input
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				inputMode="numeric"
				autoComplete="off"
				spellCheck={false}
				maxLength={20}
				disabled={disabled}
				autoFocus
				className="tabular-nums"
			/>
		</div>
	);
}

export function isCountTyped(value, count) {
	return value.replace(/\D/g, "") === String(count);
}
