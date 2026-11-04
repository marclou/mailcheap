"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { updateProfile } from "@/app/(account)/account/actions";
import CardSettings, { RowSettings } from "@/components/CardSettings";
import InputImage from "@/components/InputImage";
import StatusSaved from "@/components/StatusSaved";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The name and photo the dashboard shows. Google fills them at sign-up.
export default function FormProfile({ name, image, maxNameLength }) {
	const [state, action, isPending] = useActionState(save, null);

	return (
		<form action={action}>
			<CardSettings title="Profile">
				<RowSettings label="Photo" hint="Square, 128×128 or larger" isLabel>
					<InputImage name="image" defaultValue={image} label="photo" isRound isCropped />
				</RowSettings>
				<RowSettings label="Name" isLabel>
					<Input name="name" defaultValue={name} maxLength={maxNameLength} placeholder="Jane Doe" autoComplete="name" />
				</RowSettings>
				<div className="flex items-center justify-end gap-3 px-4 py-3">
					{state?.error && (
						<p role="alert" className="mr-auto text-sm text-pretty text-destructive">
							{state.error}
						</p>
					)}
					<StatusSaved savedAt={isPending ? null : state?.savedAt} />
					<Button type="submit" disabled={isPending} className="min-w-20">
						{isPending ? <Loader2 className="animate-spin" /> : "Save"}
					</Button>
				</div>
			</CardSettings>
		</form>
	);
}

async function save(previous, formData) {
	const result = await updateProfile(previous, formData);
	return result?.ok ? { ...result, savedAt: Date.now() } : result;
}
