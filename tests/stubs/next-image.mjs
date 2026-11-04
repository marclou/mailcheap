import { createElement } from "react";

// A plain <img> of the source, without the optimizer's own props.
export default function Image({ src, priority, unoptimized, placeholder, blurDataURL, quality, fill, sizes, loader, ...props }) {
	return createElement("img", { src: typeof src === "string" ? src : src.src, ...props });
}

// The props that <img> would get, the source as it is.
export function getImageProps({ src, priority, unoptimized, placeholder, blurDataURL, quality, fill, sizes, loader, ...props }) {
	return { props: { src: typeof src === "string" ? src : src.src, ...props } };
}
