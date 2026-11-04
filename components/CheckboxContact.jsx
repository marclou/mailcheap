"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useContactSelection } from "@/lib/use-contact-selection";

// The box that ticks a contact of the list (TableContacts), above the link its row is: with shift, every contact since
// the last one ticked.
export default function CheckboxContact({ id, email }) {
	const selection = useContactSelection();
	if (!selection) return null;
	const isChecked = selection.isSelected(id);

	function toggle(event) {
		event.preventDefault();
		selection.toggle(id, !isChecked, { isRange: event.shiftKey });
	}

	return <Checkbox checked={isChecked} onClick={toggle} aria-label={`Select ${email}`} className="relative z-10 after:absolute after:-inset-3" />;
}

// The list header's box: every contact the list shows, on every page, or no one.
export function CheckboxAllContacts() {
	const selection = useContactSelection();
	if (!selection) return null;
	return (
		<Checkbox
			checked={selection.count > 0 && (selection.count >= selection.total || "indeterminate")}
			onCheckedChange={(isChecked) => (isChecked === true ? selection.selectAll() : selection.clear())}
			aria-label="Select all contacts"
			className="relative after:absolute after:-inset-3"
		/>
	);
}
