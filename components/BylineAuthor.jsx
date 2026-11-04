import AvatarUser from "@/components/AvatarUser";
import { cn } from "@/lib/utils";

// An issue's own author on its page (lib/authors.js findWebAuthor): "By <name>", after their photo when they have one.
// Their address is never on the page.
export default function BylineAuthor({ author, className }) {
	return (
		<span className={cn("flex min-w-0 items-center gap-2", className)}>
			{author.imageUrl && <AvatarUser name={author.name} image={author.imageUrl} size={24} />}
			<span className="truncate">
				By <span className="font-medium text-foreground">{author.name}</span>
			</span>
		</span>
	);
}
