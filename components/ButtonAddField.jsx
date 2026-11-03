"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import DialogContactFields from "@/components/DialogContactFields";
import { Button } from "@/components/ui/button";
import { useHasRole } from "@/lib/use-team-role";
import { cn } from "@/lib/utils";

// Opens the account's fields to add one, from where a contact's are listed. A team's admins add them.
export default function ButtonAddField({ className }) {
	const [isOpen, setIsOpen] = useState(false);
	const canAdd = useHasRole("admin");
	if (!canAdd) return null;

	return (
		<>
			<Button variant="ghost" size="sm" onClick={() => setIsOpen(true)} className={cn("text-muted-foreground", className)}>
				<Plus data-icon="inline-start" />
				Add a field
			</Button>
			<DialogContactFields isOpen={isOpen} onOpenChange={setIsOpen} />
		</>
	);
}
