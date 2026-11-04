"use client";

import { useId, useState } from "react";
import { CircleAlert, Mail } from "lucide-react";
import LinkHelp from "@/components/LinkHelp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getContrast, normalizeHexColor } from "@/lib/colors";
import { THEME_FONTS, getFont, getFontStack } from "@/lib/theme-fonts";
import {
	COLOR_GROUPS,
	EMAIL_ALIGN_OPTIONS,
	HEADING_WEIGHTS,
	RADIUS_OPTIONS,
	SHADOW_OPTIONS,
	SPACING_OPTIONS,
	THEME_COLOR_KEYS,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

// The customizer's controls, on a theme's full values (FormTheme's draft): colors, fonts, shapes and where emails sit.
// The colors are mode's, light or dark, which the switch above them picks. Alignment only shows in emails: a pick calls
// onEmailChange, for the preview to show one.
export default function FieldsTheme({ values, onChange, mode, onModeChange, onEmailChange }) {
	const headingFont = getFont(values.fonts.heading);
	const colorGroup = COLOR_GROUPS[mode];
	const colors = values[colorGroup];
	const isLowContrast = getContrast(colors.text, colors.background) < 4.5;

	function set(key, value) {
		onChange({ ...values, [key]: value });
	}

	function setGroup(group, key, value) {
		onChange({ ...values, [group]: { ...values[group], [key]: value } });
	}

	// A heading font without the chosen weight takes its closest one.
	function setHeadingFont(id) {
		const [min, max] = getFont(id).weights;
		const weights = HEADING_WEIGHTS.filter((weight) => weight >= min && weight <= max);
		const headingWeight = weights.reduce((closest, weight) =>
			Math.abs(weight - values.headingWeight) < Math.abs(closest - values.headingWeight) ? weight : closest
		);
		onChange({ ...values, fonts: { ...values.fonts, heading: id }, headingWeight });
	}

	return (
		<div className="flex flex-col divide-y divide-border/60">
			<Group
				label="Colors"
				action={
					<Segmented label="Colors for" size="sm" value={mode} onChange={onModeChange} options={MODE_OPTIONS} />
				}
			>
				<div className="grid grid-cols-3 gap-2">
					{THEME_COLOR_KEYS.map((key) => (
						<SwatchColor key={key} label={COLOR_LABELS[key]} value={colors[key]} onChange={(color) => setGroup(colorGroup, key, color)} />
					))}
				</div>
				{isLowContrast && (
					<p className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 animate-enter dark:text-amber-400">
						<CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
						Text and page are hard to tell apart
					</p>
				)}
			</Group>
			<Group label="Fonts">
				<div className="grid gap-2">
					<SelectFont label={FONT_LABELS.heading} value={values.fonts.heading} onChange={setHeadingFont} />
					<SelectFont label={FONT_LABELS.body} value={values.fonts.body} onChange={(id) => setGroup("fonts", "body", id)} />
				</div>
				<p className="mt-2.5 text-xs text-pretty text-muted-foreground">
					Gmail and Outlook show a close system font. <LinkHelp article="design" section="emails" />
				</p>
			</Group>
			<Group label="Heading weight">
				<Segmented
					label="Heading weight"
					value={values.headingWeight}
					onChange={(weight) => set("headingWeight", weight)}
					options={HEADING_WEIGHTS.map((weight) => ({
						value: weight,
						label: String(weight),
						isDisabled: weight < headingFont.weights[0] || weight > headingFont.weights[1],
						content: (
							<span style={{ fontFamily: getFontStack(headingFont), fontWeight: weight }} className="text-base">
								Aa
							</span>
						),
					}))}
				/>
			</Group>
			<Group label="Corners">
				<Segmented
					label="Corners"
					value={values.radius}
					onChange={(radius) => set("radius", radius)}
					options={RADIUS_OPTIONS.map((radius) => ({
						value: radius,
						label: OPTION_LABELS[radius],
						content: (
							<span
								aria-hidden="true"
								style={{ borderTopLeftRadius: CORNER_PREVIEWS[radius] }}
								className="mt-1.5 ml-1.5 size-4 border-t-2 border-l-2 border-current"
							/>
						),
					}))}
				/>
			</Group>
			<Group label="Shadow">
				<Segmented
					label="Shadow"
					value={values.shadow}
					onChange={(shadow) => set("shadow", shadow)}
					options={SHADOW_OPTIONS.map((shadow) => ({
						value: shadow,
						label: OPTION_LABELS[shadow],
						content: <span aria-hidden="true" style={{ boxShadow: SHADOW_PREVIEWS[shadow] }} className="size-4 rounded-[3px] bg-background" />,
					}))}
				/>
			</Group>
			<Group label="Spacing">
				<Segmented
					label="Spacing"
					value={values.spacing}
					onChange={(spacing) => set("spacing", spacing)}
					options={SPACING_OPTIONS.map((spacing) => ({
						value: spacing,
						label: OPTION_LABELS[spacing],
						content: (
							<span aria-hidden="true" style={{ gap: SPACING_PREVIEWS[spacing] }} className="flex w-5 flex-col">
								{[0, 1, 2].map((line) => (
									<span key={line} className="h-0.5 rounded-full bg-current" />
								))}
							</span>
						),
					}))}
				/>
			</Group>
			<Group
				label="Alignment"
				action={
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Mail className="size-3.5" aria-hidden="true" />
						Emails only
					</span>
				}
			>
				<Segmented
					label="Email alignment"
					value={values.emailAlign}
					onChange={(emailAlign) => {
						set("emailAlign", emailAlign);
						onEmailChange();
					}}
					options={EMAIL_ALIGN_OPTIONS.map((align) => ({
						value: align,
						label: OPTION_LABELS[align],
						content: (
							<span className="flex items-center gap-2 text-sm font-medium">
								<span
									aria-hidden="true"
									className={cn(
										"flex h-4 w-6 rounded-[3px] p-[3px] shadow-[inset_0_0_0_1.5px_currentColor]",
										align === "left" ? "justify-start" : "justify-center"
									)}
								>
									<span className="flex w-2.5 flex-col justify-center gap-[2px]">
										{["w-full", "w-full", "w-2/3"].map((width, line) => (
											<span key={line} className={cn("h-[1.5px] rounded-full bg-current", width)} />
										))}
									</span>
								</span>
								{OPTION_LABELS[align]}
							</span>
						),
					}))}
				/>
			</Group>
		</div>
	);
}

function Group({ label, action, children }) {
	const id = useId();
	return (
		<div role="group" aria-labelledby={id} className="py-4 first:pt-0 last:pb-0">
			<div className="mb-2.5 flex min-h-5 items-center justify-between gap-3">
				<p id={id} className="text-xs font-medium text-muted-foreground">
					{label}
				</p>
				{action}
			</div>
			{children}
		</div>
	);
}

// The swatch opens the system's color picker; the code under it takes a pasted hex color.
function SwatchColor({ label, value, onChange }) {
	const [text, setText] = useState(null);

	function commit() {
		const color = normalizeHexColor(text);
		if (color) onChange(color);
		setText(null);
	}

	return (
		<div className="flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors duration-150 hover:bg-muted/60">
			<label className="relative block size-10 cursor-pointer rounded-full shadow-border transition-transform duration-150 ease-out active:scale-[0.96]" style={{ background: value }}>
				<span className="sr-only">{label}</span>
				<input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
			</label>
			<span className="text-xs font-medium">{label}</span>
			<input
				value={text ?? value}
				aria-label={`${label} hex code`}
				spellCheck={false}
				onChange={(event) => setText(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;
					event.preventDefault();
					commit();
				}}
				className="w-[4.75rem] rounded-md bg-transparent px-1 text-center font-mono text-[11px] text-muted-foreground uppercase outline-none focus-visible:bg-background focus-visible:text-foreground focus-visible:shadow-border"
			/>
		</div>
	);
}

function SelectFont({ label, value, onChange }) {
	return (
		<div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3">
			<span className="text-sm text-muted-foreground">{label}</span>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger aria-label={`${label} font`} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{THEME_FONTS.map((font) => (
						<SelectItem key={font.id} value={font.id}>
							<span style={{ fontFamily: getFontStack(font) }} className="text-[15px]">
								{font.name}
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

// A row of choices drawn rather than named; arrow keys move between them, as in any radio group. size sm: named
// choices, as tall as the app's tabs.
export function Segmented({ label, value, options, onChange, size = "default" }) {
	const isSmall = size === "sm";
	function move(event, index) {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const enabled = options.filter((option) => !option.isDisabled);
		const position = enabled.findIndex((option) => option.value === options[index].value);
		const next = enabled[(position + step + enabled.length) % enabled.length];
		onChange(next.value);
		event.currentTarget.parentElement.querySelector(`[data-value="${next.value}"]`)?.focus();
	}

	return (
		<div role="radiogroup" aria-label={label} className={cn("flex bg-muted", isSmall ? "h-8 rounded-lg p-[3px]" : "gap-1 rounded-xl p-1")}>
			{options.map((option, index) => {
				const isChecked = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={isChecked}
						aria-label={isSmall ? undefined : option.label}
						title={isSmall ? undefined : option.label}
						data-value={option.value}
						tabIndex={isChecked ? 0 : -1}
						disabled={option.isDisabled}
						onClick={() => onChange(option.value)}
						onKeyDown={(event) => move(event, index)}
						className={cn(
							"grid flex-1 place-items-center text-muted-foreground transition-[color,background-color,box-shadow,scale] duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30",
							isSmall ? "rounded-md px-3 text-sm font-medium" : "h-9 rounded-lg",
							isChecked && "bg-background text-foreground shadow-border"
						)}
					>
						{option.content}
					</button>
				);
			})}
		</div>
	);
}

const COLOR_LABELS = { background: "Page", text: "Text", accent: "Accent" };
const MODE_OPTIONS = [
	{ value: "light", label: "Light", content: "Light" },
	{ value: "dark", label: "Dark", content: "Dark" },
];
const FONT_LABELS = { heading: "Headings", body: "Text" };
const OPTION_LABELS = {
	none: "None",
	small: "Small",
	medium: "Medium",
	large: "Large",
	full: "Full",
	soft: "Soft",
	lifted: "Lifted",
	hard: "Hard",
	compact: "Compact",
	comfortable: "Comfortable",
	spacious: "Spacious",
	left: "Left",
	center: "Center",
};
const CORNER_PREVIEWS = { none: "0px", small: "3px", medium: "6px", large: "9px", full: "14px" };
const SHADOW_PREVIEWS = {
	none: "0 0 0 1px color-mix(in oklab, currentColor 35%, transparent)",
	soft: "0 0 0 1px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.12)",
	lifted: "0 0 0 1px rgb(0 0 0 / 0.06), 0 6px 10px -3px rgb(0 0 0 / 0.3)",
	hard: "0 0 0 1.5px currentColor, 2.5px 2.5px 0 0 currentColor",
};
const SPACING_PREVIEWS = { compact: "2px", comfortable: "3.5px", spacious: "5px" };
