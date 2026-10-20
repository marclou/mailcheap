"use client";

import { useRef, useState } from "react";
import { Eye } from "lucide-react";
import DialogPreviewEmail from "@/components/DialogPreviewEmail";
import { Button } from "@/components/ui/button";

// The campaign editor's preview, in a mail app's window or in Gmail on a phone, for an email rendered on the server.
export default function ButtonPreview({ html, sender, subject, previewText }) {
	const [isOpen, setIsOpen] = useState(false);
	const buttonRef = useRef(null);

	return (
		<>
			<Button ref={buttonRef} variant="outline" onClick={() => setIsOpen(true)}>
				<Eye data-icon="inline-start" />
				Preview
			</Button>
			<DialogPreviewEmail
				isOpen={isOpen}
				onOpenChange={setIsOpen}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					buttonRef.current?.focus();
				}}
				html={html}
				sender={sender}
				subject={subject}
				previewText={previewText}
			/>
		</>
	);
}
