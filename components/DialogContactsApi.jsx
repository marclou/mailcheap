import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import BlockCode from "@/components/BlockCode";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

// Adding contacts from code, from Add contacts on the Contacts page: the add_contact request for the newsletter the page
// shows, and where to get a key. onCloseAutoFocus: where the focus goes back, as what opened it is outside the dialog.
export default function DialogContactsApi({ newsletter, curl, isOpen, onOpenChange, onCloseAutoFocus }) {
	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl" onCloseAutoFocus={onCloseAutoFocus}>
				<DialogHeader>
					<DialogTitle>Add contacts with the API</DialogTitle>
					<DialogDescription className="text-pretty">
						Sign people up to <span className="font-medium text-foreground">{newsletter?.name}</span> from your site or app, one
						request each. A key with the Signups only level can add contacts and nothing else, so it&apos;s safe in your
						site&apos;s code.
					</DialogDescription>
				</DialogHeader>
				<BlockCode code={curl} title="Request" />
				<DialogFooter className="sm:justify-between">
					<Button asChild variant="ghost" className="text-muted-foreground">
						<Link href="/docs/api#add-contact" target="_blank" rel="noopener noreferrer">
							API docs
							<ArrowUpRight data-icon="inline-end" />
						</Link>
					</Button>
					<Button asChild>
						<Link href="/api-keys">Create an API key</Link>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
