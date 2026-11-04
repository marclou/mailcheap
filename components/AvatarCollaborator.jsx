import Image from "next/image";
import AvatarUser from "@/components/AvatarUser";
import { getPresenceColor } from "@/lib/presence-rules";
import { cn } from "@/lib/utils";

// Someone on a team's draft, by their name (lib/use-presence.js): the photo they uploaded, their Gravatar's, or their
// initial on their color, or in their color on white where it sits on their color (isOnColor). Gravatar returns a
// transparent image when the address has no photo (d=blank).
export default function AvatarCollaborator({ person, size = 20, isOnColor = false, className }) {
	if (person.image) return <AvatarUser name={person.name} image={person.image} size={size} className={className} />;

	const color = getPresenceColor(person.id);
	return (
		<span
			aria-hidden="true"
			style={{
				width: size,
				height: size,
				fontSize: Math.round(size * 0.5),
				...(isOnColor ? { backgroundColor: "white", color } : { backgroundColor: color, color: "white" }),
			}}
			className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold uppercase", className)}
		>
			{person.name.charAt(0)}
			<Image
				src={`https://gravatar.com/avatar/${person.gravatarHash}?s=${size * 2}&d=blank`}
				alt=""
				width={size}
				height={size}
				unoptimized
				className="absolute inset-0 size-full object-cover"
			/>
		</span>
	);
}
