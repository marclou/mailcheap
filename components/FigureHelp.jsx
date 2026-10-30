import Image from "next/image";

// What a help article's section explains, as people see it (app/(site)/help): a 1600×1000 WebP in public/help with
// made-up data, in the changelog's thin grey frame, with its caption under it. alt: what it shows, for screen readers.
export default function FigureHelp({ src, alt, caption }) {
	return (
		<figure className="my-8">
			<span className="block rounded-[20px] bg-muted p-1.5 ring-1 ring-black/5 ring-inset dark:ring-white/10">
				<Image
					src={src}
					width={1600}
					height={1000}
					alt={alt}
					sizes="(min-width: 768px) 42rem, calc(100vw - 2rem)"
					className="block h-auto w-full rounded-xl shadow-[0_1px_3px_rgb(0_0_0/0.08)] outline -outline-offset-1 outline-black/10 dark:outline-white/10"
				/>
			</span>
			<figcaption className="mt-2.5 text-center text-[13px] text-muted-foreground">{caption}</figcaption>
		</figure>
	);
}
