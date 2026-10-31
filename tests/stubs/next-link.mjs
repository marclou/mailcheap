import { createElement } from "react";

// A plain link: what next/link renders on the server, without the router's own props.
export default function Link({ href, prefetch, replace, scroll, shallow, onNavigate, ...props }) {
	return createElement("a", { href: typeof href === "string" ? href : String(href?.pathname ?? ""), ...props });
}

// No navigation is ever on its way on the server.
export function useLinkStatus() {
	return { pending: false };
}
