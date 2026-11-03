// The card MailCheap draws for a page without a picture of its own (lib/share-card.js), at 1200 by 630 for the image
// that link previews and the website's cards load (app/archive/[slug]/og/route.js). isFluid: sized by its container's
// width instead, whose element is a size container: the dashboard's previews of an issue's card. isIssue: an issue's
// card, its title under the newsletter's name and logo; else the website's own, with the newsletter's name as title.
export default function ImageShareCard({ title, description, name, logo, footer, domain, colors, background, isIssue = false, isFluid = false, fontFamily }) {
	const size = (pixels) => (isFluid ? `${(pixels / 12).toFixed(3)}cqw` : pixels);
	const logoSize = isIssue ? 64 : 112;

	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: size(72),
				backgroundColor: colors.background,
				...(background && { backgroundImage: background }),
				fontFamily,
				color: colors.foreground,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: size(20) }}>
				{logo && (
					// eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img>, and so do the previews
					<img
						src={logo}
						width={logoSize}
						height={logoSize}
						style={{ width: size(logoSize), height: size(logoSize), borderRadius: size(isIssue ? 16 : 28), border: `1px solid ${colors.border}` }}
						alt=""
					/>
				)}
				{isIssue && <span style={{ fontSize: size(32), fontWeight: 600 }}>{name}</span>}
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: size(20), maxWidth: size(1000) }}>
				<span style={{ fontSize: size(isIssue ? 64 : 88), fontWeight: 600, lineHeight: 1.08, letterSpacing: size(isIssue ? -2 : -3) }}>
					{title}
				</span>
				{description && <span style={{ fontSize: size(32), lineHeight: 1.35, color: colors.muted }}>{description}</span>}
			</div>

			<div style={{ display: "flex", justifyContent: "space-between", fontSize: size(28), color: colors.muted }}>
				<span>{footer}</span>
				<span>{domain}</span>
			</div>
		</div>
	);
}
